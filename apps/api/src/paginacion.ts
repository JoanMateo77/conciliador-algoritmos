// Paginación por cursor (keyset): en vez de OFFSET, el cursor guarda la clave de la última
// fila vista y la siguiente página empieza justo después. Cuesta lo mismo en la página 1 que en la 1000
// y no salta ni repite filas si entran nuevas mientras se pagina.
import { ErrorHttp } from './http.ts';

export interface Pagina<T> { elementos: T[]; siguiente: string | null }
export interface PedidoPagina { limite: number; cursor: string[] | null }

export function codificarCursor(clave: (string | number)[]): string {
  return Buffer.from(JSON.stringify(clave.map(String))).toString('base64url');
}

export function leerPaginacion(url: URL, partesCursor: number, porDefecto = 50, maximo = 200): PedidoPagina {
  const texto = url.searchParams.get('limite');
  const limite = texto === null ? porDefecto : Number(texto);
  if (!Number.isInteger(limite) || limite < 1 || limite > maximo) {
    throw new ErrorHttp(400, `El parámetro "limite" debe ser un entero entre 1 y ${maximo}.`);
  }
  const crudo = url.searchParams.get('cursor');
  if (crudo === null || crudo === '') return { limite, cursor: null };
  let cursor: unknown;
  try {
    cursor = JSON.parse(Buffer.from(crudo, 'base64url').toString('utf8'));
  } catch {
    cursor = null;
  }
  if (!Array.isArray(cursor) || cursor.length !== partesCursor || !cursor.every((x) => typeof x === 'string' && x.length <= 100)) {
    throw new ErrorHttp(400, 'El parámetro "cursor" no es válido; use el valor de la cabecera X-Cursor-Siguiente.');
  }
  return { limite, cursor };
}

// Se piden limite + 1 filas: si llega la extra, hay otra página y su cursor es la clave de la última mostrada.
export function cortarPagina<F, T>(filas: F[], limite: number, clave: (f: F) => (string | number)[], mapear: (f: F) => T): Pagina<T> {
  const hayMas = filas.length > limite;
  const visibles = hayMas ? filas.slice(0, limite) : filas;
  return {
    elementos: visibles.map(mapear),
    siguiente: hayMas ? codificarCursor(clave(visibles[visibles.length - 1])) : null,
  };
}
