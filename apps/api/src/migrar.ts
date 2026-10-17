// Crea o actualiza las tablas en la base de DATABASE_URL. Es idempotente: se puede correr varias veces.
// Uso: DATABASE_URL=... npm run migrar
import { aplicarEsquema, crearPool } from './bd.ts';

const pool = crearPool(process.env.DATABASE_URL);
if (!pool) {
  console.error('Falta DATABASE_URL. Ejemplo: DATABASE_URL="postgres://..." npm run migrar');
  process.exit(1);
}
try {
  await aplicarEsquema(pool);
  const { rows } = await pool.query<{ tabla: string }>(
    "SELECT table_name AS tabla FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
  );
  console.log(`Esquema aplicado. Tablas: ${rows.map((r) => r.tabla).join(', ')}`);
} catch (error) {
  console.error('No se pudo aplicar el esquema:', (error as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
