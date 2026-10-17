// Perfiles guardados por empresa en este navegador: { [perfil.id]: Perfil }.
import type { Perfil } from '@conciliador/core';
import { guardar, leerGuardado } from './almacen.ts';

export function perfilesGuardados(): Record<string, Perfil> {
  const datos = leerGuardado<Record<string, Perfil>>('perfiles', {});
  return datos && typeof datos === 'object' ? datos : {};
}

export function guardarPerfiles(perfiles: Record<string, Perfil>): boolean {
  return guardar('perfiles', perfiles);
}

// Pares de la demo de Tienda La Ceiba (ver packages/plantillas/ESCENARIO.md).
export const DEMOS = [
  { id: 'par1', titulo: 'Extracto bancario + ventas Wompi', banco: 'extracto-banco', ventas: 'ventas-wompi' },
  { id: 'par2', titulo: 'Recaudo Asobancaria + ventas del ERP', banco: 'recaudo-asobancaria', ventas: 'ventas-erp' },
];
