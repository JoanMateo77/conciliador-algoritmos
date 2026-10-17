// Entrada para Vercel Functions: una sola función atiende todo /api/*.
// Reutiliza el mismo enrutador que el servidor de Node; solo cambia cómo arranca.
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { aplicarEsquema, crearPool } from './bd.ts';
import { crearManejador, registroPlantillas } from './rutas.ts';
import { crearWorker } from './worker.ts';
import type { Worker } from './worker.ts';

type Manejador = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
interface Preparado { manejar: Manejador; worker: Worker | null }

// Se prepara una vez por instancia y se reutiliza entre peticiones (la instancia sigue viva un rato).
// Las migraciones son idempotentes y llevan candado, así que dos instancias nuevas a la vez no chocan.
let preparado: Promise<Preparado> | undefined;

// Con varias instancias, un secreto aleatorio por proceso invalidaría los tokens entre ellas.
// Si falta JWT_SECRETO se deriva uno estable de DATABASE_URL, que también es secreta.
export function secretoJwt(entorno: Record<string, string | undefined>): string | undefined {
  if (entorno.JWT_SECRETO) return entorno.JWT_SECRETO;
  if (!entorno.DATABASE_URL) return undefined;
  return createHash('sha256').update(`conciliador-jwt:${entorno.DATABASE_URL}`).digest('base64url');
}

async function preparar(): Promise<Preparado> {
  registroPlantillas();
  // Cada instancia abre pocas conexiones: Neon ya agrupa con su pooler y las instancias son muchas.
  process.env.PG_MAX_CONEXIONES ??= '3';
  const pool = crearPool(process.env.DATABASE_URL);
  if (pool) await aplicarEsquema(pool);
  const manejar = crearManejador({
    pool,
    corsOrigen: process.env.CORS_ORIGEN ?? '*',
    jwtSecreto: secretoJwt(process.env),
    // Vercel siempre está delante: la IP real del cliente viene en X-Forwarded-For.
    confiarProxy: true,
  });
  return { manejar, worker: pool ? crearWorker({ pool, nombre: 'vercel' }) : null };
}

// Vercel puede entregar la ruta original (/api/salud) o la reescrita (/api?ruta=salud).
export function rutaInterna(url: string): string {
  const completa = new URL(url, 'http://local');
  const reescrita = completa.searchParams.get('ruta');
  completa.searchParams.delete('ruta');
  const ruta = reescrita !== null ? `/${reescrita}` : completa.pathname.replace(/^\/api(?=\/|$)/, '');
  return (ruta || '/') + completa.search;
}

// En Vercel no hay un proceso worker que corra siempre. El panel consulta GET /trabajos/:id
// mientras espera, y cada consulta procesa antes un trabajo pendiente: la cola avanza al ritmo del sondeo.
export function debeProcesarCola(metodo: string | undefined, ruta: string): boolean {
  return metodo === 'GET' && /^\/trabajos\/[^/?]+/.test(ruta);
}

export default async function manejar(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    preparado ??= preparar();
    const { manejar: manejador, worker } = await preparado;
    req.url = rutaInterna(req.url ?? '/');
    if (worker && debeProcesarCola(req.method, req.url)) {
      // Un fallo del trabajo queda registrado en la cola (reintentos); no debe tumbar la consulta.
      await worker.procesarUno().catch((error) => console.error('No se pudo procesar un trabajo:', error));
    }
    await manejador(req, res);
  } catch (error) {
    // Si la preparación falla (p. ej. base caída), se reintenta en la próxima petición.
    preparado = undefined;
    console.error('No se pudo atender la petición:', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { codigo: 500, mensaje: 'La API no pudo iniciar. Revisa DATABASE_URL y los registros de Vercel.' } }));
    }
  }
}
