// Tipos de las plantillas. Una plantilla es JSON puro: agregar un banco nuevo es
// agregar un JSON, sin código. Ver docs/CONTRATOS.md sección 3.
import type { Movimiento } from '../modelo.ts';

// Lista en tiempo de ejecución para validar; el tipo sale de aquí para no duplicarla.
export const CAMPOS_DESTINO = [
  'id', 'fecha', 'monto', 'referencia', 'descripcion', 'referenciaPago',
  'bruto', 'comision', 'ivaComision', 'retenciones',
] as const;

export type CampoDestino = typeof CAMPOS_DESTINO[number];

// Tipos con lector incluido. 'delimitado' y 'anchoFijo' son declarativos; el resto usa
// un LectorFormato registrado (ver lectores.ts).
export const TIPOS_PLANTILLA = ['delimitado', 'anchoFijo', 'mt940', 'camt053'] as const;
export type TipoPlantilla = typeof TIPOS_PLANTILLA[number];

export interface MapeoDetallado {
  de?: string;                  // columna origen (delimitado), nombre o "#n" (1 = primera)
  inicio?: number;              // ancho fijo: posición 1-based
  longitud?: number;            // ancho fijo
  unir?: string[];              // concatena varias columnas con espacio
  regex?: string;               // se toma el grupo 1 (o el match completo)
  decimalesImplicitos?: number; // montos sin separador (Asobancaria)
  signo?: 'negar' | 'abs';
  fijo?: string;                // valor constante
  opcional?: boolean;           // delimitado: si la columna no está en el archivo, el campo queda vacío
  registro?: string;            // ancho fijo: lee de la última línea de ese tipo (ej. la fecha del encabezado '01')
}

// delimitado: nombre de columna (o índice "#3"); ancho fijo: solo la forma detallada
export type Mapeo = string | MapeoDetallado;

export interface Plantilla {
  id: string;
  nombre: string;
  version: number;
  lado: 'banco' | 'ventas';
  descripcion?: string;
  fuente?: string;                // de dónde sale el formato (documentación pública)
  tipo: TipoPlantilla;
  hoja?: string;                  // Excel: hoja a leer (la usa @conciliador/excel; el núcleo la ignora)
  codificacion?: 'utf-8' | 'latin1'; // la decodifica quien lee el archivo (panel/API)
  separador?: string;             // delimitado; si falta se detecta entre , ; \t |
  separadorDecimal?: ',' | '.';   // por defecto ','
  formatoFecha: string;           // ej. 'dd/MM/yyyy', 'yyyy-MM-dd', 'yyyyMMdd'
  filasEncabezado?: number;       // delimitado: por defecto 1
  registroDetalle?: { inicio: number; longitud: number; valor: string }; // ancho fijo: qué líneas leer
  omitirSi?: { campo: string; regex: string }[]; // descarta filas (totales, saldos, rechazadas)
  soloEntradas?: boolean;         // descarta montos <= 0
  detectar?: { encabezados?: string[]; prefijoLinea?: string };
  columnas: Partial<Record<CampoDestino, Mapeo>>; // fecha y monto obligatorios
}

export interface ErrorDeLinea {
  linea: number;   // 1 = primera línea del archivo; 0 = el archivo completo
  mensaje: string;
}

export interface ResultadoLectura {
  movimientos: Movimiento[];
  errores: ErrorDeLinea[];
}

export type ResultadoValidacion =
  | { ok: true; plantilla: Plantilla }
  | { ok: false; errores: string[] };

// Un registro ya separado en campos con nombre. Los lectores propios (MT940, camt.053)
// producen registros y reutilizan el mapeo de columnas, omitirSi y soloEntradas.
export interface RegistroLeido {
  linea: number;
  campos: Record<string, string>;
}

// Punto de extensión: un formato que no cabe en una plantilla declarativa.
export interface LectorFormato {
  tipo: string;                                         // 'mt940', 'camt053', ...
  leer(texto: string, plantilla: Plantilla): ResultadoLectura;
  detectar?(texto: string): number;                     // 0..1
}
