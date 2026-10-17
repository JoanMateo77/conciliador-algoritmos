// Prueba de carga (fase 13). Dos partes:
//  1. Núcleo: 10^6 movimientos sintéticos conciliados por lotes (cada lote es un periodo independiente,
//     como se procesaría un extracto mensual). Mide tiempo total, por lote y memoria.
//  2. Cola: N trabajos encolados por HTTP (POST /conciliaciones?asincrono=1) y procesados por W
//     procesos worker reales; mientras tanto se mide la latencia de /salud para ver que la API no se bloquea.
//     Necesita CARGA_DATABASE_URL (o DATABASE_URL). Escribe en la empresa 'demo' de esa base: use una base de pruebas.
//
// Uso: node scripts/carga.ts [--movimientos=1000000] [--lote=100000] [--trabajos=40] [--por-trabajo=2000]
//                             [--workers=2] [--solo-nucleo] [--solo-cola]
// Todos los datos salen de un generador con semilla fija: nada es real.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { conciliar, PERFIL_POR_DEFECTO } from '../packages/core/src/index.ts';
import type { Movimiento } from '../packages/core/src/index.ts';
import { aplicarEsquema, crearPool } from '../apps/api/src/bd.ts';
import { crearServidor } from '../apps/api/src/servidor.ts';

// Los registros por petición inundarían la salida: solo avisos y errores, salvo que se pida otra cosa.
process.env.LOG_NIVEL ??= 'aviso';

const arg = (nombre: string, porDefecto: number) => {
  const a = process.argv.find((x) => x.startsWith(`--${nombre}=`));
  const valor = a ? Number(a.split('=')[1]) : porDefecto;
  if (!Number.isInteger(valor) || valor < 1) throw new Error(`--${nombre} debe ser un entero positivo`);
  return valor;
};
const bandera = (nombre: string) => process.argv.includes(`--${nombre}`);

const MOVIMIENTOS = arg('movimientos', 1_000_000);
const LOTE = arg('lote', 100_000);
const TRABAJOS = arg('trabajos', 40);
const POR_TRABAJO = arg('por-trabajo', 2_000);
const WORKERS = arg('workers', 2);

// ---------- Generador sintético (misma mezcla que scripts/medir.ts) ----------

// mulberry32: PRNG pequeño y reproducible.
function generador(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIA_MS = 86_400_000;
const INICIO = Date.parse('2026-01-01T00:00:00Z');
const VENTAS_POR_DIA = 60;
const fechaISO = (dia: number) => new Date(INICIO + dia * DIA_MS).toISOString().slice(0, 10);

// Genera hasta completar `total` movimientos (banco + ventas). 45 % exactas, 30 % con comisión,
// 15 % agrupadas en un abono, 10 % sin pareja.
function generar(total: number, semilla: number): { banco: Movimiento[]; ventas: Movimiento[] } {
  const azar = generador(semilla);
  const entero = (min: number, max: number) => min + Math.floor(azar() * (max - min + 1));
  const banco: Movimiento[] = [];
  const ventas: Movimiento[] = [];
  const dias = Math.max(1, Math.ceil(total / 1.8 / VENTAS_POR_DIA));
  const mov = (lado: 'banco' | 'ventas', id: string, dia: number, monto: number, referencia: string, linea: number): Movimiento =>
    ({ id, lado, fecha: fechaISO(dia), montoCentavos: monto, referencia, descripcion: '', plantilla: 'sintetica', linea });
  while (banco.length + ventas.length < total) {
    const r = azar();
    const dia = entero(0, dias - 1);
    const monto = entero(10_000, 2_000_000) * 100;
    const ref = `PED${String(ventas.length).padStart(7, '0')}`;
    const v = mov('ventas', `v${ventas.length + 1}`, dia, monto, ref, ventas.length + 2);
    if (r < 0.45) {
      ventas.push(v);
      banco.push(mov('banco', `b${banco.length + 1}`, dia + entero(0, 1), monto, ref, banco.length + 2));
    } else if (r < 0.75) {
      ventas.push(v);
      const neto = Math.round(monto * (1 - (2.5 + azar() * 2) / 100));
      banco.push(mov('banco', `b${banco.length + 1}`, dia + entero(1, 3), neto, ref.slice(0, 8), banco.length + 2));
    } else if (r < 0.9) {
      const k = entero(2, 4);
      let suma = 0;
      for (let x = 0; x < k; x++) {
        const m = entero(10_000, 400_000) * 100;
        suma += m;
        ventas.push(mov('ventas', `v${ventas.length + 1}`, dia, m, '', ventas.length + 2));
      }
      banco.push(mov('banco', `b${banco.length + 1}`, dia + 1, Math.round(suma * 0.97), `LOTE${banco.length + 1}`, banco.length + 2));
    } else if (r < 0.95) {
      ventas.push(v);
    } else {
      banco.push(mov('banco', `b${banco.length + 1}`, dia, monto, `TRF${banco.length + 1}`, banco.length + 2));
    }
  }
  return { banco, ventas };
}

const ms = (x: number) => Math.round(x);
const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);
function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.floor(p * orden.length))];
}

// ---------- 1. Núcleo por lotes ----------

function cargaNucleo(): void {
  console.log(`\n## Núcleo: ${MOVIMIENTOS.toLocaleString('es-CO')} movimientos en lotes de ${LOTE.toLocaleString('es-CO')}`);
  console.log('| Lote | Movimientos | Generar (ms) | Conciliar (ms) | Banco conciliado |');
  console.log('|---:|---:|---:|---:|---:|');
  let restantes = MOVIMIENTOS;
  let lote = 0;
  let totalConciliar = 0;
  let totalMovimientos = 0;
  let bancoTotal = 0;
  let bancoConciliado = 0;
  let rssMaximo = 0;
  const t0 = performance.now();
  while (restantes > 0) {
    lote++;
    const tg = performance.now();
    const { banco, ventas } = generar(Math.min(LOTE, restantes), 20261017 + lote);
    const msGenerar = performance.now() - tg;
    const tc = performance.now();
    const r = conciliar(banco, ventas, PERFIL_POR_DEFECTO).resumen;
    const msConciliar = performance.now() - tc;
    const n = banco.length + ventas.length;
    restantes -= n;
    totalMovimientos += n;
    totalConciliar += msConciliar;
    bancoTotal += r.movimientosBanco;
    bancoConciliado += r.movimientosBanco - r.sinCruzarBanco;
    rssMaximo = Math.max(rssMaximo, process.memoryUsage().rss);
    const pct = Math.round(((r.movimientosBanco - r.sinCruzarBanco) / r.movimientosBanco) * 1000) / 10;
    console.log(`| ${lote} | ${n.toLocaleString('es-CO')} | ${ms(msGenerar)} | ${ms(msConciliar)} | ${pct} % |`);
  }
  const total = performance.now() - t0;
  console.log(`\nTotal: ${totalMovimientos.toLocaleString('es-CO')} movimientos en ${ms(total)} ms ` +
    `(conciliar: ${ms(totalConciliar)} ms, ${Math.round(totalMovimientos / (totalConciliar / 1000)).toLocaleString('es-CO')} mov/s). ` +
    `Banco conciliado: ${Math.round((bancoConciliado / bancoTotal) * 1000) / 10} %. Memoria máxima (RSS): ${mb(rssMaximo)} MB.`);
}

// ---------- 2. Cola con workers reales ----------

// Pasa movimientos sintéticos a los formatos CSV de las plantillas incluidas.
const pesosCO = (centavos: number) => {
  const enteros = Math.floor(centavos / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${enteros},${String(centavos % 100).padStart(2, '0')}`;
};
const fechaCO = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function archivosDeTrabajo(n: number, semilla: number) {
  const { banco, ventas } = generar(n, semilla);
  const textoBanco = ['FECHA;DESCRIPCION;REFERENCIA;VALOR;SALDO',
    ...banco.map((m) => `${fechaCO(m.fecha)};ABONO SINTETICO;${m.referencia};${pesosCO(m.montoCentavos)};0,00`)].join('\n');
  const textoVentas = ['ID_VENTA,FECHA,CLIENTE,REFERENCIA,TOTAL',
    ...ventas.map((m) => `${m.id},${m.fecha},Cliente sintetico,${m.referencia},${(m.montoCentavos / 100).toFixed(2)}`)].join('\n');
  return {
    banco: { nombre: `banco-${semilla}.csv`, texto: textoBanco, plantillaId: 'banco-csv-generico' },
    ventas: { nombre: `ventas-${semilla}.csv`, texto: textoVentas, plantillaId: 'ventas-csv-generico' },
    movimientos: banco.length + ventas.length,
  };
}

async function cargaCola(url: string): Promise<void> {
  console.log(`\n## Cola: ${TRABAJOS} trabajos de ~${POR_TRABAJO.toLocaleString('es-CO')} movimientos con ${WORKERS} workers`);
  const pool = crearPool(url);
  if (!pool) throw new Error('Sin URL de base de datos');
  await aplicarEsquema(pool);
  const servidor = crearServidor({ pool, jwtSecreto: `carga-${process.pid}-${Date.now()}` }); // no se emiten tokens aquí
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  const hijos: ChildProcess[] = [];
  try {
    // Encolar por HTTP: mide lo que tarda la API en aceptar trabajo (no concilia nada).
    const ids: string[] = [];
    let movimientos = 0;
    const te = performance.now();
    for (let i = 0; i < TRABAJOS; i++) {
      const { banco, ventas, movimientos: n } = archivosDeTrabajo(POR_TRABAJO, 900 + i);
      movimientos += n;
      const r = await fetch(`${base}/conciliaciones?asincrono=1`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ banco, ventas }),
      });
      if (r.status !== 202) throw new Error(`Encolar respondió ${r.status}: ${await r.text()}`);
      ids.push((await r.json()).trabajoId);
    }
    const msEncolar = performance.now() - te;
    console.log(`Encolados ${TRABAJOS} trabajos (${movimientos.toLocaleString('es-CO')} movimientos) en ${ms(msEncolar)} ms ` +
      `(${ms(msEncolar / TRABAJOS)} ms por POST 202).`);

    const rutaWorker = fileURLToPath(new URL('../apps/api/src/worker.ts', import.meta.url));
    const tp = performance.now();
    for (let w = 0; w < WORKERS; w++) {
      hijos.push(spawn(process.execPath, [rutaWorker], {
        env: { ...process.env, DATABASE_URL: url, WORKER_INTERVALO_MS: '100' },
        stdio: ['ignore', 'inherit', 'inherit'],
      }));
    }

    // Mientras los workers trabajan, la API debe seguir respondiendo rápido.
    const latencias: number[] = [];
    let terminado = false;
    const sondeo = (async () => {
      while (!terminado) {
        const t = performance.now();
        await fetch(`${base}/salud`).then((r) => r.arrayBuffer());
        latencias.push(performance.now() - t);
        await new Promise((r) => setTimeout(r, 50));
      }
    })();

    let estados: Record<string, number> = {};
    while (true) {
      const { rows } = await pool.query('SELECT estado, count(*)::int AS n FROM trabajos WHERE id = ANY($1) GROUP BY estado', [ids]);
      estados = Object.fromEntries(rows.map((f) => [f.estado, f.n]));
      if ((estados.hecho ?? 0) + (estados.fallido ?? 0) >= TRABAJOS) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const msProceso = performance.now() - tp;
    terminado = true;
    await sondeo;

    const { rows: [t] } = await pool.query(
      `SELECT avg(extract(epoch FROM terminado_en - tomado_en) * 1000) AS prom, max(extract(epoch FROM terminado_en - tomado_en) * 1000) AS max,
         count(DISTINCT worker)::int AS workers,
         extract(epoch FROM max(terminado_en) - min(tomado_en)) * 1000 AS ventana FROM trabajos WHERE id = ANY($1) AND estado = 'hecho'`, [ids]);
    console.log(`Procesados en ${ms(msProceso)} ms desde lanzar los workers (${ms(Number(t.ventana))} ms desde la primera toma): hechos ${estados.hecho ?? 0}, fallidos ${estados.fallido ?? 0}; ` +
      `${(TRABAJOS / (msProceso / 1000)).toFixed(1)} trabajos/s, ${Math.round(movimientos / (msProceso / 1000)).toLocaleString('es-CO')} mov/s.`);
    console.log(`Por trabajo (leer + conciliar + guardar): promedio ${ms(Number(t.prom))} ms, máximo ${ms(Number(t.max))} ms; workers que tomaron trabajo: ${t.workers}.`);
    console.log(`/salud durante la carga (${latencias.length} sondeos): p50 ${percentil(latencias, 0.5).toFixed(1)} ms, ` +
      `p95 ${percentil(latencias, 0.95).toFixed(1)} ms, máximo ${Math.max(...latencias).toFixed(1)} ms.`);
  } finally {
    // Apagado limpio de los workers (SIGTERM) antes de cerrar.
    await Promise.all(hijos.map((h) => new Promise<void>((r) => { h.once('exit', () => r()); h.kill('SIGTERM'); })));
    servidor.closeAllConnections();
    await new Promise<void>((r) => servidor.close(() => r()));
    await pool.end();
  }
}

console.log(`Node ${process.version} · ${process.platform}/${process.arch}`);
if (!bandera('solo-cola')) cargaNucleo();
if (!bandera('solo-nucleo')) {
  const url = process.env.CARGA_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) console.log('\n## Cola: omitida (defina CARGA_DATABASE_URL o DATABASE_URL con una base de pruebas).');
  else await cargaCola(url);
}
