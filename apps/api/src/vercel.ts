// Entrada para Vercel Functions: una sola función atiende todo /api/*.
// Reutiliza el mismo enrutador que el servidor de Node; solo cambia cómo arranca.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { aplicarEsquema, crearPool } from './bd.ts';
import { crearManejador, registroPlantillas } from './rutas.ts';

type Manejador = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

// Se prepara una vez por instancia y se reutiliza entre peticiones (la instancia sigue viva un rato).
// El esquema es idempotente y lleva candado, así que dos instancias nuevas a la vez no chocan.
let preparado: Promise<Manejador> | undefined;

async function preparar(): Promise<Manejador> {
  registroPlantillas();
  // Cada instancia abre pocas conexiones: Neon ya agrupa con su pooler y las instancias son muchas.
  process.env.PG_MAX_CONEXIONES ??= '3';
  const pool = crearPool(process.env.DATABASE_URL);
  if (pool) await aplicarEsquema(pool);
  return crearManejador({ pool, corsOrigen: process.env.CORS_ORIGEN ?? '*' });
}

// Vercel puede entregar la ruta original (/api/salud) o la reescrita (/api?ruta=salud).
export function rutaInterna(url: string): string {
  const completa = new URL(url, 'http://local');
  const reescrita = completa.searchParams.get('ruta');
  completa.searchParams.delete('ruta');
  const ruta = reescrita !== null ? `/${reescrita}` : completa.pathname.replace(/^\/api(?=\/|$)/, '');
  return (ruta || '/') + completa.search;
}

export default async function manejar(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    preparado ??= preparar();
    const manejador = await preparado;
    req.url = rutaInterna(req.url ?? '/');
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
