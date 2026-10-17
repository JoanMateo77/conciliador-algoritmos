// "Por qué no cruzó" (fase 11): para cada movimiento sin cruzar, una frase en español.
// Se calcula después de los pases con lo que estos anotaron en el contexto y con una
// revisión de la ventana de fechas: O(s · w), s = sin cruzar y w = movimientos por ventana.
import type { ContextoCruce } from './pases.ts';
import type { Perfil } from './perfil.ts';
import { formatearCOP } from '../modelo.ts';
import { perfilPar, referenciaCompatible, DIA_MS, MAX_CANDIDATOS_GRUPO } from './pases.ts';
import {
  dentroDeTolerancia, dentroDeVentana, faltanteMaximo, puntaje1a1, puntajeFecha, puntajeMonto, similitudReferencia,
} from './puntaje.ts';

export interface Dueno { id: string; puntaje: number }

const fechaDe = (dia: number) => new Date(dia * DIA_MS).toISOString().slice(0, 10);
const puntos = (x: number) => x.toFixed(2).replace('.', ',');

// Centavos que sobran por encima de la tolerancia; 0 si la pareja cabe.
function exceso(montoBanco: number, montoVentas: number, p: Perfil): number {
  if (dentroDeTolerancia(montoBanco, montoVentas, p)) return 0;
  const d = montoBanco - montoVentas;
  const fuera = d > 0 ? d - p.toleranciaSobranteCentavos : -d - faltanteMaximo(montoVentas, p);
  return Math.max(1, Math.ceil(fuera));
}

function tomado(idOtro: string, dueno: Dueno, puntajePropio: number): string {
  const base = `Su candidato ${idOtro} quedó en ${dueno.id} (puntaje ${puntos(dueno.puntaje)})`;
  return dueno.puntaje >= puntajePropio
    ? `${base}, con mayor puntaje que esta pareja (${puntos(puntajePropio)}).`
    : `${base}: la asignación óptima del componente prefirió esa combinación.`;
}

// Índices ordenados por día y búsqueda binaria del primero desde un día dado.
function ordenarPorDia(dias: number[], excluir: boolean[]): { orden: number[]; primeroDesde: (d: number) => number } {
  const orden = dias.map((_, k) => k).filter((k) => !excluir[k]).sort((a, b) => dias[a] - dias[b] || a - b);
  const primeroDesde = (d: number) => {
    let lo = 0, hi = orden.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (dias[orden[m]] < d) lo = m + 1; else hi = m;
    }
    return lo;
  };
  return { orden, primeroDesde };
}

export function calcularMotivos(ctx: ContextoCruce, duenoBanco: (Dueno | null)[], duenoVenta: (Dueno | null)[]): {
  banco: Map<number, string>; ventas: Map<number, string>;
} {
  const { perfil } = ctx;
  const ventas = ordenarPorDia(ctx.diaVenta, ctx.clasificadoVenta);
  const bancos = ordenarPorDia(ctx.diaBanco, ctx.clasificadoBanco);
  const puntajePar = (i: number, j: number, p: Perfil) => {
    const b = ctx.banco[i];
    const v = ctx.ventas[j];
    return puntaje1a1(puntajeMonto(b.montoCentavos, v.montoCentavos, p), puntajeFecha(ctx.diaBanco[i] - ctx.diaVenta[j], perfil),
      similitudReferencia(b.referencia, v.referencia));
  };
  const nombreRegla = (i: number, j: number) => ctx.exigeBanco?.[i] ?? ctx.exigeVenta?.[j] ?? '';
  const sumaPosible = perfil.maxGrupo >= 2 ? ' y ninguna suma de varias cuadra' : '';

  // Revisa la ventana de fechas del movimiento libre contra el otro lado.
  // pares: (k) => [i, j] traduce un índice del otro lado a la pareja abono-venta.
  const revisarVentana = (desde: number, hasta: number, otro: typeof ventas, diasOtro: number[],
    par: (k: number) => [number, number], idOtro: (k: number) => string, montoOtro: (k: number) => number,
    duenoOtro: (Dueno | null)[], nombreOtro: { plural: string; cercano: string }): string => {
    let hay = false;
    let libre: { k: number; puntaje: number } | null = null;
    let ocupada: { k: number; puntaje: number } | null = null;
    let incompatible: { k: number } | null = null;
    let cercano: { k: number; exceso: number } | null = null;
    for (let n = otro.primeroDesde(desde); n < otro.orden.length && diasOtro[otro.orden[n]] <= hasta; n++) {
      const k = otro.orden[n];
      if (montoOtro(k) <= 0) continue;
      hay = true;
      const [i, j] = par(k);
      const p = perfilPar(ctx, i, j);
      const e = exceso(ctx.banco[i].montoCentavos, ctx.ventas[j].montoCentavos, p);
      if (e > 0) {
        if (cercano === null || e < cercano.exceso) cercano = { k, exceso: e };
        continue;
      }
      if (!referenciaCompatible(ctx, i, j)) { incompatible ??= { k }; continue; }
      const puntaje = puntajePar(i, j, p);
      if (duenoOtro[k]) { if (ocupada === null || puntaje > ocupada.puntaje) ocupada = { k, puntaje }; } else if (libre === null || puntaje > libre.puntaje) libre = { k, puntaje };
    }
    if (!hay) return `Sin ${nombreOtro.plural} en la ventana de fechas (${fechaDe(desde)} a ${fechaDe(hasta)}).`;
    if (ocupada) return tomado(idOtro(ocupada.k), duenoOtro[ocupada.k]!, ocupada.puntaje);
    if (libre) {
      return `El mejor candidato (${idOtro(libre.k)}) tiene puntaje ${puntos(libre.puntaje)}, por debajo del umbral de sugerencia (${puntos(perfil.umbralSugerencia)}).`;
    }
    if (incompatible) {
      const [i, j] = par(incompatible.k);
      return `La regla "${nombreRegla(i, j)}" exige la misma referencia y ningún candidato de la ventana de fechas la tiene.`;
    }
    const c = cercano!;
    return `Monto fuera de tolerancia por ${formatearCOP(c.exceso)}: ${nombreOtro.cercano} en la ventana es ${idOtro(c.k)} (${formatearCOP(montoOtro(c.k))})${sumaPosible}.`;
  };

  const motivosBanco = new Map<number, string>();
  ctx.banco.forEach((b, i) => {
    if (!ctx.libreBanco[i] || ctx.clasificadoBanco[i]) return;
    motivosBanco.set(i, (() => {
      if (b.montoCentavos <= 0) {
        return 'Es un débito o un valor en cero: no se cruza con ventas. Si es un gasto (p. ej. GMF 4x1000), una regla de clasificación lo saca del cruce.';
      }
      for (const c of ctx.candidatos.get(i) ?? []) {
        const d = duenoVenta[c.j];
        if (d) return tomado(ctx.ventas[c.j].id, d, c.puntaje);
      }
      const jf = ctx.referenciaFuera.get(i);
      if (jf !== undefined) {
        const v = ctx.ventas[jf];
        const base = `Su referencia ${b.referencia} corresponde a la venta ${v.id} (${formatearCOP(v.montoCentavos)}, ${v.fecha})`;
        const d = duenoVenta[jf];
        if (d) return `${base}, que ya quedó en ${d.id}.`;
        if (!dentroDeVentana(ctx.diaBanco[i] - ctx.diaVenta[jf], perfil)) return `${base}, fuera de la ventana de fechas del perfil.`;
        const e = exceso(b.montoCentavos, v.montoCentavos, perfilPar(ctx, i, jf));
        if (e > 0) return `${base}, pero el monto queda fuera de tolerancia por ${formatearCOP(e)}.`;
        return `${base}, pero la pareja queda por debajo del umbral de sugerencia.`;
      }
      const n = ctx.omitidoGrupo.get(i);
      if (n !== undefined) {
        return `Demasiados candidatos para agrupar (${n} ventas libres en la ventana de fechas; máximo ${MAX_CANDIDATOS_GRUPO} o búsqueda muy grande): revisar a mano.`;
      }
      return revisarVentana(ctx.diaBanco[i] - perfil.ventanaDias, ctx.diaBanco[i] + perfil.diasDespues, ventas, ctx.diaVenta,
        (j) => [i, j], (j) => ctx.ventas[j].id, (j) => ctx.ventas[j].montoCentavos, duenoVenta,
        { plural: 'ventas', cercano: 'la venta más cercana en monto' });
    })());
  });

  // Candidatos del pase 2 vistos desde la venta.
  const candidatosVenta = new Map<number, { i: number; puntaje: number }[]>();
  for (const [i, lista] of ctx.candidatos) {
    for (const c of lista) {
      const l = candidatosVenta.get(c.j);
      if (l) l.push({ i, puntaje: c.puntaje }); else candidatosVenta.set(c.j, [{ i, puntaje: c.puntaje }]);
    }
  }
  const motivosVentas = new Map<number, string>();
  ctx.ventas.forEach((v, j) => {
    if (!ctx.libreVenta[j] || ctx.clasificadoVenta[j]) return;
    motivosVentas.set(j, (() => {
      if (v.montoCentavos <= 0) return 'Valor en cero o negativo (devolución o anulación): no se cruza con abonos.';
      const lista = (candidatosVenta.get(j) ?? []).slice().sort((a, b) => b.puntaje - a.puntaje || a.i - b.i);
      for (const c of lista) {
        const d = duenoBanco[c.i];
        if (d) return tomado(ctx.banco[c.i].id, d, c.puntaje);
      }
      // El abono puede ser hasta ventanaDias después de la venta, o diasDespues antes.
      return revisarVentana(ctx.diaVenta[j] - perfil.diasDespues, ctx.diaVenta[j] + perfil.ventanaDias, bancos, ctx.diaBanco,
        (i) => [i, j], (i) => ctx.banco[i].id, (i) => ctx.banco[i].montoCentavos, duenoBanco,
        { plural: 'abonos', cercano: 'el abono más cercano en monto' });
    })());
  });

  return { banco: motivosBanco, ventas: motivosVentas };
}
