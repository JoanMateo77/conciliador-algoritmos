// Worker de la cola: proceso aparte (npm run worker -w apps/api) que toma trabajos,
// concilia y guarda el resultado y el cierre del trabajo en UNA transacción.
// Varios workers pueden correr a la vez (FOR UPDATE SKIP LOCKED). Apagado limpio: ante
// SIGTERM deja de tomar trabajos, termina el que tiene en curso y cierra el pool.
import { hostname } from 'node:os';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import type { Pool, PoolClient } from 'pg';
import { ErrorRegexCostosa, conciliar } from '@conciliador/core';
import { aplicarEsquema, crearPool, enTransaccion } from './bd.ts';
import { prepararConciliacion, registroDeEmpresa, validarCuerpoConciliacion } from './conciliacion.ts';
import { ErrorHttp } from './http.ts';
import { registrar } from './registros.ts';
import { guardarConciliacionCon } from './repositorio.ts';
import { marcarError, marcarHecho, recuperarVencidos, tomarTrabajo } from './trabajos.ts';
import type { TrabajoTomado } from './trabajos.ts';

export interface OpcionesWorker {
  pool: Pool;
  nombre?: string;
  intervaloMs?: number;        // espera cuando la cola está vacía
  concurrencia?: number;       // trabajos a la vez en este proceso
  vencimientoMs?: number;      // tras esto, un trabajo en 'procesando' se da por abandonado
  esperaBaseMs?: number;       // reintento n espera esperaBaseMs * 2^(n-1)
  esperaMaximaMs?: number;
  // Solo para pruebas: corre dentro de la transacción, después de guardar y antes de cerrar el trabajo.
  alGuardar?: (trabajo: TrabajoTomado, cliente: PoolClient) => Promise<void> | void;
}

export interface Worker {
  procesarUno(): Promise<boolean>;   // true si encontró un trabajo
  iniciar(): void;
  detener(): Promise<void>;
  readonly procesados: number;
}

class TomaPerdida extends Error {}

export function crearWorker(opciones: OpcionesWorker): Worker {
  const { pool } = opciones;
  const nombre = opciones.nombre ?? `${hostname()}:${process.pid}`;
  const intervaloMs = opciones.intervaloMs ?? 1_000;
  const concurrencia = Math.max(1, opciones.concurrencia ?? 1);
  const vencimientoMs = opciones.vencimientoMs ?? 10 * 60_000;
  const esperaBaseMs = opciones.esperaBaseMs ?? 2_000;
  const esperaMaximaMs = opciones.esperaMaximaMs ?? 5 * 60_000;

  let deteniendo = false;
  let procesados = 0;
  let ultimaRecuperacion = 0;
  const bucles: Promise<void>[] = [];
  const despertadores = new Set<() => void>();

  async function procesarUno(): Promise<boolean> {
    // La recuperación de abandonados es barata (índice parcial) pero no hace falta en cada vuelta.
    if (Date.now() - ultimaRecuperacion > Math.min(vencimientoMs / 2, 30_000)) {
      ultimaRecuperacion = Date.now();
      const n = await recuperarVencidos(pool, vencimientoMs);
      if (n > 0) registrar('aviso', 'trabajos_recuperados', { worker: nombre, cantidad: n });
    }
    const trabajo = await tomarTrabajo(pool, nombre);
    if (!trabajo) return false;
    const t0 = performance.now();
    registrar('info', 'trabajo_tomado', { worker: nombre, trabajo: trabajo.id, empresa: trabajo.empresaId, intento: trabajo.intentos });
    try {
      const registro = await registroDeEmpresa(pool, trabajo.empresaId);
      // Se valida de nuevo: la carga pudo encolarse con otra versión de la API o de las plantillas.
      const entrada = validarCuerpoConciliacion(
        { banco: trabajo.carga.banco, ventas: trabajo.carga.ventas, perfil: trabajo.carga.perfil }, registro);
      const preparado = prepararConciliacion(entrada, registro);
      const t1 = performance.now();
      const resultado = conciliar(preparado.banco.movimientos, preparado.ventas.movimientos, preparado.perfil);
      const msCruce = performance.now() - t1;
      const conciliacionId = await enTransaccion(pool, async (cliente) => {
        const id = await guardarConciliacionCon(cliente, {
          empresaId: trabajo.empresaId, usuarioId: trabajo.usuarioId,
          archivoBanco: preparado.banco.nombre, archivoVentas: preparado.ventas.nombre,
          plantillaBanco: preparado.banco.plantillaId as string, plantillaVentas: preparado.ventas.plantillaId as string,
          perfil: preparado.perfil, perfilRef: trabajo.carga.perfilRef,
          banco: preparado.banco.movimientos, ventas: preparado.ventas.movimientos, resultado,
        });
        await opciones.alGuardar?.(trabajo, cliente);
        if (!(await marcarHecho(cliente, trabajo, id))) throw new TomaPerdida('Otro worker retomó este trabajo.');
        return id;
      });
      procesados++;
      registrar('info', 'trabajo_hecho', {
        worker: nombre, trabajo: trabajo.id, conciliacion: conciliacionId,
        movimientos: preparado.banco.movimientos.length + preparado.ventas.movimientos.length,
        msCruce: Math.round(msCruce), msTotal: Math.round(performance.now() - t0),
      });
    } catch (error) {
      if (error instanceof TomaPerdida) {
        registrar('aviso', 'trabajo_toma_perdida', { worker: nombre, trabajo: trabajo.id });
        return true;
      }
      // 4xx = los datos están mal: reintentar no sirve (tampoco si una regex agotó su tiempo).
      // Lo demás (base caída, etc.) se reintenta.
      const permanente = (error instanceof ErrorHttp && error.estado < 500) || error instanceof ErrorRegexCostosa;
      const espera = Math.min(esperaMaximaMs, esperaBaseMs * 2 ** (trabajo.intentos - 1));
      const mensaje = error instanceof Error ? error.message : String(error);
      const estado = await marcarError(pool, trabajo,
        { mensaje: permanente ? mensaje : `Error al procesar: ${mensaje}`, detalles: error instanceof ErrorHttp ? error.detalles : undefined },
        { permanente, esperaMs: espera }).catch((e: unknown) => {
        registrar('error', 'trabajo_no_marcado', { worker: nombre, trabajo: trabajo.id, error: e });
        return null;
      });
      registrar(permanente ? 'aviso' : 'error', 'trabajo_error', {
        worker: nombre, trabajo: trabajo.id, intento: trabajo.intentos, estado, permanente,
        ...(permanente ? { mensaje } : { error }),
      });
    }
    return true;
  }

  function dormir(ms: number): Promise<void> {
    return new Promise((resolver) => {
      const fin = () => { clearTimeout(t); despertadores.delete(fin); resolver(); };
      const t = setTimeout(fin, ms);
      despertadores.add(fin);
    });
  }

  async function bucle(): Promise<void> {
    while (!deteniendo) {
      let hubo = false;
      try {
        hubo = await procesarUno();
      } catch (error) {
        // Base caída al tomar: se espera y se reintenta, sin tumbar el proceso.
        registrar('error', 'worker_error', { worker: nombre, error });
      }
      if (!hubo && !deteniendo) await dormir(intervaloMs);
    }
  }

  return {
    procesarUno,
    iniciar() {
      if (bucles.length > 0) return;
      deteniendo = false;
      registrar('info', 'worker_iniciado', { worker: nombre, concurrencia });
      for (let i = 0; i < concurrencia; i++) bucles.push(bucle());
    },
    async detener() {
      deteniendo = true;
      for (const despertar of [...despertadores]) despertar();
      await Promise.all(bucles);
      bucles.length = 0;
      registrar('info', 'worker_detenido', { worker: nombre, procesados });
    },
    get procesados() { return procesados; },
  };
}

async function principal(): Promise<void> {
  const pool = crearPool(process.env.DATABASE_URL);
  if (!pool) throw new Error('El worker necesita DATABASE_URL.');
  await aplicarEsquema(pool); // por si el worker arranca antes que la API
  const worker = crearWorker({
    pool,
    concurrencia: Number(process.env.WORKER_CONCURRENCIA ?? 1),
    intervaloMs: Number(process.env.WORKER_INTERVALO_MS ?? 1_000),
  });
  worker.iniciar();
  let apagando = false;
  const apagar = (senal: string) => {
    if (apagando) return;
    apagando = true;
    registrar('info', 'worker_apagando', { senal });
    // Tope de espera: Render da 30 s entre SIGTERM y SIGKILL. Si no alcanza, el trabajo
    // queda en 'procesando' y otro worker lo recupera al vencer.
    setTimeout(() => process.exit(1), Number(process.env.WORKER_APAGADO_MS ?? 25_000)).unref();
    void worker.detener().then(() => pool.end()).then(() => process.exit(0));
  };
  process.once('SIGTERM', () => apagar('SIGTERM'));
  process.once('SIGINT', () => apagar('SIGINT'));
}

const esPrincipal = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (esPrincipal) {
  principal().catch((error) => {
    registrar('error', 'worker_no_inicio', { error });
    process.exit(1);
  });
}
