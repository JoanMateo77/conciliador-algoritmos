// Consultas de la API. Cada operación que escribe va en UNA transacción:
// o queda todo guardado o no queda nada.
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Movimiento, Perfil, ResultadoConciliacion, Coincidencia } from '@conciliador/core';
import { enTransaccion } from './bd.ts';
import { ErrorHttp } from './http.ts';

export type EstadoRevision = 'automatica' | 'sugerida' | 'confirmada' | 'rechazada';
export type Accion = 'confirmar' | 'rechazar';

export interface DatosConciliacion {
  id?: string;                 // opcional: lo usan las pruebas para buscar la fila después
  archivoBanco: string; archivoVentas: string;
  plantillaBanco: string; plantillaVentas: string;
  perfil: Perfil;
  banco: Movimiento[]; ventas: Movimiento[];
  resultado: ResultadoConciliacion;
}

// bigint llega como texto desde pg; los centavos caben en un entero seguro.
const entero = (valor: unknown): number => Number(valor);

export async function guardarConciliacion(pool: Pool, datos: DatosConciliacion): Promise<string> {
  const id = datos.id ?? randomUUID();
  const { resultado } = datos;
  const { coincidencias, ...detalle } = resultado;

  // Qué coincidencia ocupa a cada movimiento, para guardarlo ya enlazado.
  const ocupado = new Map<string, string>();
  for (const c of coincidencias) {
    for (const b of c.bancoIds) ocupado.set(`banco|${b}`, c.id);
    for (const v of c.ventasIds) ocupado.set(`ventas|${v}`, c.id);
  }

  await enTransaccion(pool, async (cliente) => {
    await cliente.query(
      `INSERT INTO conciliaciones (id, archivo_banco, archivo_ventas, plantilla_banco, plantilla_ventas, perfil, resumen, detalle)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, datos.archivoBanco, datos.archivoVentas, datos.plantillaBanco, datos.plantillaVentas,
        JSON.stringify(datos.perfil), JSON.stringify(resultado.resumen), JSON.stringify(detalle)],
    );

    // Un solo INSERT por tabla (jsonb_to_recordset) en vez de uno por fila: miles de filas en un viaje.
    if (coincidencias.length > 0) {
      await cliente.query(
        `INSERT INTO coincidencias (conciliacion_id, id, orden, tipo, banco_ids, ventas_ids, puntaje,
           diferencia_centavos, explicacion, estado_inicial, estado)
         SELECT $1, r.id, r.orden, r.tipo,
           ARRAY(SELECT jsonb_array_elements_text(r.banco)), ARRAY(SELECT jsonb_array_elements_text(r.ventas)),
           r.puntaje, r.diferencia, r.explicacion, r.estado, r.estado
         FROM jsonb_to_recordset($2::jsonb) AS r(id text, orden int, tipo text, banco jsonb, ventas jsonb,
           puntaje float8, diferencia bigint, explicacion text, estado text)`,
        [id, JSON.stringify(coincidencias.map((c, orden) => ({
          id: c.id, orden, tipo: c.tipo, banco: c.bancoIds, ventas: c.ventasIds, puntaje: c.puntaje,
          diferencia: c.diferenciaCentavos, explicacion: c.explicacion, estado: c.estado,
        })))],
      );
    }

    const filas = [...datos.banco, ...datos.ventas].map((m) => ({
      lado: m.lado, id: m.id, fecha: m.fecha, monto: m.montoCentavos, referencia: m.referencia,
      descripcion: m.descripcion, referencia_pago: m.referenciaPago ?? null, desglose: m.desglose ?? null,
      plantilla: m.plantilla, linea: m.linea, coincidencia: ocupado.get(`${m.lado}|${m.id}`) ?? null,
    }));
    if (filas.length > 0) {
      await cliente.query(
        `INSERT INTO movimientos (conciliacion_id, lado, id, fecha, monto_centavos, referencia, descripcion,
           referencia_pago, desglose, plantilla, linea, coincidencia_id)
         SELECT $1, r.lado, r.id, r.fecha, r.monto, r.referencia, r.descripcion, r.referencia_pago,
           r.desglose, r.plantilla, r.linea, r.coincidencia
         FROM jsonb_to_recordset($2::jsonb) AS r(lado text, id text, fecha date, monto bigint, referencia text,
           descripcion text, referencia_pago text, desglose jsonb, plantilla text, linea int, coincidencia text)`,
        [id, JSON.stringify(filas)],
      );
    }
  });
  return id;
}

export async function listarConciliaciones(pool: Pool, limite: number) {
  const { rows } = await pool.query(
    `SELECT c.id, c.creada, c.archivo_banco, c.archivo_ventas, c.plantilla_banco, c.plantilla_ventas, c.resumen,
       count(k.id) FILTER (WHERE k.estado = 'confirmada') AS confirmadas,
       count(k.id) FILTER (WHERE k.estado = 'rechazada') AS rechazadas,
       count(k.id) FILTER (WHERE k.estado IN ('automatica', 'sugerida')) AS pendientes
     FROM conciliaciones c LEFT JOIN coincidencias k ON k.conciliacion_id = c.id
     GROUP BY c.id ORDER BY c.creada DESC, c.id LIMIT $1`,
    [limite],
  );
  return rows.map((f) => ({
    id: f.id as string,
    creada: (f.creada as Date).toISOString(),
    archivos: { banco: f.archivo_banco, ventas: f.archivo_ventas },
    plantillas: { banco: f.plantilla_banco, ventas: f.plantilla_ventas },
    resumen: f.resumen,
    revision: { confirmadas: entero(f.confirmadas), rechazadas: entero(f.rechazadas), pendientes: entero(f.pendientes) },
  }));
}

export async function obtenerConciliacion(pool: Pool, id: string) {
  const conciliacion = await pool.query(
    'SELECT id, creada, archivo_banco, archivo_ventas, plantilla_banco, plantilla_ventas, perfil, detalle FROM conciliaciones WHERE id = $1',
    [id],
  );
  if (conciliacion.rowCount === 0) return null;
  const fila = conciliacion.rows[0];
  const [coincidencias, eventos, libres] = await Promise.all([
    pool.query('SELECT * FROM coincidencias WHERE conciliacion_id = $1 ORDER BY orden', [id]),
    pool.query('SELECT coincidencia_id, tipo, estado_anterior, estado_nuevo, creado FROM eventos WHERE conciliacion_id = $1 ORDER BY id', [id]),
    pool.query('SELECT lado, id FROM movimientos WHERE conciliacion_id = $1 AND coincidencia_id IS NULL ORDER BY lado, linea, id', [id]),
  ]);

  // El resultado se devuelve tal como lo produjo el motor (estados iniciales);
  // las decisiones humanas van aparte en `estados` y `bitacora`.
  const lista: Coincidencia[] = coincidencias.rows.map((c) => ({
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
    resultado: { ...fila.detalle, coincidencias: lista } as ResultadoConciliacion,
    estados,
    bitacora: eventos.rows.map((e) => ({
      tipo: e.tipo, coincidenciaId: e.coincidencia_id, estadoAnterior: e.estado_anterior,
      estadoNuevo: e.estado_nuevo, fecha: (e.creado as Date).toISOString(),
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

export async function decidir(pool: Pool, conciliacionId: string, coincidenciaId: string, accion: Accion) {
  return enTransaccion(pool, async (cliente) => {
    // FOR UPDATE: dos revisores a la vez sobre la misma coincidencia se ponen en fila.
    const actual = await cliente.query(
      'SELECT estado, banco_ids, ventas_ids FROM coincidencias WHERE conciliacion_id = $1 AND id = $2 FOR UPDATE',
      [conciliacionId, coincidenciaId],
    );
    if (actual.rowCount === 0) throw new ErrorHttp(404, 'La coincidencia no existe en esta conciliación.');
    const anterior = actual.rows[0].estado as EstadoRevision;
    if (!PERMITIDOS[accion].includes(anterior)) {
      throw new ErrorHttp(409, `No se puede ${accion} una coincidencia en estado "${anterior}".`);
    }
    const nuevo = NUEVO[accion];
    await cliente.query(
      'UPDATE coincidencias SET estado = $3, actualizada = now() WHERE conciliacion_id = $1 AND id = $2',
      [conciliacionId, coincidenciaId, nuevo],
    );
    const evento = await registrarEvento(cliente, conciliacionId, coincidenciaId, accion, anterior, nuevo);

    let liberados: { banco: string[]; ventas: string[] } | undefined;
    if (accion === 'rechazar') {
      const libres = await cliente.query(
        `UPDATE movimientos SET coincidencia_id = NULL WHERE conciliacion_id = $1 AND coincidencia_id = $2
         RETURNING lado, id`,
        [conciliacionId, coincidenciaId],
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
  tipo: Accion, anterior: EstadoRevision, nuevo: EstadoRevision) {
  const { rows } = await cliente.query(
    `INSERT INTO eventos (conciliacion_id, coincidencia_id, tipo, estado_anterior, estado_nuevo)
     VALUES ($1, $2, $3, $4, $5) RETURNING creado`,
    [conciliacionId, coincidenciaId, tipo, anterior, nuevo],
  );
  return { tipo, coincidenciaId, fecha: (rows[0].creado as Date).toISOString() };
}
