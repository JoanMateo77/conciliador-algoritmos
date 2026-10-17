// Tarifas con vigencia (fase 10): comisión, IVA de la comisión y retenciones que explican
// por qué el banco trae menos que la venta. Cambian con el tiempo, el medio de pago y el
// municipio (ReteICA), por eso cada una lleva su vigencia y filtros.
import type { Movimiento } from '../modelo.ts';
import { formatearCOP } from '../modelo.ts';

export interface Tarifa {
  nombre: string;                 // 'ReteFuente', 'ReteICA', 'ReteIVA', 'Comision', 'IVA', 'GMF'
  tasa: number;
  base: 'bruto' | 'comision' | 'iva';
  desde: string; hasta?: string;  // vigencia ISO, inclusiva
  medioPago?: string; municipio?: string;
}

// Tarifas de ejemplo (sintéticas, redondeadas) de una tienda con pasarela en Cali.
// La comisión y el IVA reproducen el 3,15 % de las muestras; ReteFuente el 1,5 %.
export const TARIFAS_EJEMPLO: Tarifa[] = [
  { nombre: 'Comision', tasa: 0.0265, base: 'bruto', desde: '2026-01-01' },
  { nombre: 'IVA', tasa: 0.19, base: 'comision', desde: '2026-01-01' },
  { nombre: 'ReteFuente', tasa: 0.015, base: 'bruto', desde: '2026-01-01' },
  { nombre: 'ReteICA', tasa: 0.0033, base: 'bruto', desde: '2026-01-01', municipio: 'Cali' },
  { nombre: 'ReteIVA', tasa: 0.15, base: 'iva', desde: '2026-01-01' },
];

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const fechaValida = (x: unknown) => typeof x === 'string' && FECHA_ISO.test(x) && !Number.isNaN(Date.parse(`${x}T00:00:00Z`));

// Se prueban combinaciones de tarifas (2^n) para explicar un faltante: se limita n.
export const MAX_TARIFAS = 30;
export const MAX_NOMBRES_TARIFA = 10;

export function validarTarifas(lista: unknown, ruta = 'tarifas'): string[] {
  if (!Array.isArray(lista)) return [`${ruta}: debe ser una lista`];
  const errores: string[] = [];
  if (lista.length > MAX_TARIFAS) errores.push(`${ruta}: máximo ${MAX_TARIFAS}`);
  const nombres = new Set<string>();
  lista.forEach((t, n) => {
    const at = `${ruta}[${n}]`;
    if (typeof t !== 'object' || t === null || Array.isArray(t)) { errores.push(`${at}: debe ser un objeto`); return; }
    const o = t as Record<string, unknown>;
    if (typeof o.nombre !== 'string' || o.nombre.trim() === '') errores.push(`${at}.nombre: debe ser un texto no vacío`);
    else nombres.add(clave(o.nombre));
    if (typeof o.tasa !== 'number' || !Number.isFinite(o.tasa) || o.tasa <= 0 || o.tasa >= 1) {
      errores.push(`${at}.tasa: debe ser un número entre 0 y 1`);
    }
    if (o.base !== 'bruto' && o.base !== 'comision' && o.base !== 'iva') errores.push(`${at}.base: debe ser bruto, comision o iva`);
    if (!fechaValida(o.desde)) errores.push(`${at}.desde: debe ser una fecha aaaa-mm-dd`);
    if (o.hasta !== undefined) {
      if (!fechaValida(o.hasta)) errores.push(`${at}.hasta: debe ser una fecha aaaa-mm-dd`);
      else if (fechaValida(o.desde) && (o.hasta as string) < (o.desde as string)) errores.push(`${at}.hasta: no puede ser anterior a desde`);
    }
    for (const campo of ['medioPago', 'municipio'] as const) {
      if (o[campo] !== undefined && (typeof o[campo] !== 'string' || clave(o[campo] as string) === '')) {
        errores.push(`${at}.${campo}: debe ser un texto no vacío`);
      }
    }
  });
  if (nombres.size > MAX_NOMBRES_TARIFA) errores.push(`${ruta}: máximo ${MAX_NOMBRES_TARIFA} nombres de tarifa distintos`);
  return errores;
}

// "Comisión" == "COMISION": sin tildes, mayúsculas, solo letras y dígitos.
function clave(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Palabras de la descripción de la venta: ahí las pasarelas dejan el medio de pago (CARD, NEQUI, PSE).
// Se compara por palabra completa para que "CARD" no coincida con "cardona@...".
function palabras(texto: string): Set<string> {
  return new Set(texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
}

export function tarifaVigente(t: Tarifa, fecha: string, municipio?: string): boolean {
  if (fecha < t.desde || (t.hasta !== undefined && fecha > t.hasta)) return false;
  // Una tarifa municipal (ReteICA) solo aplica si el perfil es de ese municipio.
  return t.municipio === undefined || (municipio !== undefined && clave(t.municipio) === clave(municipio));
}

export interface ParteTarifa {
  nombre: string;
  base: Tarifa['base'];
  tasas: number[];          // distintas tasas aplicadas (más de una si las ventas usan medios distintos)
  montoCentavos: number;    // suma por venta, cada una redondeada al centavo
}

// Calcula, venta por venta, cuánto descuenta cada tarifa vigente a la fecha del abono.
// Para cada nombre se usa la tarifa más específica: con medio de pago antes que sin él,
// con municipio antes que sin él, y la de vigencia más reciente.
export function calcularTarifas(tarifas: Tarifa[], ventas: Movimiento[], fecha: string, municipio?: string): ParteTarifa[] {
  const vigentes = tarifas.filter((t) => tarifaVigente(t, fecha, municipio));
  if (vigentes.length === 0) return [];
  const orden: string[] = [];
  const porNombre = new Map<string, Tarifa[]>();
  for (const t of vigentes) {
    const k = clave(t.nombre);
    if (!porNombre.has(k)) { porNombre.set(k, []); orden.push(k); }
    porNombre.get(k)!.push(t);
  }
  const especificidad = (t: Tarifa) => (t.medioPago ? 2 : 0) + (t.municipio ? 1 : 0);
  for (const lista of porNombre.values()) {
    lista.sort((a, b) => especificidad(b) - especificidad(a) || b.desde.localeCompare(a.desde));
  }

  const partes = new Map<string, ParteTarifa>();
  const sumar = (t: Tarifa, monto: number) => {
    const k = clave(t.nombre);
    let p = partes.get(k);
    if (!p) { p = { nombre: t.nombre, base: t.base, tasas: [], montoCentavos: 0 }; partes.set(k, p); }
    if (!p.tasas.includes(t.tasa)) p.tasas.push(t.tasa);
    p.montoCentavos += monto;
  };

  for (const v of ventas) {
    const medios = palabras(v.descripcion ?? '');
    const elegir = (lista: Tarifa[]) => lista.find((t) => t.medioPago === undefined || medios.has(clave(t.medioPago)));
    // Tres etapas: lo que se cobra sobre el bruto, luego sobre la comisión (IVA) y luego sobre el IVA (ReteIVA).
    let comision = 0;
    let iva = 0;
    for (const etapa of ['bruto', 'comision', 'iva'] as const) {
      for (const k of orden) {
        const t = elegir(porNombre.get(k)!);
        if (!t || t.base !== etapa) continue;
        const base = etapa === 'bruto' ? v.montoCentavos : etapa === 'comision' ? comision : iva;
        const monto = Math.round(t.tasa * base);
        sumar(t, monto);
        if (etapa === 'bruto' && k.startsWith('COMISION')) comision += monto;
        if (etapa === 'comision' && k.startsWith('IVA')) iva += monto;
      }
    }
  }
  return orden.filter((k) => partes.has(k) && partes.get(k)!.montoCentavos > 0).map((k) => partes.get(k)!);
}

function textoParte(p: ParteTarifa, porcentaje: (x: number) => string): string {
  const sobre = p.base === 'comision' ? ' de la comisión' : p.base === 'iva' ? ' del IVA' : '';
  const tasa = p.tasas.length === 1 ? ` ${porcentaje(p.tasas[0])}${sobre}` : '';
  return `${p.nombre}${tasa} (${formatearCOP(p.montoCentavos)})`;
}

// Busca la combinación más simple de tarifas vigentes que explica el faltante.
// Respeta dependencias: el IVA de la comisión solo con la comisión, y ReteIVA solo con el IVA.
export function explicarConTarifas(
  faltante: number, ventas: Movimiento[], tarifas: Tarifa[], fecha: string, municipio: string | undefined,
  cuadra: (esperado: number) => boolean, porcentaje: (x: number) => string,
): string | null {
  const partes = calcularTarifas(tarifas, ventas, fecha, municipio);
  if (partes.length === 0) return null;
  const n = partes.length;
  const mascaras: number[] = [];
  for (let m = 1; m < 1 << n; m++) mascaras.push(m);
  const bits = (m: number) => { let c = 0; for (let x = m; x; x &= x - 1) c++; return c; };
  mascaras.sort((a, b) => bits(a) - bits(b) || a - b);
  for (const m of mascaras) {
    const sub = partes.filter((_, i) => m & (1 << i));
    const tiene = (prefijo: string, base: Tarifa['base']) => sub.some((p) => p.base === base && clave(p.nombre).startsWith(prefijo));
    if (sub.some((p) => p.base === 'comision') && !tiene('COMISION', 'bruto')) continue;
    if (sub.some((p) => p.base === 'iva') && !tiene('IVA', 'comision')) continue;
    if (cuadra(sub.reduce((s, p) => s + p.montoCentavos, 0))) {
      return `${sub.map((p) => textoParte(p, porcentaje)).join(' + ')}, tarifas vigentes al ${fecha}`;
    }
  }
  return null;
}
