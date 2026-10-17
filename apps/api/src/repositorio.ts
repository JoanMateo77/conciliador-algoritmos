// Consultas de la API. Cada operación que escribe va en UNA transacción:
// o queda todo guardado o no queda nada. Toda consulta filtra por empresa: sin
// empresa explícita se usa la pública 'demo' (comportamiento del MVP).
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Movimiento, Perfil, ResultadoConciliacion, Coincidencia } from '@conciliador/core';
import { EMPRESA_DEMO_ID } from './auth.ts';
import { enTransaccion } from './bd.ts';
import { ErrorHttp } from './http.ts';
import { cortarPagina } from './paginacion.ts';
import type { PedidoPagina } from './paginacion.ts';

export type EstadoRevision = 'automatica' | 'sugerida' | 'confirmada' | 'rechazada';
export type Accion = 'confirmar' | 'rechazar';

export interface DatosConciliacion {
  id?: string;                 // opcional: lo usan las pruebas para buscar la fila después
  archivoBanco: string; archivoVentas: string;
  plantillaBanco: string; plantillaVentas: string;
  perfil: Perfil;
  banco: Movimiento[]; ventas: Movimiento[];
  resultado: ResultadoConciliacion;
  empresaId?: string;          // por defecto la empresa 'demo'
  usuarioId?: string | null;
  perfilRef?: { id: string; version: number };  // si el perfil salió de los guardados de la empresa
}

// Quién actúa en una decisión (para filtrar por empresa y auditar).
export interface Actor { empresaId: string; usuarioId: string | null }
const ACTOR_DEMO: Actor = { empresaId: EMPRESA_DEMO_ID, usuarioId: null };

// Campos con columna propia; lo demás (plantillaVersion, documento, campos nuevos del núcleo) va a 'extra'.
const CAMPOS_MOVIMIENTO = new Set(['id', 'lado', 'fecha', 'montoCentavos', 'referencia', 'descripcion', 'referenciaPago', 'desglose', 'plantilla', 'linea']);
const CAMPOS_COINCIDENCIA = new Set(['id', 'tipo', 'bancoIds', 'ventasIds', 'puntaje', 'diferenciaCentavos', 'explicacion', 'estado']);
function sobrantes(objeto: object, conocidos: Set<string>): Record<string, unknown> | null {
  const extra = Object.fromEntries(Object.entries(objeto).filter(([k, v]) => !conocidos.has(k) && v !== undefined));
  return Object.keys(extra).length > 0 ? extra : null;
}

// Filas por INSERT: miles en un viaje, pero sin armar un JSON gigante con un millón de movimientos.
const LOTE_FILAS = 5_000;

// bigint llega como texto desde pg; los centavos caben en un entero seguro.
const entero = (valor: unknown): number => Number(valor);

export async function guardarConciliacion(pool: Pool, datos: DatosConciliacion): Promise<string> {
  return enTransaccion(pool, (cliente) => guardarConciliacionCon(cliente, datos));
}

// Variante dentro de una transacción ya abierta: el worker guarda y cierra su trabajo en la misma.
export async function guardarConciliacionCon(cliente: PoolClient, datos: DatosConciliacion): Promise<string> {
  const id = datos.id ?? randomUUID();
  const empresaId = datos.empresaId ?? EMPRESA_DEMO_ID;
  const { resultado } = datos;
  const { coincidencias, ...detalle } = resultado;

  // Qué coincidencia ocupa a cada movimiento, para guardarlo ya enlazado.
  const ocupado = new Map<string, string>();
  for (const c of coincidencias) {
    for (const b of c.bancoIds) ocupado.set(`banco|${b}`, c.id);
    for (const v of c.ventasIds) ocupado.set(`ventas|${v}`, c.id);
  }

  await cliente.query(
    `INSERT INTO conciliaciones (id, empresa_id, usuario_id, archivo_banco, archivo_ventas, plantilla_banco, plantilla_ventas,
       perfil, perfil_id, perfil_version, resumen, detalle)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [id, empresaId, datos.usuarioId ?? null, datos.archivoBanco, datos.archivoVentas, datos.plantillaBanco, datos.plantillaVentas,
      JSON.stringify(datos.perfil), datos.perfilRef?.id ?? null, datos.perfilRef?.version ?? null,
      JSON.stringify(resultado.resumen), JSON.stringify(detalle)],
  );

  // jsonb_to_recordset: un INSERT por lote en vez de uno por fila.
  for (let desde = 0; desde < coincidencias.length; desde += LOTE_FILAS) {
    const lote = coincidencias.slice(desde, desde + LOTE_FILAS).map((c, i) => ({
      id: c.id, orden: desde + i, tipo: c.tipo, banco: c.bancoIds, ventas: c.ventasIds, puntaje: c.puntaje,
      diferencia: c.diferenciaCentavos, explicacion: c.explicacion, estado: c.estado, extra: sobrantes(c, CAMPOS_COINCIDENCIA),
    }));
    await cliente.query(
      `INSERT INTO coincidencias (conciliacion_id, empresa_id, id, orden, tipo, banco_ids, ventas_ids, puntaje,
         diferencia_centavos, explicacion, estado_inicial, estado, extra)
       SELECT $1, $2, r.id, r.orden, r.tipo,
         ARRAY(SELECT jsonb_array_elements_text(r.banco)), ARRAY(SELECT jsonb_array_elements_text(r.ventas)),
         r.puntaje, r.diferencia, r.explicacion, r.estado, r.estado, r.extra
       FROM jsonb_to_recordset($3::jsonb) AS r(id text, orden int, tipo text, banco jsonb, ventas jsonb,
         puntaje float8, diferencia bigint, explicacion text, estado text, extra jsonb)`,
      [id, empresaId, JSON.stringify(lote)],
    );
  }

  const movimientos = [...datos.banco, ...datos.ventas];
  for (let desde = 0; desde < movimientos.length; desde += LOTE_FILAS) {
    const filas = movimientos.slice(desde, desde + LOTE_FILAS).map((m) => ({
      lado: m.lado, id: m.id, fecha: m.fecha, monto: m.montoCentavos, referencia: m.referencia,
      descripcion: m.descripcion, referencia_pago: m.referenciaPago ?? null, desglose: m.desglose ?? null,
      plantilla: m.plantilla, linea: m.linea, coincidencia: ocupado.get(`${m.lado}|${m.id}`) ?? null,
      extra: sobrantes(m, CAMPOS_MOVIMIENTO),
    }));
    await cliente.query(
      `INSERT INTO movimientos (conciliacion_id, empresa_id, lado, id, fecha, monto_centavos, referencia, descripcion,
         referencia_pago, desglose, plantilla, linea, coincidencia_id, extra)
       SELECT $1, $2, r.lado, r.id, r.fecha, r.monto, r.referencia, r.descripcion, r.referencia_pago,
         r.desglose, r.plantilla, r.linea, r.coincidencia, r.extra
       FROM jsonb_to_recordset($3::jsonb) AS r(lado text, id text, fecha date, monto bigint, referencia text,
         descripcion text, referencia_pago text, desglose jsonb, plantilla text, linea int, coincidencia text, extra jsonb)`,
      [id, empresaId, JSON.stringify(filas)],
    );
  }
  return id;
}

export async function listarConciliaciones(pool: Pool, limite: number, empresaId: string = EMPRESA_DEMO_ID) {
  return (await paginarConciliaciones(pool, empresaId, { limite, cursor: null })).elementos;
}

// Orden: más recientes primero; el cursor es (creada, id) de la última fila mostrada.
// creada viaja como texto de PostgreSQL para no perder los microsegundos (Date solo tiene ms).
export async function paginarConciliaciones(pool: Pool, empresaId: string, pedido: PedidoPagina) {
  const parametros: unknown[] = [empresaId, pedido.limite + 1];
  let filtro = '';
  if (pedido.cursor) {
    parametros.push(pedido.cursor[0], pedido.cursor[1]);
    filtro = 'AND (c.creada, c.id) < ($3::timestamptz, $4::uuid)';
  }
  let rows: Record<string, unknown>[];
  try {
    // Primero la página (usa el índice empresa_id, creada, id) y luego los conteos solo de esas filas.
    ({ rows } = await pool.query(
      `WITH pagina AS (
         SELECT c.id, c.creada, c.creada::text AS creada_texto, c.archivo_banco, c.archivo_ventas,
           c.plantilla_banco, c.plantilla_ventas, c.resumen
         FROM conciliaciones c WHERE c.empresa_id = $1 ${filtro}
         ORDER BY c.creada DESC, c.id DESC LIMIT $2)
       SELECT p.*,
         count(k.id) FILTER (WHERE k.estado = 'confirmada') AS confirmadas,
         count(k.id) FILTER (WHERE k.estado = 'rechazada') AS rechazadas,
         count(k.id) FILTER (WHERE k.estado IN ('automatica', 'sugerida')) AS pendientes
       FROM pagina p LEFT JOIN coincidencias k ON k.conciliacion_id = p.id AND k.empresa_id = $1
       GROUP BY p.id, p.creada, p.creada_texto, p.archivo_banco, p.archivo_ventas, p.plantilla_banco, p.plantilla_ventas, p.resumen
       ORDER BY p.creada DESC, p.id DESC`,
      parametros,
    ));
  } catch (error) {
    // Un cursor manipulado con una fecha o uuid inválido es error del cliente, no del servidor.
    if ((error as { code?: string }).code?.startsWith('22')) throw new ErrorHttp(400, 'El parámetro "cursor" no es válido.');
    throw error;
  }
  return cortarPagina(rows, pedido.limite, (f) => [f.creada_texto as string, f.id as string], (f) => ({
    id: f.id as string,
    creada: (f.creada as Date).toISOString(),
    archivos: { banco: f.archivo_banco, ventas: f.archivo_ventas },
    plantillas: { banco: f.plantilla_banco, ventas: f.plantilla_ventas },
    resumen: f.resumen,
    revision: { confirmadas: entero(f.confirmadas), rechazadas: entero(f.rechazadas), pendientes: entero(f.pendientes) },
  }));
}

export async function obtenerConciliacion(pool: Pool, id: string, empresaId: string = EMPRESA_DEMO_ID) {
  // La empresa va en el WHERE: una conciliación de otra empresa responde igual que una inexistente.
  const conciliacion = await pool.query(
    `SELECT id, creada, archivo_banco, archivo_ventas, plantilla_banco, plantilla_ventas, perfil, perfil_id, perfil_version, detalle
     FROM conciliaciones WHERE id = $1 AND empresa_id = $2`,
    [id, empresaId],
  );
  if (conciliacion.rowCount === 0) return null;
  const fila = conciliacion.rows[0];
  const [coincidencias, eventos, libres] = await Promise.all([
    pool.query('SELECT * FROM coincidencias WHERE conciliacion_id = $1 AND empresa_id = $2 ORDER BY orden', [id, empresaId]),
    pool.query(`SELECT coincidencia_id, tipo, estado_anterior, estado_nuevo, creado, usuario_id FROM eventos
      WHERE conciliacion_id = $1 AND empresa_id = $2 ORDER BY id`, [id, empresaId]),
    pool.query(`SELECT lado, id FROM movimientos WHERE conciliacion_id = $1 AND empresa_id = $2 AND coincidencia_id IS NULL
      ORDER BY lado, linea, id`, [id, empresaId]),
  ]);

  // El resultado se devuelve tal como lo produjo el motor (estados iniciales);
  // las decisiones humanas van aparte en `estados` y `bitacora`.
  const lista: Coincidencia[] = coincidencias.rows.map((c) => ({
    ...(c.extra ?? {}),
    id: c.id, tipo: c.tipo, bancoIds: c.banco_ids, ventasIds: c.ventas_ids, puntaje: c.puntaje,
    diferenciaCentavos: entero(c.diferencia_centavos), explicacion: c.explicacion, estado: c.estado_inicial,
  }));
  const estados: Record<string, EstadoRevision> = {};
  for (const c of coincidencias.rows) estados[c.id] = c.estado;

  return {
    id: fila.id as string,
    creada: (fila.creada as Date).toISOString(),
    archivos: { banco: fila.archivo_banco, ventas: fila.archivo_ventas },
    plantillas: { banco: fila.plantilla_banco, ventas: fila.plantilla_ventas },
    perfil: fila.perfil as Perfil,
    ...(fila.perfil_id ? { perfilRef: { id: fila.perfil_id as string, version: fila.perfil_version as number } } : {}),
    resultado: { ...fila.detalle, coincidencias: lista } as ResultadoConciliacion,
    estados,
    bitacora: eventos.rows.map((e) => ({
      tipo: e.tipo, coincidenciaId: e.coincidencia_id, estadoAnterior: e.estado_anterior,
      estadoNuevo: e.estado_nuevo, fecha: (e.creado as Date).toISOString(),
      // Solo aparece si hubo usuario (fuera de la demo), así la bitácora del MVP queda idéntica.
      ...(e.usuario_id ? { usuarioId: e.usuario_id as string } : {}),
    })),
    // Movimientos libres hoy (incluye los liberados al rechazar).
    sinCruzar: {
      banco: libres.rows.filter((m) => m.lado === 'banco').map((m) => m.id as string),
      ventas: libres.rows.filter((m) => m.lado === 'ventas').map((m) => m.id as string),
    },
  };
}

// Qué estados permiten cada acción. Rechazar algo confirmado se permite (queda en la bitácora);
// confirmar algo rechazado no, porque sus movimientos ya se liberaron.
const PERMITIDOS: Record<Accion, EstadoRevision[]> = {
  confirmar: ['automatica', 'sugerida'],
  rechazar: ['automatica', 'sugerida', 'confirmada'],
};
const NUEVO: Record<Accion, EstadoRevision> = { confirmar: 'confirmada', rechazar: 'rechazada' };

export async function decidir(pool: Pool, conciliacionId: string, coincidenciaId: string, accion: Accion, actor: Actor = ACTOR_DEMO) {
  return enTransaccion(pool, async (cliente) => {
    // FOR UPDATE: dos revisores a la vez sobre la misma coincidencia se ponen en fila.
    const actual = await cliente.query(
      'SELECT estado, banco_ids, ventas_ids FROM coincidencias WHERE conciliacion_id = $1 AND id = $2 AND empresa_id = $3 FOR UPDATE',
      [conciliacionId, coincidenciaId, actor.empresaId],
    );
    if (actual.rowCount === 0) throw new ErrorHttp(404, 'La coincidencia no existe en esta conciliación.');
    const anterior = actual.rows[0].estado as EstadoRevision;
    if (!PERMITIDOS[accion].includes(anterior)) {
      throw new ErrorHttp(409, `No se puede ${accion} una coincidencia en estado "${anterior}".`);
    }
    const nuevo = NUEVO[accion];
    await cliente.query(
      'UPDATE coincidencias SET estado = $3, actualizada = now() WHERE conciliacion_id = $1 AND id = $2 AND empresa_id = $4',
      [conciliacionId, coincidenciaId, nuevo, actor.empresaId],
    );
    const evento = await registrarEvento(cliente, conciliacionId, coincidenciaId, accion, anterior, nuevo, actor);

    let liberados: { banco: string[]; ventas: string[] } | undefined;
    if (accion === 'rechazar') {
      const libres = await cliente.query(
        `UPDATE movimientos SET coincidencia_id = NULL WHERE conciliacion_id = $1 AND coincidencia_id = $2 AND empresa_id = $3
         RETURNING lado, id`,
        [conciliacionId, coincidenciaId, actor.empresaId],
      );
      liberados = {
        banco: libres.rows.filter((m) => m.lado === 'banco').map((m) => m.id as string).sort(),
        ventas: libres.rows.filter((m) => m.lado === 'ventas').map((m) => m.id as string).sort(),
      };
    }
    return { id: coincidenciaId, estado: nuevo, estadoAnterior: anterior, evento, ...(liberados ? { liberados } : {}) };
  });
}

async function registrarEvento(cliente: PoolClient, conciliacionId: string, coincidenciaId: string,
  tipo: Accion, anterior: EstadoRevision, nuevo: EstadoRevision, actor: Actor) {
  const { rows } = await cliente.query(
    `INSERT INTO eventos (conciliacion_id, empresa_id, usuario_id, coincidencia_id, tipo, estado_anterior, estado_nuevo)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING creado`,
    [conciliacionId, actor.empresaId, actor.usuarioId, coincidenciaId, tipo, anterior, nuevo],
  );
  return { tipo, coincidenciaId, fecha: (rows[0].creado as Date).toISOString(), ...(actor.usuarioId ? { usuarioId: actor.usuarioId } : {}) };
}
