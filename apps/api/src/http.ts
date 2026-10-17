// Utilidades HTTP sin framework: errores con código, lectura de cuerpo con límite y respuestas JSON.
import type { IncomingMessage, ServerResponse } from 'node:http';

export class ErrorHttp extends Error {
  estado: number;
  detalles?: unknown;
  constructor(estado: number, mensaje: string, detalles?: unknown) {
    super(mensaje);
    this.estado = estado;
    this.detalles = detalles;
  }
}

export const LIMITE_CUERPO = 2 * 1024 * 1024;

// Lee el cuerpo sin pasar del límite. Si se pasa, deja de guardar (memoria acotada)
// pero sigue drenando para poder responder 413 limpio.
export function leerCuerpo(req: IncomingMessage, limite = LIMITE_CUERPO): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const declarado = Number(req.headers['content-length']);
    if (Number.isFinite(declarado) && declarado > limite) {
      req.resume();
      rechazar(errorTamano(limite));
      return;
    }
    const partes: Buffer[] = [];
    let total = 0;
    let excedido = false;
    req.on('data', (parte: Buffer) => {
      if (excedido) return;
      total += parte.length;
      if (total > limite) {
        excedido = true;
        partes.length = 0;
        rechazar(errorTamano(limite));
      } else {
        partes.push(parte);
      }
    });
    req.on('end', () => { if (!excedido) resolver(Buffer.concat(partes).toString('utf8')); });
    req.on('error', rechazar);
  });
}

function errorTamano(limite: number): ErrorHttp {
  return new ErrorHttp(413, `El cuerpo supera el máximo permitido de ${Math.round(limite / 1024 / 1024)} MB.`);
}

export async function leerJson(req: IncomingMessage, limite = LIMITE_CUERPO): Promise<unknown> {
  const tipo = String(req.headers['content-type'] ?? '');
  if (!/^application\/json\b/i.test(tipo)) {
    req.resume();
    throw new ErrorHttp(415, 'El cuerpo debe enviarse como application/json.');
  }
  const texto = await leerCuerpo(req, limite);
  if (texto.trim() === '') throw new ErrorHttp(400, 'El cuerpo está vacío.');
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErrorHttp(400, 'El cuerpo no es JSON válido.');
  }
}

export function responder(res: ServerResponse, estado: number, cuerpo: unknown, cabeceras: Record<string, string> = {}): void {
  if (res.headersSent) return;
  const texto = estado === 204 ? '' : JSON.stringify(cuerpo);
  res.writeHead(estado, {
    ...(estado === 204 ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...cabeceras,
  });
  res.end(texto);
}

export function responderError(res: ServerResponse, error: ErrorHttp): void {
  // Sin 'Connection: close' a propósito: cerrar mientras el cliente aún sube el cuerpo
  // provoca un reset y el cliente nunca lee el 413. El resto se drena y descarta
  // (requestTimeout pone el tope).
  responder(res, error.estado, {
    error: { codigo: error.estado, mensaje: error.message, ...(error.detalles !== undefined ? { detalles: error.detalles } : {}) },
  });
}
