// Reglas del perfil (fase 10): condiciones AND/OR sobre un movimiento y una acción.
// Son dato puro (JSON) para que una empresa exprese sus reglas sin tocar código,
// al estilo de las reglas bancarias de Xero u Odoo.
import type { Movimiento } from '../modelo.ts';
import { normalizarReferencia } from '../modelo.ts';
import { crearProbador, regexSegura, revisarRegex } from '../regexSegura.ts';

export type Condicion =
  | { campo: 'referencia' | 'descripcion' | 'plantilla'; op: 'igual' | 'contiene' | 'empiezaPor' | 'regex'; valor: string }
  | { campo: 'monto'; op: 'entre'; min: number; max: number }          // centavos, inclusivo
  | { campo: 'fecha'; op: 'entre'; desde: string; hasta: string };     // ISO, inclusivo

export type AccionRegla =
  | { tipo: 'clasificar'; categoria: string }        // ej. 'gasto:GMF', 'comision', 'ignorar'
  | { tipo: 'exigirReferencia' }                     // solo cruza con la misma referencia
  | { tipo: 'tolerancia'; faltanteCentavos?: number; faltantePorcentaje?: number };

export interface Regla {
  id: string; nombre: string; prioridad: number;      // menor = primero
  lado: 'banco' | 'ventas';
  si: { todas?: Condicion[]; alguna?: Condicion[] };  // AND / OR (si vienen ambas, deben cumplirse las dos)
  accion: AccionRegla;
}

// Ejemplo: el 4x1000 (GMF) es un gasto bancario, no un pago de un cliente. Clasificarlo
// lo saca del cruce para que no aparezca como abono "sin cruzar".
export const REGLA_GMF: Regla = {
  id: 'gmf-4x1000',
  nombre: 'GMF 4x1000 como gasto bancario',
  prioridad: 10,
  lado: 'banco',
  si: {
    alguna: [
      { campo: 'descripcion', op: 'contiene', valor: 'GMF' },
      { campo: 'descripcion', op: 'contiene', valor: '4X1000' },
      { campo: 'descripcion', op: 'contiene', valor: 'GRAVAMEN MOVIMIENTOS FINANCIEROS' },
    ],
  },
  accion: { tipo: 'clasificar', categoria: 'gasto:GMF' },
};

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const fechaValida = (x: unknown) => typeof x === 'string' && FECHA_ISO.test(x) && !Number.isNaN(Date.parse(`${x}T00:00:00Z`));
const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const textoNoVacio = (x: unknown) => typeof x === 'string' && x.trim() !== '';

function validarCondicion(c: unknown, ruta: string, errores: string[]): void {
  if (!esObjeto(c)) { errores.push(`${ruta}: debe ser un objeto`); return; }
  if (c.campo === 'referencia' || c.campo === 'descripcion' || c.campo === 'plantilla') {
    if (!['igual', 'contiene', 'empiezaPor', 'regex'].includes(c.op as string)) {
      errores.push(`${ruta}.op: debe ser igual, contiene, empiezaPor o regex`);
    }
    if (typeof c.valor !== 'string' || c.valor === '') errores.push(`${ruta}.valor: debe ser un texto no vacío`);
    else if (c.op === 'regex') {
      const problema = revisarRegex(c.valor, 'i');
      if (problema) errores.push(`${ruta}.valor: ${problema}`);
    }
  } else if (c.campo === 'monto') {
    if (c.op !== 'entre') errores.push(`${ruta}.op: con monto solo se admite "entre"`);
    if (!Number.isSafeInteger(c.min) || !Number.isSafeInteger(c.max)) errores.push(`${ruta}: min y max deben ser centavos enteros`);
    else if ((c.min as number) > (c.max as number)) errores.push(`${ruta}: min no puede ser mayor que max`);
  } else if (c.campo === 'fecha') {
    if (c.op !== 'entre') errores.push(`${ruta}.op: con fecha solo se admite "entre"`);
    if (!fechaValida(c.desde) || !fechaValida(c.hasta)) errores.push(`${ruta}: desde y hasta deben ser fechas aaaa-mm-dd`);
    else if ((c.desde as string) > (c.hasta as string)) errores.push(`${ruta}: desde no puede ser posterior a hasta`);
  } else {
    errores.push(`${ruta}.campo: debe ser referencia, descripcion, plantilla, monto o fecha`);
  }
}

// Topes para que un perfil enviado por la red no convierta cada movimiento en miles de pruebas.
export const REGLAS_MAXIMAS = 200;
export const CONDICIONES_MAXIMAS_POR_REGLA = 20;

// Devuelve la lista de errores (vacía si todo está bien), en español y con la ruta del campo.
export function validarReglas(lista: unknown, ruta = 'reglas'): string[] {
  const errores: string[] = [];
  if (!Array.isArray(lista)) return [`${ruta}: debe ser una lista`];
  if (lista.length > REGLAS_MAXIMAS) return [`${ruta}: a lo sumo ${REGLAS_MAXIMAS} reglas (llegaron ${lista.length})`];
  const ids = new Set<string>();
  lista.forEach((r, n) => {
    const at = `${ruta}[${n}]`;
    if (!esObjeto(r)) { errores.push(`${at}: debe ser un objeto`); return; }
    if (!textoNoVacio(r.id)) errores.push(`${at}.id: debe ser un texto no vacío`);
    else if (ids.has(r.id as string)) errores.push(`${at}.id: repetido ("${r.id}")`);
    else ids.add(r.id as string);
    if (!textoNoVacio(r.nombre)) errores.push(`${at}.nombre: debe ser un texto no vacío`);
    if (typeof r.prioridad !== 'number' || !Number.isFinite(r.prioridad)) errores.push(`${at}.prioridad: debe ser un número`);
    if (r.lado !== 'banco' && r.lado !== 'ventas') errores.push(`${at}.lado: debe ser banco o ventas`);
    if (!esObjeto(r.si)) {
      errores.push(`${at}.si: debe ser un objeto con todas y/o alguna`);
    } else {
      let total = 0;
      for (const grupo of ['todas', 'alguna'] as const) {
        const conds = r.si[grupo];
        if (conds === undefined) continue;
        if (!Array.isArray(conds)) { errores.push(`${at}.si.${grupo}: debe ser una lista`); continue; }
        total += conds.length;
        conds.forEach((c, k) => validarCondicion(c, `${at}.si.${grupo}[${k}]`, errores));
      }
      // Una regla sin condiciones atraparía todos los movimientos: casi siempre es un error.
      if (total === 0) errores.push(`${at}.si: necesita al menos una condición`);
      if (total > CONDICIONES_MAXIMAS_POR_REGLA) errores.push(`${at}.si: a lo sumo ${CONDICIONES_MAXIMAS_POR_REGLA} condiciones`);
    }
    const a = r.accion;
    if (!esObjeto(a)) {
      errores.push(`${at}.accion: debe ser un objeto`);
    } else if (a.tipo === 'clasificar') {
      if (!textoNoVacio(a.categoria)) errores.push(`${at}.accion.categoria: debe ser un texto no vacío`);
    } else if (a.tipo === 'tolerancia') {
      if (a.faltanteCentavos === undefined && a.faltantePorcentaje === undefined) {
        errores.push(`${at}.accion: la tolerancia necesita faltanteCentavos o faltantePorcentaje`);
      }
      if (a.faltanteCentavos !== undefined && (!Number.isSafeInteger(a.faltanteCentavos) || (a.faltanteCentavos as number) < 0)) {
        errores.push(`${at}.accion.faltanteCentavos: debe ser un entero >= 0`);
      }
      const p = a.faltantePorcentaje;
      if (p !== undefined && (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p >= 1)) {
        errores.push(`${at}.accion.faltantePorcentaje: debe ser un número entre 0 y 1 (sin llegar a 1)`);
      }
    } else if (a.tipo !== 'exigirReferencia') {
      errores.push(`${at}.accion.tipo: debe ser clasificar, exigirReferencia o tolerancia`);
    }
  });
  return errores;
}

// Comparación de textos libre de mayúsculas y tildes: "Gravámen" == "GRAVAMEN".
const plano = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

type Predicado = (m: Movimiento) => boolean;

type Probador = ReturnType<typeof crearProbador>;

function compilarCondicion(c: Condicion, probar: Probador): Predicado {
  if (c.campo === 'monto') return (m) => m.montoCentavos >= c.min && m.montoCentavos <= c.max;
  if (c.campo === 'fecha') return (m) => m.fecha >= c.desde && m.fecha <= c.hasta;
  const campo = c.campo;
  // La referencia del movimiento ya viene normalizada: el valor se normaliza igual.
  const valorDe = (m: Movimiento) => (campo === 'referencia' ? m.referencia : plano(m[campo] ?? ''));
  if (c.op === 'regex') {
    // regexSegura vuelve a revisar por si el perfil no pasó por validarReglas.
    const re = regexSegura(c.valor, 'i');
    return (m) => probar(re, campo === 'referencia' ? m.referencia : (m[campo] ?? '')) !== null;
  }
  const buscado = campo === 'referencia' ? normalizarReferencia(c.valor) : plano(c.valor);
  if (c.op === 'igual') return (m) => valorDe(m) === buscado;
  if (c.op === 'empiezaPor') return (m) => valorDe(m).startsWith(buscado);
  return (m) => valorDe(m).includes(buscado);
}

function compilarRegla(r: Regla, probar: Probador): Predicado {
  const todas = (r.si.todas ?? []).map((c) => compilarCondicion(c, probar));
  const alguna = (r.si.alguna ?? []).map((c) => compilarCondicion(c, probar));
  return (m) => todas.every((p) => p(m)) && (alguna.length === 0 || alguna.some((p) => p(m)));
}

export interface ReglasAplicables {
  clasificar?: Regla;        // el movimiento sale del cruce
  exigirReferencia?: Regla;
  tolerancia?: Regla;
}

// Prepara las reglas una sola vez (regex compiladas) y devuelve la función que, para un
// movimiento, da la primera regla que se cumple de cada tipo de acción, por prioridad
// (menor primero; empate = orden de la lista). Una clasificación gana sobre las demás.
// El lado lo da la lista en que viene el movimiento (no m.lado), igual que en conciliar.
export function compilarReglas(reglas: Regla[]): (m: Movimiento, lado: 'banco' | 'ventas') => ReglasAplicables | null {
  // Un solo presupuesto de tiempo para todas las regex de esta conciliación.
  const probar = crearProbador();
  const ordenadas = reglas.map((r, n) => ({ r, n, cumple: compilarRegla(r, probar) }))
    .sort((a, b) => a.r.prioridad - b.r.prioridad || a.n - b.n);
  return (m, lado) => {
    let salida: ReglasAplicables | null = null;
    for (const { r, cumple } of ordenadas) {
      if (r.lado !== lado) continue;
      const tipo = r.accion.tipo;
      if (salida?.[tipo] || !cumple(m)) continue;
      salida ??= {};
      salida[tipo] = r;
      if (tipo === 'clasificar') break;
    }
    return salida;
  };
}
