// Perfiles guardados por empresa en este navegador: { [perfil.id]: Perfil }.
import { PERFIL_POR_DEFECTO } from '@conciliador/core';
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
  { id: 'par3', titulo: 'Extracto MT940 + ventas Wompi', banco: 'extracto-banco-mt940', ventas: 'ventas-wompi' },
  { id: 'par4', titulo: 'Extracto camt.053 (XML) + ventas Wompi', banco: 'extracto-banco-camt053', ventas: 'ventas-wompi' },
];

// Demo B2B (fase 15): pagos de clientes empresariales contra facturas DIAN. Los clientes
// descuentan ReteFuente (2,5 % o 4 %) y ReteICA, y pagan hasta 30 días después de facturar.
// Es el mismo perfil de la prueba punta a punta de @conciliador/dian.
export const PERFIL_B2B: Perfil = {
  ...PERFIL_POR_DEFECTO,
  id: 'b2b-retenciones',
  nombre: 'Clientes empresariales con retenciones (demo)',
  toleranciaFaltantePorcentaje: 0.06,
  ventanaDias: 45,
  diasDespues: 0,
  retenciones: [
    { nombre: 'ReteFuente compras', tasa: 0.025 },
    { nombre: 'ReteFuente servicios', tasa: 0.04 },
    { nombre: 'ReteICA', tasa: 0.00966 },
  ],
};
