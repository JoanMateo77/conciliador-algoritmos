// Parser CSV propio (RFC 4180 con tolerancias): comillas dobles, "" como comilla
// escapada, separadores y saltos de línea dentro de comillas, CRLF y BOM.
// Recorre el texto una sola vez: O(largo del texto).
import type { ErrorDeLinea } from './tipos.ts';

export interface FilaCSV {
  celdas: string[];
  linea: number; // línea donde empieza la fila (1 = primera); una celda con salto puede ocupar varias
}

export const SEPARADORES_CANDIDATOS = [',', ';', '\t', '|'];

export function quitarBOM(texto: string): string {
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

// Encabezados comparables: sin espacios sobrantes, mayúsculas y sin tildes.
// "Descripción " y "DESCRIPCION" son la misma columna.
export function normalizarEncabezado(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
}

// Cuenta cada candidato fuera de comillas en las primeras líneas y elige el que
// aparece de forma más pareja (mismo número en cada línea) y más veces.
export function detectarSeparador(texto: string): string {
  const lineas = quitarBOM(texto).split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 5);
  let mejor = ',';
  let mejorPuntaje = 0;
  for (const sep of SEPARADORES_CANDIDATOS) {
    const conteos = lineas.map((l) => contarFueraDeComillas(l, sep));
    const minimo = Math.min(...conteos);
    // El mínimo premia la consistencia: un ';' suelto en una descripción no gana.
    const puntaje = minimo > 0 ? minimo * 1000 + conteos[0] : conteos[0] ?? 0;
    if (puntaje > mejorPuntaje) { mejor = sep; mejorPuntaje = puntaje; }
  }
  return mejor;
}

function contarFueraDeComillas(linea: string, sep: string): number {
  let n = 0;
  let enComillas = false;
  for (const c of linea) {
    if (c === '"') enComillas = !enComillas;
    else if (c === sep && !enComillas) n++;
  }
  return n;
}

export function parsearCSV(texto: string, separador: string): { filas: FilaCSV[]; errores: ErrorDeLinea[] } {
  const t = quitarBOM(texto);
  const filas: FilaCSV[] = [];
  const errores: ErrorDeLinea[] = [];
  let celdas: string[] = [];
  let celda = '';
  let enComillas = false;
  let lineaActual = 1;
  let lineaFila = 1;
  let lineaComilla = 0;
  let filaTieneContenido = false;

  const cerrarFila = () => {
    celdas.push(celda);
    // Las filas totalmente vacías (líneas en blanco) no cuentan.
    if (filaTieneContenido || celdas.length > 1 || celda !== '') filas.push({ celdas, linea: lineaFila });
    celdas = [];
    celda = '';
    filaTieneContenido = false;
  };

  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (enComillas) {
      if (c === '"') {
        if (t[i + 1] === '"') { celda += '"'; i++; } // comilla escapada
        else enComillas = false;
      } else {
        if (c === '\n') lineaActual++;
        celda += c;
      }
      continue;
    }
    if (c === '"' && celda === '') { enComillas = true; filaTieneContenido = true; lineaComilla = lineaActual; }
    else if (c === separador) { celdas.push(celda); celda = ''; filaTieneContenido = true; }
    else if (c === '\r' && t[i + 1] === '\n') { /* el \n siguiente cierra la fila */ }
    else if (c === '\n') { cerrarFila(); lineaActual++; lineaFila = lineaActual; }
    else celda += c; // una comilla en medio de una celda sin comillas se toma literal
  }
  if (enComillas) {
    errores.push({ linea: lineaComilla, mensaje: 'comilla sin cerrar: el resto del archivo quedó dentro de una celda' });
  }
  if (celda !== '' || celdas.length > 0 || filaTieneContenido) cerrarFila();
  return { filas, errores };
}
