// Acceso a PostgreSQL: pool, esquema y transacciones.
import pg from 'pg';
import type { Pool, PoolClient } from 'pg';
import { aplicarMigraciones } from './migraciones.ts';
import { registrar } from './registros.ts';

// Sin DATABASE_URL la API sigue viva en modo memoria: devuelve null.
export function crearPool(url: string | undefined = process.env.DATABASE_URL): Pool | null {
  if (!url) return null;
  const pool = new pg.Pool({
    connectionString: url,
    ssl: opcionesSsl(url),
    max: Number(process.env.PG_MAX_CONEXIONES ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // Un cliente inactivo que se cae (p. ej. Neon suspende la base) no debe tumbar el proceso.
  pool.on('error', (error: Error) => registrar('error', 'pool_conexion_inactiva', { mensaje: error.message }));
  return pool;
}

// Si la URL ya dice sslmode, pg lo interpreta; si no, en producción se exige SSL.
export function opcionesSsl(url: string): boolean | undefined {
  if (/[?&](sslmode|ssl)=/i.test(url)) return undefined;
  return process.env.NODE_ENV === 'production' ? true : undefined;
}

// Lleva la base a la última versión (src/migraciones/*.sql). Se conserva el nombre del MVP.
export async function aplicarEsquema(pool: Pool): Promise<void> {
  await aplicarMigraciones(pool);
}

// BEGIN/COMMIT con el mismo cliente; ante cualquier error, ROLLBACK y se relanza.
export async function enTransaccion<T>(pool: Pool, trabajo: (cliente: PoolClient) => Promise<T>): Promise<T> {
  const cliente = await pool.connect();
  let conexionRota = false;
  try {
    await cliente.query('BEGIN');
    const resultado = await trabajo(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    // Si ni el ROLLBACK funciona la conexión quedó inservible: se descarta del pool.
    await cliente.query('ROLLBACK').catch(() => { conexionRota = true; });
    throw error;
  } finally {
    cliente.release(conexionRota);
  }
}

// Ping con tiempo límite para /salud: una base caída no debe colgar la respuesta.
export async function baseDisponible(pool: Pool | null, limiteMs = 2_000): Promise<boolean> {
  if (!pool) return false;
  let temporizador: NodeJS.Timeout | undefined;
  const tiempo = new Promise<boolean>((resolver) => { temporizador = setTimeout(() => resolver(false), limiteMs); });
  try {
    return await Promise.race([pool.query('SELECT 1').then(() => true, () => false), tiempo]);
  } finally {
    clearTimeout(temporizador);
  }
}
