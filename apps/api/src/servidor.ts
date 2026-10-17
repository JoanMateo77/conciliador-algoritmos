// Arranque de la API: lee variables de entorno, prepara la base (si hay) y escucha en PORT.
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import { aplicarEsquema, crearPool } from './bd.ts';
import { registrar } from './registros.ts';
import { crearManejador, registroPlantillas } from './rutas.ts';
import type { OpcionesRutas } from './rutas.ts';

export function crearServidor(opciones: OpcionesRutas): http.Server {
  const manejar = crearManejador(opciones);
  const servidor = http.createServer((req, res) => { void manejar(req, res); });
  // Cortes razonables para que un cliente lento no retenga conexiones para siempre.
  servidor.requestTimeout = 60_000;
  servidor.headersTimeout = 20_000;
  return servidor;
}

export async function iniciar(): Promise<{ servidor: http.Server; pool: Pool | null }> {
  registroPlantillas(); // falla aquí, no en la primera petición, si una plantilla es inválida
  const pool = crearPool(process.env.DATABASE_URL);
  if (pool) await aplicarEsquema(pool);
  else registrar('aviso', 'modo_memoria', { mensaje: 'Sin DATABASE_URL: no se guardan conciliaciones.' });

  const servidor = crearServidor({ pool, corsOrigen: process.env.CORS_ORIGEN ?? '*' });
  const puerto = Number(process.env.PORT ?? 3000);
  await new Promise<void>((resolver) => servidor.listen(puerto, resolver));
  registrar('info', 'api_iniciada', { puerto, baseDeDatos: pool !== null });

  // Render manda SIGTERM al redesplegar: se terminan las peticiones en curso y se cierra el pool.
  const apagar = () => {
    registrar('info', 'api_apagando');
    servidor.close(() => { void (pool?.end() ?? Promise.resolve()).then(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', apagar);
  process.once('SIGINT', apagar);
  return { servidor, pool };
}

// import.meta.main solo existe desde Node 24.2; esta comparación funciona en 22.18+.
const esPrincipal = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (esPrincipal) {
  iniciar().catch((error) => {
    registrar('error', 'api_no_inicio', { error });
    process.exit(1);
  });
}
