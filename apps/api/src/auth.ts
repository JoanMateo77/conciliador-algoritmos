// Quién hace la petición. Sin token se opera en la empresa pública 'demo' (las rutas del MVP
// siguen igual); con token, en la empresa del usuario y con su rol.
import type { IncomingMessage } from 'node:http';
import type { Pool } from 'pg';
import { ErrorHttp } from './http.ts';
import { verificarJwt } from './jwt.ts';

export type Rol = 'admin' | 'analista' | 'lector';
export const ROLES: Rol[] = ['admin', 'analista', 'lector'];
const NIVEL: Record<Rol, number> = { lector: 1, analista: 2, admin: 3 };

// Fijo en la migración 002: las filas del MVP quedaron en esta empresa.
export const EMPRESA_DEMO_ID = '00000000-0000-4000-8000-000000000001';

export interface Contexto {
  empresaId: string;
  usuarioId: string | null;   // null = visitante anónimo de la demo
  rol: Rol;
  anonimo: boolean;
}

// El visitante de la demo puede conciliar y decidir, como en el MVP; no administra nada.
export const CONTEXTO_DEMO: Contexto = Object.freeze({ empresaId: EMPRESA_DEMO_ID, usuarioId: null, rol: 'analista', anonimo: true });

export const esRol = (x: unknown): x is Rol => typeof x === 'string' && (ROLES as string[]).includes(x);

export async function autenticar(req: IncomingMessage, pool: Pool | null, secreto: string): Promise<Contexto> {
  const cabecera = req.headers.authorization;
  if (cabecera === undefined || cabecera.trim() === '') return CONTEXTO_DEMO;
  const m = /^Bearer\s+(\S+)$/i.exec(cabecera.trim());
  // Un token presente pero inválido NO cae a la demo: así un error del cliente no escribe en el espacio público.
  if (!m) throw errorToken('La cabecera Authorization debe ser "Bearer <token>".');
  const r = verificarJwt(m[1], secreto);
  if (!r.ok) throw errorToken(r.motivo === 'vencido' ? 'El token venció; ingrese de nuevo.' : 'El token no es válido.');
  if (!pool) throw new ErrorHttp(503, 'La autenticación necesita base de datos y la API corre en modo memoria (sin DATABASE_URL).');
  // Se relee el usuario en cada petición: desactivarlo o cambiarle el rol aplica de inmediato.
  const { rows } = await pool.query('SELECT empresa_id, rol FROM usuarios WHERE id = $1 AND activo', [r.carga.sub]);
  if (rows.length === 0 || rows[0].empresa_id !== r.carga.emp) throw errorToken('El usuario del token no existe o está inactivo.');
  return { empresaId: rows[0].empresa_id, usuarioId: r.carga.sub, rol: rows[0].rol as Rol, anonimo: false };
}

export function exigirRol(ctx: Contexto, minimo: Rol, requiereToken = false): void {
  if (requiereToken && ctx.anonimo) throw errorToken('Esta ruta necesita iniciar sesión (Authorization: Bearer <token>).');
  if (NIVEL[ctx.rol] < NIVEL[minimo]) throw new ErrorHttp(403, `Esta acción requiere el rol "${minimo}" o superior; su rol es "${ctx.rol}".`);
}

function errorToken(mensaje: string): ErrorHttp {
  return new ErrorHttp(401, mensaje);
}

// ---------- Límite de velocidad ----------

// Ventana fija por clave (IP). Memoria acotada: las ventanas vencidas se barren al pasar el tope.
export class LimitadorVelocidad {
  #maximo: number;
  #ventanaMs: number;
  #cubetas = new Map<string, { inicio: number; conteo: number }>();
  constructor(maximo: number, ventanaMs: number) {
    this.#maximo = maximo;
    this.#ventanaMs = ventanaMs;
  }

  // Devuelve null si pasa, o los segundos a esperar si se excedió.
  consumir(clave: string, ahora = Date.now()): number | null {
    if (this.#cubetas.size > 10_000) {
      for (const [k, c] of this.#cubetas) if (ahora - c.inicio >= this.#ventanaMs) this.#cubetas.delete(k);
    }
    let c = this.#cubetas.get(clave);
    if (!c || ahora - c.inicio >= this.#ventanaMs) {
      c = { inicio: ahora, conteo: 0 };
      this.#cubetas.set(clave, c);
    }
    c.conteo++;
    if (c.conteo <= this.#maximo) return null;
    return Math.max(1, Math.ceil((c.inicio + this.#ventanaMs - ahora) / 1000));
  }
}

// Detrás de un proxy (Render) la IP real llega en X-Forwarded-For. Se toma el último valor,
// que es el que agregó el proxy propio; los anteriores los puede inventar el cliente.
export function ipDe(req: IncomingMessage, confiarProxy: boolean): string {
  if (confiarProxy) {
    const xff = req.headers['x-forwarded-for'];
    const texto = Array.isArray(xff) ? xff.join(',') : xff;
    const ultima = texto?.split(',').map((s) => s.trim()).filter(Boolean).pop();
    if (ultima) return ultima;
  }
  return req.socket.remoteAddress ?? 'desconocida';
}
