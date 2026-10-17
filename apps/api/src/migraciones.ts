// Migraciones ordenadas e idempotentes. Cada archivo NNN_nombre.sql corre UNA vez, en su
// propia transacción, y queda anotado en la tabla `migraciones` con su suma SHA-256.
// Un candado de sesión evita que dos instancias que arrancan a la vez migren al mismo tiempo.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { registrar } from './registros.ts';

const CARPETA = new URL('./migraciones/', import.meta.url);
const CANDADO = 4815162342; // el mismo número que usaba el MVP para su esquema

export interface Migracion { version: string; nombre: string; sql: string; suma: string }

export async function leerMigraciones(): Promise<Migracion[]> {
  const archivos = (await readdir(CARPETA)).filter((a) => /^\d{3}_[\w-]+\.sql$/.test(a)).sort();
  return Promise.all(archivos.map(async (archivo) => {
    const sql = await readFile(new URL(archivo, CARPETA), 'utf8');
    return { version: archivo.slice(0, 3), nombre: archivo, sql, suma: createHash('sha256').update(sql).digest('hex') };
  }));
}

// Devuelve las versiones que aplicó en esta llamada (vacío si la base ya estaba al día).
export async function aplicarMigraciones(pool: Pool): Promise<string[]> {
  const migraciones = await leerMigraciones();
  const cliente = await pool.connect();
  const aplicadas: string[] = [];
  let conexionRota = false;
  try {
    await cliente.query('SELECT pg_advisory_lock($1)', [CANDADO]);
    try {
      await cliente.query(`CREATE TABLE IF NOT EXISTS migraciones (
        version text PRIMARY KEY, nombre text NOT NULL, suma text NOT NULL, aplicada timestamptz NOT NULL DEFAULT now())`);
      const { rows } = await cliente.query('SELECT version, suma FROM migraciones');
      const hechas = new Map(rows.map((f) => [f.version as string, f.suma as string]));
      for (const m of migraciones) {
        const suma = hechas.get(m.version);
        if (suma !== undefined) {
          // No se vuelve a correr: editar una migración aplicada no la reaplica. Se avisa.
          if (suma !== m.suma) registrar('aviso', 'migracion_modificada', { version: m.version, nombre: m.nombre });
          continue;
        }
        try {
          await cliente.query('BEGIN');
          await cliente.query(m.sql);
          await cliente.query('INSERT INTO migraciones (version, nombre, suma) VALUES ($1, $2, $3)', [m.version, m.nombre, m.suma]);
          await cliente.query('COMMIT');
        } catch (error) {
          await cliente.query('ROLLBACK').catch(() => { conexionRota = true; });
          throw new Error(`Falló la migración ${m.nombre}: ${(error as Error).message}`, { cause: error });
        }
        aplicadas.push(m.version);
        registrar('info', 'migracion_aplicada', { version: m.version, nombre: m.nombre });
      }
    } finally {
      await cliente.query('SELECT pg_advisory_unlock($1)', [CANDADO]).catch(() => { conexionRota = true; });
    }
  } finally {
    cliente.release(conexionRota);
  }
  return aplicadas;
}
