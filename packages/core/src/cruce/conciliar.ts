// Orquesta los pases y arma el resultado. Sin reloj ni azar: mismo input, mismo output.
import type { Movimiento } from '../modelo.ts';
import type { Perfil } from './perfil.ts';
import type { Propuesta } from './pases.ts';
import { formatearCOP } from '../modelo.ts';
import { PERFIL_POR_DEFECTO, validarPerfil } from './perfil.ts';
import { crearContexto, paseExacto, paseTolerancia, paseAgrupado, MAX_CANDIDATOS_GRUPO } from './pases.ts';
import { explicarDiferencia, formatearPorcentaje, mediana } from './puntaje.ts';
import type { ContextoExplicacion } from './puntaje.ts';

export interface Coincidencia {
  id: string;                        // estable: 'c1', 'c2'... en orden de creación
  tipo: 'exacta' | 'tolerancia' | 'agrupada' | 'manual';
  bancoIds: string[]; ventasIds: string[];
  puntaje: number;                   // 0..1
  diferenciaCentavos: number;        // suma banco - suma ventas (negativo = llegó menos)
  explicacion: string;
  estado: 'automatica' | 'sugerida'; // según umbrales del perfil
}

export interface ResultadoConciliacion {
  coincidencias: Coincidencia[];
  sinCruzarBanco: string[]; sinCruzarVentas: string[];
  resumen: { movimientosBanco: number; movimientosVentas: number; automaticas: number;
    sugeridas: number; sinCruzarBanco: number; sinCruzarVentas: number;
    totalBancoCentavos: number; totalVentasCentavos: number; totalConciliadoCentavos: number };
  grafo: { nodos: { id: string; lado: 'banco' | 'ventas' }[];
    aristas: { banco: string; venta: string; peso: number }[] };
  pases: { nombre: string; coincidencias: number }[];
}

function verificarIds(movimientos: Movimiento[], lado: string): void {
  const vistos = new Set<string>();
  for (const m of movimientos) {
    if (vistos.has(m.id)) throw new Error(`Id repetido en ${lado}: "${m.id}"`);
    vistos.add(m.id);
    if (!Number.isSafeInteger(m.montoCentavos)) throw new Error(`Monto no entero en ${lado} "${m.id}"`);
  }
}

const suma = (lista: Movimiento[]) => lista.reduce((s, m) => s + m.montoCentavos, 0);

function textoDias(dias: number): string {
  if (dias === 0) return 'mismo día';
  const n = Math.abs(dias);
  return `venta ${n} día${n === 1 ? '' : 's'} ${dias > 0 ? 'antes' : 'después'} del abono`;
}

function explicar(p: Propuesta, banco: Movimiento[], ventas: Movimiento[], ctx: ContextoExplicacion): string {
  const b = banco[0];
  const diferencia = suma(banco) - suma(ventas);
  if (p.tipo === 'exacta') {
    return p.motivo === 'referencia'
      ? `Mismo monto (${formatearCOP(b.montoCentavos)}) y misma referencia ${b.referencia}.`
      : `Mismo monto (${formatearCOP(b.montoCentavos)}) y misma fecha (${b.fecha}); las referencias no coinciden.`;
  }
  const textoDiferencia = diferencia === 0 ? `Monto exacto (${formatearCOP(b.montoCentavos)}).` : explicarDiferencia(diferencia, ventas, ctx);
  if (p.tipo === 'tolerancia') {
    const v = ventas[0];
    let ref: string;
    if (p.similitud === 1) ref = 'misma referencia';
    else if (p.prefijo) ref = `referencia ${b.referencia} coincide por prefijo con ${v.referencia}`;
    else if (b.referencia === '' || v.referencia === '') ref = 'sin referencia para comparar';
    else ref = `referencias parecidas al ${formatearPorcentaje(p.similitud ?? 0)}`;
    return `${textoDiferencia} ${mayuscula(ref)}; ${textoDias(p.dias[0])}.`;
  }
  const maxDias = Math.max(...p.dias);
  const minDias = Math.min(...p.dias);
  let rango: string;
  if (maxDias === minDias) rango = textoDias(maxDias).replace('venta ', 'ventas ');
  else if (minDias >= 0) rango = `ventas de ${minDias} a ${maxDias} días antes del abono`;
  else rango = `ventas entre ${-minDias} día(s) después y ${Math.max(0, maxDias)} día(s) antes del abono`;
  return `Abono que agrupa ${ventas.length} ventas por ${formatearCOP(suma(ventas))}. ${textoDiferencia} ${mayuscula(rango)}.`;
}

const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function conciliar(banco: Movimiento[], ventas: Movimiento[], perfil: Perfil = PERFIL_POR_DEFECTO): ResultadoConciliacion {
  const validado = validarPerfil(perfil);
  if (!validado.ok) throw new Error(`Perfil inválido: ${validado.errores.join('; ')}`);
  const reglas = validado.perfil;
  verificarIds(banco, 'banco');
  verificarIds(ventas, 'ventas');

  const ctx = crearContexto(banco, ventas, reglas);
  const exactas = paseExacto(ctx);
  const tolerancia = paseTolerancia(ctx);
  const agrupadas = paseAgrupado(ctx);
  const propuestas = [...exactas, ...tolerancia.propuestas, ...agrupadas.propuestas];

  // Comisión típica del lote: la mediana del % faltante. Con ella se reconoce cuándo
  // un faltante mayor es comisión + una retención del perfil (p. ej. ReteFuente).
  const porcentajes: number[] = [];
  for (const p of propuestas) {
    const base = p.ventas.reduce((s, j) => s + ventas[j].montoCentavos, 0);
    const diferencia = p.banco.reduce((s, i) => s + banco[i].montoCentavos, 0) - base;
    if (diferencia < 0 && base > 0) porcentajes.push(-diferencia / base);
  }
  const contexto: ContextoExplicacion = { perfil: reglas, comisionEstimada: mediana(porcentajes) };

  const coincidencias = propuestas.map((p, n): Coincidencia => {
    const movBanco = p.banco.map((i) => banco[i]);
    const movVentas = p.ventas.map((j) => ventas[j]);
    return {
      id: `c${n + 1}`,
      tipo: p.tipo,
      bancoIds: movBanco.map((m) => m.id),
      ventasIds: movVentas.map((m) => m.id),
      puntaje: p.puntaje,
      diferenciaCentavos: suma(movBanco) - suma(movVentas),
      explicacion: explicar(p, movBanco, movVentas, contexto),
      estado: p.puntaje >= reglas.umbralAutomatico ? 'automatica' : 'sugerida',
    };
  });

  const sinCruzarBanco = banco.filter((_, i) => ctx.libreBanco[i]).map((m) => m.id);
  const sinCruzarVentas = ventas.filter((_, j) => ctx.libreVenta[j]).map((m) => m.id);
  const automaticas = coincidencias.filter((c) => c.estado === 'automatica').length;

  const pases = [
    { nombre: 'exacta', coincidencias: exactas.length },
    { nombre: 'tolerancia', coincidencias: tolerancia.propuestas.length },
    { nombre: 'agrupada', coincidencias: agrupadas.propuestas.length },
  ];
  // Abonos que el pase 3 no intentó (o no terminó) por exceso de candidatos: se informan aparte.
  if (agrupadas.omitidos > 0) {
    pases.push({ nombre: `agrupada omitida (más de ${MAX_CANDIDATOS_GRUPO} candidatos o búsqueda muy grande): revisión manual`, coincidencias: agrupadas.omitidos });
  }

  return {
    coincidencias,
    sinCruzarBanco,
    sinCruzarVentas,
    resumen: {
      movimientosBanco: banco.length,
      movimientosVentas: ventas.length,
      automaticas,
      sugeridas: coincidencias.length - automaticas,
      sinCruzarBanco: sinCruzarBanco.length,
      sinCruzarVentas: sinCruzarVentas.length,
      totalBancoCentavos: suma(banco),
      totalVentasCentavos: suma(ventas),
      // Lado banco: es el dinero que efectivamente entró y quedó explicado.
      totalConciliadoCentavos: suma(banco.filter((_, i) => !ctx.libreBanco[i])),
    },
    grafo: tolerancia.grafo,
    pases,
  };
}
