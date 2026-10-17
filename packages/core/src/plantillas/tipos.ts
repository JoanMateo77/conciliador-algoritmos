// Tipos de las plantillas. Una plantilla es JSON puro: agregar un banco nuevo es
// agregar un JSON, sin código. Ver docs/CONTRATOS.md sección 3.
import type { Movimiento } from '../modelo.ts';

// Lista en tiempo de ejecución para validar; el tipo sale de aquí para no duplicarla.
export const CAMPOS_DESTINO = [
  'id', 'fecha', 'monto', 'referencia', 'descripcion', 'referenciaPago',
  'bruto', 'comision', 'ivaComision', 'retenciones',
] as const;

export type CampoDestino = typeof CAMPOS_DESTINO[number];

export interface MapeoDetallado {
  de?: string;                  // columna origen (delimitado), nombre o "#n" (1 = primera)
  inicio?: number;              // ancho fijo: posición 1-based
  longitud?: number;            // ancho fijo
  unir?: string[];              // concatena varias columnas con espacio
  regex?: string;               // se toma el grupo 1 (o el match completo)
  decimalesImplicitos?: number; // montos sin separador (Asobancaria)
  signo?: 'negar' | 'abs';
  fijo?: string;                // valor constante
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
  tipo: 'delimitado' | 'anchoFijo';
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
