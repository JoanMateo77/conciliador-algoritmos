// Cola persistente en PostgreSQL. Estados: pendiente -> procesando -> hecho | fallido
// (o de vuelta a pendiente para reintentar). Tomar usa FOR UPDATE SKIP LOCKED: cada worker
// salta las filas que otro ya bloqueó, así nunca dos procesan el mismo trabajo a la vez.
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { ArchivoEntrada, Perfil } from '@conciliador/core';

export type EstadoTrabajo = 'pendiente' | 'procesando' | 'hecho' | 'fallido';
export const ESTADOS_TRABAJO: EstadoTrabajo[] = ['pendiente', 'procesando', 'hecho', 'fallido'];

// El perfil ya va resuelto: si salió de los guardados de la empresa, la versión queda fija aunque cambie después.
export interface CargaConciliar {
  banco: ArchivoEntrada; ventas: ArchivoEntrada; perfil: Perfil;
  perfilRef?: { id: string; version: number };
}

export interface TrabajoTomado {
  id: string; empresaId: string; usuarioId: string | null;
  carga: CargaConciliar; intentos: number; maxIntentos: number; toma: string;
}

type Ejecutor = Pool | PoolClient;

export async function encolarTrabajo(bd: Ejecutor, datos: { empresaId: string; usuarioId?: string | null; carga: CargaConciliar; maxIntentos?: number; id?: string }): Promise<string> {
  const id = datos.id ?? randomUUID();
  await bd.query(
    'INSERT INTO trabajos (id, empresa_id, usuario_id, carga, max_intentos) VALUES ($1, $2, $3, $4, $5)',
    [id, datos.empresaId, datos.usuarioId ?? null, JSON.stringify(datos.carga), datos.maxIntentos ?? 3]);
  return id;
}

// Toma el pendiente más antiguo que ya esté disponible. La subconsulta bloquea esa fila y salta
// las bloqueadas; la toma (uuid) identifica este intento para cerrarlo después.
export async function tomarTrabajo(pool: Pool, worker: string): Promise<TrabajoTomado | null> {
  const { rows } = await pool.query(
    `UPDATE trabajos t SET estado = 'procesando', intentos = t.intentos + 1, toma = $1, worker = $2, tomado_en = now()
     WHERE t.id = (
       SELECT id FROM trabajos WHERE estado = 'pendiente' AND disponible_en <= now()
       ORDER BY disponible_en, creado LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING t.id, t.empresa_id, t.usuario_id, t.carga, t.intentos, t.max_intentos, t.toma`,
    [randomUUID(), worker]);
  if (rows.length === 0) return null;
  const f = rows[0];
  return { id: f.id, empresaId: f.empresa_id, usuarioId: f.usuario_id, carga: f.carga, intentos: f.intentos, maxIntentos: f.max_intentos, toma: f.toma };
}

// Dentro de la transacción que guarda el resultado. Si la toma ya no es nuestra (el trabajo se
// dio por perdido y lo tomó otro), devuelve false y quien llama hace ROLLBACK: nada se guarda dos veces.
export async function marcarHecho(cliente: PoolClient, trabajo: TrabajoTomado, conciliacionId: string): Promise<boolean> {
  const r = await cliente.query(
    `UPDATE trabajos SET estado = 'hecho', conciliacion_id = $3, terminado_en = now(), carga = NULL,
       error = NULL, error_detalles = NULL, toma = NULL
     WHERE id = $1 AND toma = $2 AND estado = 'procesando'`,
    [trabajo.id, trabajo.toma, conciliacionId]);
  return r.rowCount === 1;
}

// Error permanente (datos malos) o sin intentos -> fallido. Si no, vuelve a pendiente con espera.
export async function marcarError(pool: Pool, trabajo: TrabajoTomado, error: { mensaje: string; detalles?: unknown },
  opciones: { permanente: boolean; esperaMs: number }): Promise<EstadoTrabajo | null> {
  const { rows } = await pool.query(
    `UPDATE trabajos SET
       estado = CASE WHEN $3::boolean OR intentos >= max_intentos THEN 'fallido' ELSE 'pendiente' END,
       terminado_en = CASE WHEN $3::boolean OR intentos >= max_intentos THEN now() END,
       disponible_en = now() + make_interval(secs => $4::float8 / 1000),
       error = $5, error_detalles = $6, toma = NULL
     WHERE id = $1 AND toma = $2 RETURNING estado`,
    [trabajo.id, trabajo.toma, opciones.permanente, opciones.esperaMs, error.mensaje.slice(0, 2000),
      error.detalles === undefined ? null : JSON.stringify(error.detalles)]);
  return rows.length === 0 ? null : rows[0].estado as EstadoTrabajo;
}

// Un worker que murió a mitad deja trabajos en 'procesando' para siempre. Pasado el vencimiento
// se devuelven a la cola (o se dan por fallidos si ya no quedan intentos).
export async function recuperarVencidos(pool: Pool, vencimientoMs: number): Promise<number> {
  const r = await pool.query(
    `UPDATE trabajos SET
       estado = CASE WHEN intentos >= max_intentos THEN 'fallido' ELSE 'pendiente' END,
       terminado_en = CASE WHEN intentos >= max_intentos THEN now() END,
       error = 'El worker no terminó a tiempo (¿se cayó?); se devolvió a la cola.', toma = NULL
     WHERE estado = 'procesando' AND tomado_en < now() - make_interval(secs => $1::float8 / 1000)`,
    [vencimientoMs]);
  return r.rowCount ?? 0;
}

export async function obtenerTrabajo(pool: Pool, empresaId: string, id: string) {
  const { rows } = await pool.query(
    `SELECT id, estado, intentos, max_intentos, conciliacion_id, error, error_detalles, creado, tomado_en, terminado_en
     FROM trabajos WHERE id = $1 AND empresa_id = $2`, [id, empresaId]);
  if (rows.length === 0) return null;
  const f = rows[0];
  return {
    id: f.id as string,
    estado: f.estado as EstadoTrabajo,
    intentos: f.intentos as number,
    maxIntentos: f.max_intentos as number,
    conciliacionId: (f.conciliacion_id as string | null) ?? null,
    error: f.error === null ? null : { mensaje: f.error as string, ...(f.error_detalles !== null ? { detalles: f.error_detalles } : {}) },
    creado: (f.creado as Date).toISOString(),
    tomado: f.tomado_en ? (f.tomado_en as Date).toISOString() : null,
    terminado: f.terminado_en ? (f.terminado_en as Date).toISOString() : null,
  };
}

// Métricas de la cola para una empresa: conteo por estado y tiempos de los últimos 1000 terminados.
export async function metricasTrabajos(pool: Pool, empresaId: string) {
  const [conteo, tiempos] = await Promise.all([
    pool.query('SELECT estado, count(*)::int AS n FROM trabajos WHERE empresa_id = $1 GROUP BY estado', [empresaId]),
    pool.query(
      `WITH ultimos AS (
         SELECT extract(epoch FROM (terminado_en - tomado_en)) * 1000 AS proceso,
                extract(epoch FROM (tomado_en - creado)) * 1000 AS espera
         FROM trabajos WHERE empresa_id = $1 AND estado = 'hecho' AND terminado_en IS NOT NULL
         ORDER BY terminado_en DESC LIMIT 1000)
       SELECT count(*)::int AS n, avg(proceso) AS promedio, percentile_cont(0.95) WITHIN GROUP (ORDER BY proceso) AS p95,
              max(proceso) AS maximo, avg(espera) AS espera_promedio FROM ultimos`, [empresaId]),
  ]);
  const porEstado = Object.fromEntries(ESTADOS_TRABAJO.map((e) => [e, 0])) as Record<EstadoTrabajo, number>;
  for (const f of conteo.rows) porEstado[f.estado as EstadoTrabajo] = f.n;
  const t = tiempos.rows[0];
  const ms = (x: unknown) => (x === null ? null : Math.round(Number(x)));
  return {
    porEstado,
    tiempoProcesoMs: { muestras: t.n as number, promedio: ms(t.promedio), p95: ms(t.p95), maximo: ms(t.maximo) },
    esperaPromedioMs: ms(t.espera_promedio),
  };
}
