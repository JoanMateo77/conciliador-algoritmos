// Orquesta los pases y arma el resultado. Sin reloj ni azar: mismo input, mismo output.
import type { Movimiento } from '../modelo.ts';
import type { Perfil } from './perfil.ts';
import type { Propuesta, ContextoCruce } from './pases.ts';
import type { Regla } from './reglas.ts';
import type { Dueno } from './motivos.ts';
import { formatearCOP } from '../modelo.ts';
import { PERFIL_POR_DEFECTO, validarPerfil } from './perfil.ts';
import { crearContexto, paseExacto, paseTolerancia, paseAgrupado, paseNM, MAX_CANDIDATOS_GRUPO } from './pases.ts';
import { explicarDiferencia, formatearPorcentaje, mediana } from './puntaje.ts';
import type { ContextoExplicacion } from './puntaje.ts';
import { compilarReglas } from './reglas.ts';
import { calcularMotivos } from './motivos.ts';

export interface Coincidencia {
  id: string;                        // estable: 'c1', 'c2'... en orden de creación
  tipo: 'exacta' | 'tolerancia' | 'agrupada' | 'agrupadaNM' | 'manual';
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
  // Fases 10 y 11. conciliar siempre los llena; son opcionales para leer resultados guardados antes.
  clasificados?: Clasificado[];
  // Id de movimiento sin cruzar -> por qué no cruzó. Si un mismo id está sin cruzar en los dos
  // lados, las claves llevan prefijo: 'banco:<id>' y 'ventas:<id>'.
  motivos?: Record<string, string>;
}

// Movimiento que una regla sacó del cruce (gasto, comisión, ignorar...).
export interface Clasificado { id: string; lado: 'banco' | 'ventas'; categoria: string; reglaId: string }

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
    if (p.motivo === 'referenciaPago') {
      return `Mismo monto (${formatearCOP(b.montoCentavos)}) y misma referencia de pago Bre-B ${b.referenciaPago || b.referencia}.`;
    }
    return p.motivo === 'referencia'
      ? `Mismo monto (${formatearCOP(b.montoCentavos)}) y misma referencia ${b.referencia}.`
      : `Mismo monto (${formatearCOP(b.montoCentavos)}) y misma fecha (${b.fecha}); las referencias no coinciden.`;
  }
  // Las tarifas se toman vigentes a la fecha del abono (el más reciente si son varios).
  const fechaAbono = banco.reduce((f, m) => (m.fecha > f ? m.fecha : f), b.fecha);
  const textoDiferencia = diferencia === 0 ? `Monto exacto (${formatearCOP(b.montoCentavos)}).` : explicarDiferencia(diferencia, ventas, ctx, fechaAbono);
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
  if (p.tipo === 'agrupadaNM') {
    return `${banco.length} abonos por ${formatearCOP(suma(banco))} pagan juntos ${ventas.length} venta${ventas.length === 1 ? '' : 's'} por ${formatearCOP(suma(ventas))}. ${textoDiferencia} ${mayuscula(rango)}.`;
  }
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
  // Reglas primero: los clasificados salen del cruce antes de cualquier pase.
  const clasificados = reglas.reglas && reglas.reglas.length > 0 ? aplicarReglas(ctx, reglas.reglas) : [];
  const exactas = paseExacto(ctx);
  const tolerancia = paseTolerancia(ctx);
  const agrupadas = paseAgrupado(ctx);
  const nm = reglas.cruceOptimo !== false ? paseNM(ctx) : { propuestas: [], omitidos: 0 };
  const propuestas = [...exactas, ...tolerancia.propuestas, ...agrupadas.propuestas, ...nm.propuestas];

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

  // Libres y no clasificados: invariante coincidencias + clasificados + sin cruzar = todos.
  const sinCruzarBanco = banco.filter((_, i) => ctx.libreBanco[i] && !ctx.clasificadoBanco[i]).map((m) => m.id);
  const sinCruzarVentas = ventas.filter((_, j) => ctx.libreVenta[j] && !ctx.clasificadoVenta[j]).map((m) => m.id);
  const automaticas = coincidencias.filter((c) => c.estado === 'automatica').length;

  const pases = [
    { nombre: 'exacta', coincidencias: exactas.length },
    { nombre: 'tolerancia', coincidencias: tolerancia.propuestas.length },
    { nombre: 'agrupada', coincidencias: agrupadas.propuestas.length },
  ];
  // Solo aparece si encontró algo: un resultado sin clusters se ve igual que en el MVP.
  if (nm.propuestas.length > 0) pases.push({ nombre: 'agrupadaNM', coincidencias: nm.propuestas.length });
  // Abonos que el pase 3 no intentó (o no terminó) por exceso de candidatos: se informan aparte.
  if (agrupadas.omitidos > 0) {
    pases.push({ nombre: `agrupada omitida (más de ${MAX_CANDIDATOS_GRUPO} candidatos o búsqueda muy grande): revisión manual`, coincidencias: agrupadas.omitidos });
  }
  if (nm.omitidos > 0) {
    pases.push({ nombre: 'agrupadaNM omitida (componente grande o búsqueda muy grande): revisión manual', coincidencias: nm.omitidos });
  }

  // Quién se quedó con cada movimiento, para explicar los que no cruzaron.
  const duenoBanco: (Dueno | null)[] = banco.map(() => null);
  const duenoVenta: (Dueno | null)[] = ventas.map(() => null);
  propuestas.forEach((p, n) => {
    const dueno = { id: coincidencias[n].id, puntaje: p.puntaje };
    for (const i of p.banco) duenoBanco[i] = dueno;
    for (const j of p.ventas) duenoVenta[j] = dueno;
  });
  const porQue = calcularMotivos(ctx, duenoBanco, duenoVenta);
  const idsVentasLibres = new Set(sinCruzarVentas);
  const repetidos = new Set(sinCruzarBanco.filter((id) => idsVentasLibres.has(id)));
  const motivos: Record<string, string> = {};
  for (const [i, texto] of porQue.banco) {
    const id = banco[i].id;
    motivos[repetidos.has(id) ? `banco:${id}` : id] = texto;
  }
  for (const [j, texto] of porQue.ventas) {
    const id = ventas[j].id;
    motivos[repetidos.has(id) ? `ventas:${id}` : id] = texto;
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
      // Lado banco: es el dinero que efectivamente entró y quedó explicado (sin los clasificados).
      totalConciliadoCentavos: suma(banco.filter((_, i) => !ctx.libreBanco[i] && !ctx.clasificadoBanco[i])),
    },
    grafo: tolerancia.grafo,
    pases,
    clasificados,
    motivos,
  };
}

// Aplica las reglas del perfil al contexto: marca clasificados (salen del cruce), reglas que
// exigen referencia y tolerancias propias. Devuelve los clasificados en orden: banco y luego ventas.
function aplicarReglas(ctx: ContextoCruce, reglas: Regla[]): Clasificado[] {
  const evaluar = compilarReglas(reglas);
  const clasificados: Clasificado[] = [];
  const perfilDeRegla = new Map<string, Perfil>();
  const perfilTolerancia = (r: Regla): Perfil => {
    let p = perfilDeRegla.get(r.id);
    if (!p && r.accion.tipo === 'tolerancia') {
      p = {
        ...ctx.perfil,
        toleranciaFaltanteCentavos: r.accion.faltanteCentavos ?? ctx.perfil.toleranciaFaltanteCentavos,
        toleranciaFaltantePorcentaje: r.accion.faltantePorcentaje ?? ctx.perfil.toleranciaFaltantePorcentaje,
      };
      perfilDeRegla.set(r.id, p);
    }
    return p ?? ctx.perfil;
  };
  const lados = [
    { lado: 'banco' as const, lista: ctx.banco, libre: ctx.libreBanco, clasificado: ctx.clasificadoBanco },
    { lado: 'ventas' as const, lista: ctx.ventas, libre: ctx.libreVenta, clasificado: ctx.clasificadoVenta },
  ];
  for (const { lado, lista, libre, clasificado } of lados) {
    lista.forEach((m, k) => {
      const r = evaluar(m, lado);
      if (!r) return;
      if (r.clasificar && r.clasificar.accion.tipo === 'clasificar') {
        clasificado[k] = true;
        libre[k] = false;
        clasificados.push({ id: m.id, lado, categoria: r.clasificar.accion.categoria, reglaId: r.clasificar.id });
        return;
      }
      if (r.exigirReferencia) {
        if (lado === 'banco') (ctx.exigeBanco ??= ctx.banco.map(() => null))[k] = r.exigirReferencia.nombre;
        else (ctx.exigeVenta ??= ctx.ventas.map(() => null))[k] = r.exigirReferencia.nombre;
      }
      if (r.tolerancia) {
        const p = perfilTolerancia(r.tolerancia);
        if (lado === 'banco') (ctx.perfilBanco ??= ctx.banco.map(() => null))[k] = p;
        else (ctx.perfilVenta ??= ctx.ventas.map(() => null))[k] = p;
      }
    });
  }
  // El AVL del pase 2 busca con el rango más amplio que pueda pedir alguna venta con regla propia.
  if (ctx.perfilVenta) {
    let centavos = ctx.perfil.toleranciaFaltanteCentavos;
    let porcentaje = ctx.perfil.toleranciaFaltantePorcentaje;
    for (const p of ctx.perfilVenta) {
      if (!p) continue;
      centavos = Math.max(centavos, p.toleranciaFaltanteCentavos);
      porcentaje = Math.max(porcentaje, p.toleranciaFaltantePorcentaje);
    }
    ctx.perfilRangoVentas = { ...ctx.perfil, toleranciaFaltanteCentavos: centavos, toleranciaFaltantePorcentaje: porcentaje };
  }
  return clasificados;
}
