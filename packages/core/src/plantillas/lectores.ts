// Registro de lectores propios: el punto de extensión para formatos que no caben en
// una plantilla declarativa. Es global al módulo para que leerArchivo, validarPlantilla
// y RegistroPlantillas vean los mismos tipos sin pasarse el registro a mano.
import { LECTOR_CAMT053 } from './camt053.ts';
import { LECTOR_MT940 } from './mt940.ts';
import type { LectorFormato } from './tipos.ts';

// Estos dos los lee leer.ts directamente; reemplazarlos cambiaría el comportamiento del MVP.
const TIPOS_DECLARATIVOS = new Set(['delimitado', 'anchoFijo']);

const lectores = new Map<string, LectorFormato>();

// Registra (o reemplaza) el lector de un tipo. Lanza si el lector no cumple la interfaz.
export function registrarLector(lector: LectorFormato): void {
  if (typeof lector !== 'object' || lector === null) throw new Error('registrarLector: el lector debe ser un objeto');
  if (typeof lector.tipo !== 'string' || lector.tipo.trim() === '') throw new Error('registrarLector: tipo debe ser un texto no vacío');
  if (TIPOS_DECLARATIVOS.has(lector.tipo)) throw new Error(`registrarLector: "${lector.tipo}" es un tipo declarativo y no se puede reemplazar`);
  if (typeof lector.leer !== 'function') throw new Error('registrarLector: falta la función leer');
  if (lector.detectar !== undefined && typeof lector.detectar !== 'function') throw new Error('registrarLector: detectar debe ser una función');
  lectores.set(lector.tipo, lector);
}

export function obtenerLector(tipo: string): LectorFormato | undefined {
  return lectores.get(tipo);
}

export function tiposRegistrados(): string[] {
  return [...TIPOS_DECLARATIVOS, ...lectores.keys()];
}

registrarLector(LECTOR_MT940);
registrarLector(LECTOR_CAMT053);
