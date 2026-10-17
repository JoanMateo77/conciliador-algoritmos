// Contraseñas con scrypt (node:crypto) y sal aleatoria por usuario. El texto guardado
// lleva los parámetros, así se pueden endurecer después sin invalidar los hashes viejos.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';

const N = 16384, R = 8, P = 1, LARGO = 64;

function derivar(contrasena: string, sal: Buffer, largo: number, opciones: ScryptOptions): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    scrypt(contrasena.normalize('NFC'), sal, largo, opciones, (error, clave) => (error ? rechazar(error) : resolver(clave)));
  });
}

export async function hashContrasena(contrasena: string): Promise<string> {
  const sal = randomBytes(16);
  const clave = await derivar(contrasena, sal, LARGO, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64')}$${clave.toString('base64')}`;
}

export async function verificarContrasena(contrasena: string, guardado: string): Promise<boolean> {
  const partes = guardado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [n, r, p] = partes.slice(1, 4).map(Number);
  const sal = Buffer.from(partes[4], 'base64');
  const esperada = Buffer.from(partes[5], 'base64');
  if (![n, r, p].every(Number.isInteger) || esperada.length === 0) return false;
  const clave = await derivar(contrasena, sal, esperada.length, { N: n, r, p, maxmem: 256 * n * r + 1024 * 1024 });
  return timingSafeEqual(clave, esperada);
}

// Hash de relleno: cuando el correo no existe se verifica contra este para que la respuesta
// tarde lo mismo y no delate qué correos están registrados.
let relleno: Promise<string> | undefined;
export function hashDeRelleno(): Promise<string> {
  relleno ??= hashContrasena(randomBytes(12).toString('base64'));
  return relleno;
}
