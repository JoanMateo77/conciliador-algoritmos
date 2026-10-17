// Utilidades compartidas por las pruebas de la API (no es un archivo de pruebas).
// Cada archivo de pruebas con base de datos crea SU base con nombre único: así corren en
// paralelo con las demás (y con otros agentes) sin pisarse, sobre todo la cola de trabajos.
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import pg from 'pg';
import { MUESTRAS } from '@conciliador/plantillas';
import { crearServidor } from '../src/servidor.ts';

export const URL_PRUEBA = process.env.DATABASE_URL_PRUEBA;

export async function crearBaseUnica(prefijo: string): Promise<{ url: string; borrar: () => Promise<void> }> {
  if (!URL_PRUEBA) throw new Error('Falta DATABASE_URL_PRUEBA');
  const nombre = `conciliador_${prefijo}_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: URL_PRUEBA });
  await admin.connect();
  try { await admin.query(`CREATE DATABASE ${nombre}`); } finally { await admin.end(); }
  const url = new URL(URL_PRUEBA);
  url.pathname = `/${nombre}`;
  return {
    url: url.toString(),
    borrar: async () => {
      const c = new pg.Client({ connectionString: URL_PRUEBA });
      await c.connect();
      try { await c.query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`); } finally { await c.end(); }
    },
  };
}

export async function levantar(opciones: Parameters<typeof crearServidor>[0]) {
  const servidor = crearServidor(opciones);
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  const { port } = servidor.address() as AddressInfo;
  return { servidor, base: `http://127.0.0.1:${port}` };
}
export const cerrar = (s: Server) => new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()); });

export function muestra(id: string) {
  const m = MUESTRAS.find((x) => x.id === id);
  if (!m) throw new Error(`Falta la muestra ${id}`);
  return m;
}

export const PERFIL_DEMO = {
  id: 'demo', nombre: 'Demo Tienda La Ceiba',
  toleranciaFaltanteCentavos: 0, toleranciaFaltantePorcentaje: 0.05, toleranciaSobranteCentavos: 0,
  ventanaDias: 4, diasDespues: 1, maxGrupo: 8, umbralAutomatico: 0.9, umbralSugerencia: 0.6,
  retenciones: [{ nombre: 'ReteFuente', tasa: 0.015 }],
};

export const cuerpoValido = () => ({
  banco: { nombre: 'extracto-banco.csv', texto: muestra('extracto-banco').texto },
  ventas: { nombre: 'ventas-wompi.csv', texto: muestra('ventas-wompi').texto },
  perfil: PERFIL_DEMO,
});

// Cliente HTTP mínimo con token opcional.
export function cliente(base: string, token?: string) {
  const cabeceras = (extra: Record<string, string> = {}) => ({ ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra });
  return {
    get: (ruta: string) => fetch(`${base}${ruta}`, { headers: cabeceras() }),
    post: (ruta: string, cuerpo?: unknown) => fetch(`${base}${ruta}`, {
      method: 'POST', headers: cabeceras(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }),
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    }),
  };
}

// Espera activa con tope, para condiciones que dependen de otro proceso o de workers en segundo plano.
export async function esperarHasta(condicion: () => Promise<boolean>, topeMs = 20_000, pasoMs = 50): Promise<void> {
  const fin = Date.now() + topeMs;
  while (Date.now() < fin) {
    if (await condicion()) return;
    await new Promise((r) => setTimeout(r, pasoMs));
  }
  throw new Error(`La condición no se cumplió en ${topeMs} ms`);
}
