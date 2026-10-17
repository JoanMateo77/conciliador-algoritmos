// Reglas de tolerancia, puntaje de candidatos y texto de las explicaciones.
// Todo es función pura para que el cruce sea reproducible.
import type { Perfil } from './perfil.ts';
import type { Movimiento } from '../modelo.ts';
import { formatearCOP } from '../modelo.ts';

// Margen para comparar contra porcentajes (floats) sin falsos negativos por redondeo.
const EPSILON = 1e-6;

// Mayor faltante permitido para una venta (o suma de ventas) de este monto.
export function faltanteMaximo(montoVentas: number, perfil: Perfil): number {
  return Math.max(perfil.toleranciaFaltanteCentavos, perfil.toleranciaFaltantePorcentaje * Math.abs(montoVentas));
}

// Tolerancia asimétrica: el banco puede traer menos (comisiones) pero casi nunca más.
export function dentroDeTolerancia(montoBanco: number, montoVentas: number, perfil: Perfil): boolean {
  const diferencia = montoBanco - montoVentas;
  if (diferencia >= 0) return diferencia <= perfil.toleranciaSobranteCentavos;
  return -diferencia <= faltanteMaximo(montoVentas, perfil) + EPSILON;
}

// Rango de montos de venta que podrían cuadrar con un abono; se usa en el AVL y en la poda.
// Es un rango amplio y seguro: luego cada candidato se revisa con dentroDeTolerancia.
export function rangoVentas(montoBanco: number, perfil: Perfil): { min: number; max: number } {
  const p = perfil.toleranciaFaltantePorcentaje;
  // venta * (1 - p) <= abono  =>  venta <= abono / (1 - p). Con abonos negativos el % no amplía nada.
  const porPorcentaje = p > 0 && montoBanco > 0 ? Math.floor(montoBanco / (1 - p) + EPSILON) : montoBanco;
  return {
    min: montoBanco - perfil.toleranciaSobranteCentavos,
    max: Math.max(montoBanco + perfil.toleranciaFaltanteCentavos, porPorcentaje),
  };
}

// d > 0: la venta fue d días antes del abono.
export function dentroDeVentana(dias: number, perfil: Perfil): boolean {
  return dias <= perfil.ventanaDias && dias >= -perfil.diasDespues;
}

// Distancia de edición con dos filas: O(a·b) tiempo, O(b) memoria.
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let anterior = new Array<number>(b.length + 1);
  let actual = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) anterior[j] = j;
  for (let i = 1; i <= a.length; i++) {
    actual[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      actual[j] = Math.min(anterior[j] + 1, actual[j - 1] + 1, anterior[j - 1] + costo);
    }
    [anterior, actual] = [actual, anterior];
  }
  return anterior[b.length];
}

// Largo mínimo para confiar en un prefijo: "PED" sola no identifica nada.
export const LARGO_MINIMO_PREFIJO = 6;

// Similitud 0..1. esPrefijo lo calcula el pase con el Trie (referencia truncada por el banco).
export function similitudReferencia(a: string, b: string, esPrefijo = false): number {
  if (a === '' || b === '') return 0.5; // sin referencia no hay evidencia ni a favor ni en contra
  if (a === b) return 1;
  if (esPrefijo) return 0.9;
  return Math.max(0, 1 - levenshtein(a, b) / Math.max(a.length, b.length));
}

// 1 si el monto es exacto; baja linealmente hasta 0,5 en el borde de la tolerancia.
export function puntajeMonto(montoBanco: number, montoVentas: number, perfil: Perfil): number {
  const diferencia = montoBanco - montoVentas;
  if (diferencia === 0) return 1;
  const limite = diferencia > 0 ? perfil.toleranciaSobranteCentavos : faltanteMaximo(montoVentas, perfil);
  if (limite <= 0) return 0.5;
  return 1 - 0.5 * Math.min(1, Math.abs(diferencia) / limite);
}

// 1 el mismo día; baja hasta 0,5 en el borde de la ventana.
export function puntajeFecha(dias: number, perfil: Perfil): number {
  if (dias === 0) return 1;
  const limite = dias > 0 ? perfil.ventanaDias : perfil.diasDespues;
  if (limite <= 0) return 0.5;
  return 1 - 0.5 * Math.min(1, Math.abs(dias) / limite);
}

// Redondeo a 4 decimales: los puntajes se comparan y se muestran, mejor que sean estables.
export function redondear(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}

// Pesos: el monto pesa más porque es lo único que el banco nunca omite.
export function puntaje1a1(monto: number, fecha: number, referencia: number): number {
  return redondear(0.5 * monto + 0.2 * fecha + 0.3 * referencia);
}

// Un grupo es menos seguro que un 1:1 (la suma pudo cuadrar por casualidad): tope 0,9.
export function puntajeGrupo(monto: number, fecha: number): number {
  return redondear(0.9 * (0.6 * monto + 0.4 * fecha));
}

// "3,15 %" con hasta dos decimales y coma decimal.
export function formatearPorcentaje(fraccion: number): string {
  const texto = (Math.round(fraccion * 10_000) / 100).toFixed(2).replace(/\.?0+$/, '');
  return `${texto.replace('.', ',')} %`;
}

export interface ContextoExplicacion {
  perfil: Perfil;
  comisionEstimada: number | null; // fracción típica del lote (mediana), o null si no hay datos
}

// Explica la diferencia banco - ventas. Busca, en este orden: desglose de las ventas,
// comisión estimada + retenciones del perfil, y solo retenciones del perfil.
export function explicarDiferencia(diferencia: number, ventas: Movimiento[], ctx: ContextoExplicacion): string {
  const base = ventas.reduce((s, v) => s + v.montoCentavos, 0);
  if (diferencia === 0) return 'Sin diferencia.';
  if (diferencia > 0) return `Sobran ${formatearCOP(diferencia)} (pago de más), dentro de la tolerancia del perfil.`;

  const faltante = -diferencia;
  const pct = base !== 0 ? faltante / Math.abs(base) : 0;
  const inicio = `Faltan ${formatearCOP(faltante)} (${formatearPorcentaje(pct)} de ${formatearCOP(base)})`;
  // ±1 % del faltante (mínimo $1) por el redondeo al centavo que hace cada pasarela.
  const margen = Math.max(100, faltante * 0.01);
  const cuadra = (esperado: number) => Math.abs(faltante - esperado) <= margen;

  const conDesglose = explicarConDesglose(ventas, cuadra);
  if (conDesglose) return `${inicio} ≈ ${conDesglose}.`;

  const subconjuntos = combinaciones(ctx.perfil.retenciones);
  if (ctx.comisionEstimada !== null && ctx.comisionEstimada > 0) {
    const comision = ctx.comisionEstimada;
    for (const sub of subconjuntos) {
      const montoRet = sub.reduce((s, r) => s + Math.round(r.tasa * base), 0);
      if (cuadra(comision * base + montoRet)) {
        const partes = [`comisión ${formatearPorcentaje(comision)}`];
        for (const r of sub) partes.push(`${r.nombre} ${formatearPorcentaje(r.tasa)} (${formatearCOP(Math.round(r.tasa * base))})`);
        return `${inicio} ≈ ${partes.join(' + ')}.`;
      }
    }
  }
  for (const sub of subconjuntos) {
    if (sub.length === 0) continue;
    const montoRet = sub.reduce((s, r) => s + Math.round(r.tasa * base), 0);
    if (cuadra(montoRet)) {
      return `${inicio} ≈ ${sub.map((r) => `${r.nombre} ${formatearPorcentaje(r.tasa)}`).join(' + ')}.`;
    }
  }
  return `${inicio}, dentro de la tolerancia del perfil.`;
}

function explicarConDesglose(ventas: Movimiento[], cuadra: (esperado: number) => boolean): string | null {
  if (!ventas.some((v) => v.desglose)) return null;
  let comision = 0, iva = 0, retenciones = 0;
  for (const v of ventas) {
    comision += v.desglose?.comisionCentavos ?? 0;
    iva += v.desglose?.ivaComisionCentavos ?? 0;
    retenciones += v.desglose?.retencionesCentavos ?? 0;
  }
  if (comision + iva + retenciones === 0 || !cuadra(comision + iva + retenciones)) return null;
  const partes: string[] = [];
  if (comision) partes.push(`comisión ${formatearCOP(comision)}`);
  if (iva) partes.push(`IVA ${formatearCOP(iva)}`);
  if (retenciones) partes.push(`retenciones ${formatearCOP(retenciones)}`);
  return `${partes.join(' + ')} según el desglose`;
}

// Todas las combinaciones, de menos a más elementos (primero la explicación más simple).
function combinaciones<T>(lista: T[]): T[][] {
  const salida: T[][] = [];
  const total = 1 << lista.length;
  for (let mascara = 0; mascara < total; mascara++) {
    const sub: T[] = [];
    for (let i = 0; i < lista.length; i++) if (mascara & (1 << i)) sub.push(lista[i]);
    salida.push(sub);
  }
  return salida.sort((a, b) => a.length - b.length);
}

// Mediana de una lista de números (no la modifica). null si está vacía.
export function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const orden = valores.slice().sort((a, b) => a - b);
  const medio = orden.length >> 1;
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
}
