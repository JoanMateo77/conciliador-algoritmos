// JWT HS256 propio con node:crypto (sin librerías). Solo se acepta HS256: un token con
// alg 'none' u otro algoritmo se rechaza antes de mirar la firma.
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface CargaJwt {
  sub: string;            // id de usuario
  emp: string;            // id de empresa
  rol: string;
  iat: number;            // segundos Unix
  exp: number;
}

export type ResultadoJwt = { ok: true; carga: CargaJwt } | { ok: false; motivo: 'formato' | 'firma' | 'vencido' };

const b64url = (datos: Buffer | string) => Buffer.from(datos).toString('base64url');
const ENCABEZADO = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

function firma(secreto: string, contenido: string): Buffer {
  return createHmac('sha256', secreto).update(contenido).digest();
}

export function firmarJwt(datos: { sub: string; emp: string; rol: string }, secreto: string,
  duracionSegundos: number, ahora = Date.now()): string {
  const iat = Math.floor(ahora / 1000);
  const carga = b64url(JSON.stringify({ ...datos, iat, exp: iat + duracionSegundos }));
  const contenido = `${ENCABEZADO}.${carga}`;
  return `${contenido}.${b64url(firma(secreto, contenido))}`;
}

export function verificarJwt(token: string, secreto: string, ahora = Date.now()): ResultadoJwt {
  const partes = token.split('.');
  if (partes.length !== 3 || partes.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return { ok: false, motivo: 'formato' };
  const [encabezado, carga, firmaRecibida] = partes;
  let cabecera: unknown;
  let datos: unknown;
  try {
    cabecera = JSON.parse(Buffer.from(encabezado, 'base64url').toString('utf8'));
    datos = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, motivo: 'formato' };
  }
  if (!esObjeto(cabecera) || cabecera.alg !== 'HS256') return { ok: false, motivo: 'formato' };

  // Comparación en tiempo constante: no se filtra cuántos bytes de la firma coinciden.
  const esperada = firma(secreto, `${encabezado}.${carga}`);
  const recibida = Buffer.from(firmaRecibida, 'base64url');
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return { ok: false, motivo: 'firma' };

  if (!esObjeto(datos) || typeof datos.sub !== 'string' || typeof datos.emp !== 'string' || typeof datos.rol !== 'string'
    || !Number.isInteger(datos.exp) || !Number.isInteger(datos.iat)) return { ok: false, motivo: 'formato' };
  if (Math.floor(ahora / 1000) >= (datos.exp as number)) return { ok: false, motivo: 'vencido' };
  return { ok: true, carga: datos as unknown as CargaJwt };
}

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
