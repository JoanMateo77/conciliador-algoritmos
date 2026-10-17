// Perfil: todas las reglas de cruce que cambian de una empresa a otra.
// Es dato puro (JSON), así cada empresa ajusta el cruce sin tocar código.
import type { Regla } from './reglas.ts';
import type { Tarifa } from './tarifas.ts';
import { validarReglas } from './reglas.ts';
import { validarTarifas } from './tarifas.ts';

export interface Perfil {
  id: string;
  nombre: string;
  toleranciaFaltanteCentavos: number;   // el banco puede traer hasta esto MENOS (comisiones)
  toleranciaFaltantePorcentaje: number; // o hasta este % menos, ej. 0.04; se usa el mayor
  toleranciaSobranteCentavos: number;   // sobrepagos: normalmente 0
  ventanaDias: number;                  // la venta puede ser hasta N días antes del abono
  diasDespues: number;                  // o hasta N días después (normalmente 0 o 1)
  maxGrupo: number;                     // máximo de ventas por grupo (N:1 y N:M); 0 o 1 = no agrupar
  umbralAutomatico: number;             // 0..1
  umbralSugerencia: number;             // 0..1
  retenciones: { nombre: string; tasa: number }[]; // explican faltantes, ej. ReteFuente 0.015
  // Fases 10 y 11, todos opcionales: un perfil del MVP sigue funcionando igual.
  reglas?: Regla[];          // clasificar, exigir referencia o cambiar la tolerancia de ciertos movimientos
  tarifas?: Tarifa[];        // con vigencia: explican faltantes a la fecha del abono
  municipio?: string;        // para tarifas municipales (ReteICA)
  cruceOptimo?: boolean;     // por defecto true: Húngaro por componente y clusters N:M
}

// Pensado para pasarelas colombianas: comisión + IVA + ReteFuente rondan el 4,65 %,
// por eso el 5 %. Sobrepagos nunca se aceptan solos.
export const PERFIL_POR_DEFECTO: Perfil = {
  id: 'general',
  nombre: 'General (pasarelas Colombia)',
  toleranciaFaltanteCentavos: 0,
  toleranciaFaltantePorcentaje: 0.05,
  toleranciaSobranteCentavos: 0,
  ventanaDias: 5,
  diasDespues: 1,
  maxGrupo: 8,
  umbralAutomatico: 0.9,
  umbralSugerencia: 0.6,
  retenciones: [{ nombre: 'ReteFuente', tasa: 0.015 }],
};

export function validarPerfil(p: unknown): { ok: true; perfil: Perfil } | { ok: false; errores: string[] } {
  const errores: string[] = [];
  if (typeof p !== 'object' || p === null || Array.isArray(p)) {
    return { ok: false, errores: ['El perfil debe ser un objeto'] };
  }
  const o = p as Record<string, unknown>;

  const texto = (campo: string) => {
    if (typeof o[campo] !== 'string' || (o[campo] as string).trim() === '') errores.push(`${campo}: debe ser un texto no vacío`);
  };
  const entero = (campo: string, minimo: number) => {
    const v = o[campo];
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < minimo) errores.push(`${campo}: debe ser un entero >= ${minimo}`);
  };
  const fraccion = (campo: string, menorQueUno: boolean) => {
    const v = o[campo];
    const ok = typeof v === 'number' && Number.isFinite(v) && v >= 0 && (menorQueUno ? v < 1 : v <= 1);
    if (!ok) errores.push(`${campo}: debe ser un número entre 0 y 1${menorQueUno ? ' (sin llegar a 1)' : ''}`);
  };

  texto('id');
  texto('nombre');
  entero('toleranciaFaltanteCentavos', 0);
  fraccion('toleranciaFaltantePorcentaje', true); // 100 % haría infinito el rango del AVL
  entero('toleranciaSobranteCentavos', 0);
  entero('ventanaDias', 0);
  entero('diasDespues', 0);
  entero('maxGrupo', 1);
  fraccion('umbralAutomatico', false);
  fraccion('umbralSugerencia', false);
  if (typeof o.umbralAutomatico === 'number' && typeof o.umbralSugerencia === 'number'
    && o.umbralSugerencia > o.umbralAutomatico) {
    errores.push('umbralSugerencia no puede ser mayor que umbralAutomatico');
  }

  if (!Array.isArray(o.retenciones)) {
    errores.push('retenciones: debe ser una lista');
  } else {
    o.retenciones.forEach((r, i) => {
      const ret = r as Record<string, unknown> | null;
      if (typeof ret !== 'object' || ret === null || typeof ret.nombre !== 'string' || ret.nombre.trim() === '') {
        errores.push(`retenciones[${i}].nombre: debe ser un texto no vacío`);
      }
      const tasa = ret?.tasa;
      if (typeof tasa !== 'number' || !Number.isFinite(tasa) || tasa <= 0 || tasa >= 1) {
        errores.push(`retenciones[${i}].tasa: debe ser un número entre 0 y 1`);
      }
    });
    // Se prueban todas las combinaciones de retenciones para explicar un faltante: 2^n.
    if (o.retenciones.length > 10) errores.push('retenciones: máximo 10');
  }

  if (o.reglas !== undefined) errores.push(...validarReglas(o.reglas));
  if (o.tarifas !== undefined) errores.push(...validarTarifas(o.tarifas));
  if (o.municipio !== undefined && (typeof o.municipio !== 'string' || o.municipio.trim() === '')) {
    errores.push('municipio: debe ser un texto no vacío');
  }
  if (o.cruceOptimo !== undefined && typeof o.cruceOptimo !== 'boolean') errores.push('cruceOptimo: debe ser true o false');

  if (errores.length > 0) return { ok: false, errores };
  // Copia: el cruce no debe verse afectado si quien llamó cambia su objeto después.
  const perfil: Perfil = {
    id: o.id as string,
    nombre: o.nombre as string,
    toleranciaFaltanteCentavos: o.toleranciaFaltanteCentavos as number,
    toleranciaFaltantePorcentaje: o.toleranciaFaltantePorcentaje as number,
    toleranciaSobranteCentavos: o.toleranciaSobranteCentavos as number,
    ventanaDias: o.ventanaDias as number,
    diasDespues: o.diasDespues as number,
    maxGrupo: o.maxGrupo as number,
    umbralAutomatico: o.umbralAutomatico as number,
    umbralSugerencia: o.umbralSugerencia as number,
    retenciones: (o.retenciones as { nombre: string; tasa: number }[]).map((r) => ({ nombre: r.nombre, tasa: r.tasa })),
  };
  // Los opcionales solo se copian si vienen: un perfil del MVP queda idéntico a su copia.
  if (o.reglas !== undefined) perfil.reglas = structuredClone(o.reglas as Regla[]);
  if (o.tarifas !== undefined) perfil.tarifas = structuredClone(o.tarifas as Tarifa[]);
  if (o.municipio !== undefined) perfil.municipio = o.municipio as string;
  if (o.cruceOptimo !== undefined) perfil.cruceOptimo = o.cruceOptimo as boolean;
  return { ok: true, perfil };
}
