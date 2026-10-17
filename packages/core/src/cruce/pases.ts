// Los tres pases del cruce, de barato a caro. Cada pase solo ve lo que quedó libre
// y marca como ocupado lo que empareja: así ningún movimiento cae en dos coincidencias.
import type { Movimiento } from '../modelo.ts';
import type { Perfil } from './perfil.ts';
import { ArbolAVL } from '../estructuras/ArbolAVL.ts';
import { Trie } from '../estructuras/Trie.ts';
import { TopK } from '../estructuras/MinHeap.ts';
import { GrafoBipartito } from '../estructuras/GrafoBipartito.ts';
import {
  dentroDeTolerancia, dentroDeVentana, rangoVentas, similitudReferencia, puntajeMonto, puntajeFecha,
  puntaje1a1, puntajeGrupo, LARGO_MINIMO_PREFIJO,
} from './puntaje.ts';

// Estado compartido por los pases. Se trabaja con índices para no depender de que
// los ids de banco y ventas sean distintos entre sí (solo son únicos dentro de su lado).
export interface ContextoCruce {
  banco: Movimiento[];
  ventas: Movimiento[];
  perfil: Perfil;
  libreBanco: boolean[];
  libreVenta: boolean[];
  diaBanco: number[]; // días desde 1970: restar es más barato que llamar a diasEntre
  diaVenta: number[];
}

export interface Propuesta {
  tipo: 'exacta' | 'tolerancia' | 'agrupada';
  banco: number[];
  ventas: number[];
  puntaje: number;
  motivo: 'referencia' | 'fecha' | 'candidato' | 'suma';
  dias: number[];             // por venta: días entre la venta y el abono (positivo = antes)
  similitud?: number;         // tolerancia: similitud de referencia usada
  prefijo?: boolean;          // tolerancia: la referencia se halló por prefijo en el Trie
}

const DIA_MS = 86_400_000;

export function crearContexto(banco: Movimiento[], ventas: Movimiento[], perfil: Perfil): ContextoCruce {
  const dia = (m: Movimiento) => {
    const t = Date.parse(`${m.fecha}T00:00:00Z`);
    if (Number.isNaN(t)) throw new Error(`Fecha inválida en el movimiento ${m.lado} "${m.id}": "${m.fecha}"`);
    return Math.round(t / DIA_MS);
  };
  return {
    banco, ventas, perfil,
    libreBanco: banco.map(() => true),
    libreVenta: ventas.map(() => true),
    diaBanco: banco.map(dia),
    diaVenta: ventas.map(dia),
  };
}

function ocupar(ctx: ContextoCruce, p: Propuesta): void {
  for (const i of p.banco) ctx.libreBanco[i] = false;
  for (const j of p.ventas) ctx.libreVenta[j] = false;
}

// ---------- Pase 1: exacta, O(n + m) con Map ----------

// Primero monto|referencia (lo más confiable) y luego monto|fecha para lo que quede.
// Con varias ventas bajo la misma clave se toma la primera en orden del archivo.
export function paseExacto(ctx: ContextoCruce): Propuesta[] {
  const salida: Propuesta[] = [];
  const porClave = (clave: (j: number) => string | null, claveBanco: (i: number) => string | null,
    motivo: 'referencia' | 'fecha', puntaje: number) => {
    const indice = new Map<string, number[]>();
    ctx.ventas.forEach((_, j) => {
      if (!ctx.libreVenta[j]) return;
      const k = clave(j);
      if (k === null) return;
      const lista = indice.get(k);
      if (lista) lista.push(j); else indice.set(k, [j]);
    });
    const posicion = new Map<string, number>(); // siguiente venta libre de cada lista
    ctx.banco.forEach((_, i) => {
      if (!ctx.libreBanco[i]) return;
      const k = claveBanco(i);
      if (k === null) return;
      const lista = indice.get(k);
      if (!lista) return;
      const pos = posicion.get(k) ?? 0;
      if (pos >= lista.length) return;
      posicion.set(k, pos + 1);
      const j = lista[pos];
      const p: Propuesta = {
        tipo: 'exacta', banco: [i], ventas: [j], puntaje, motivo,
        dias: [ctx.diaBanco[i] - ctx.diaVenta[j]],
      };
      ocupar(ctx, p);
      salida.push(p);
    });
  };
  porClave(
    (j) => (ctx.ventas[j].referencia ? `${ctx.ventas[j].montoCentavos}|${ctx.ventas[j].referencia}` : null),
    (i) => (ctx.banco[i].referencia ? `${ctx.banco[i].montoCentavos}|${ctx.banco[i].referencia}` : null),
    'referencia', 1,
  );
  // Mismo monto y día pero referencias distintas: algo menos seguro.
  porClave(
    (j) => `${ctx.ventas[j].montoCentavos}|${ctx.ventas[j].fecha}`,
    (i) => `${ctx.banco[i].montoCentavos}|${ctx.banco[i].fecha}`,
    'fecha', 0.95,
  );
  return salida;
}

// ---------- Pase 2: tolerancia 1:1 con AVL + Trie + TopK + grafo ----------

// Candidatos que se guardan por abono; más no cambian el resultado en la práctica
// y mantienen el grafo pequeño.
export const CANDIDATOS_POR_ABONO = 5;

interface Candidato {
  i: number; j: number; puntaje: number; dias: number; similitud: number; prefijo: boolean; diferencia: number;
}

const claveBanco = (i: number) => `b${i}`;
const claveVenta = (j: number) => `v${j}`;
const indiceDe = (clave: string) => Number(clave.slice(1));

export function paseTolerancia(ctx: ContextoCruce): {
  propuestas: Propuesta[];
  grafo: { nodos: { id: string; lado: 'banco' | 'ventas' }[]; aristas: { banco: string; venta: string; peso: number }[] };
} {
  const { perfil } = ctx;
  const arbol = new ArbolAVL<number>();
  const trie = new Trie<number>();
  ctx.ventas.forEach((v, j) => {
    if (!ctx.libreVenta[j]) return;
    arbol.insertar(v.montoCentavos, j);
    if (v.referencia.length >= LARGO_MINIMO_PREFIJO) trie.insertar(v.referencia, j);
  });

  const grafo = new GrafoBipartito();
  const candidatos = new Map<string, Candidato>();

  ctx.banco.forEach((b, i) => {
    if (!ctx.libreBanco[i]) return;
    // Referencias por prefijo: el banco suele truncar (buscarPrefijo) o agregar texto al final (prefijosDe).
    const porPrefijo = new Set<number>();
    if (b.referencia.length >= LARGO_MINIMO_PREFIJO) {
      for (const j of trie.buscarPrefijo(b.referencia)) porPrefijo.add(j);
      for (const j of trie.prefijosDe(b.referencia)) porPrefijo.add(j);
    }
    const { min, max } = rangoVentas(b.montoCentavos, perfil);
    const mejores = new TopK<Candidato>(CANDIDATOS_POR_ABONO, (c) => c.puntaje);
    for (const j of arbol.buscarRango(min, max)) {
      if (!ctx.libreVenta[j]) continue;
      const v = ctx.ventas[j];
      const dias = ctx.diaBanco[i] - ctx.diaVenta[j];
      if (!dentroDeVentana(dias, perfil) || !dentroDeTolerancia(b.montoCentavos, v.montoCentavos, perfil)) continue;
      const prefijo = porPrefijo.has(j);
      const similitud = similitudReferencia(b.referencia, v.referencia, prefijo);
      const puntaje = puntaje1a1(puntajeMonto(b.montoCentavos, v.montoCentavos, perfil), puntajeFecha(dias, perfil), similitud);
      // Bajo el umbral de sugerencia no vale la pena mostrarlo: queda para revisión manual.
      if (puntaje < perfil.umbralSugerencia) continue;
      mejores.agregar({ i, j, puntaje, dias, similitud, prefijo, diferencia: b.montoCentavos - v.montoCentavos });
    }
    for (const c of mejores.resultado()) {
      grafo.agregarArista(claveBanco(i), claveVenta(c.j), c.puntaje);
      candidatos.set(`${i}|${c.j}`, c);
    }
  });

  // Conflictos: cada componente conexa es un grupo de abonos que se disputan ventas.
  // Dentro de cada una se asigna greedy de mayor a menor puntaje sin repetir nodos.
  // No garantiza el emparejamiento óptimo, pero sí evita el error del greedy ingenuo
  // (abono por abono en orden de archivo), que deja sin pareja al que tenía su única opción.
  const elegidos: Candidato[] = [];
  for (const componente of grafo.componentes()) {
    const aristas: Candidato[] = [];
    for (const clave of componente) {
      if (clave[0] !== 'b') continue;
      const i = indiceDe(clave);
      for (const vecino of grafo.vecinos(clave)) aristas.push(candidatos.get(`${i}|${indiceDe(vecino.id)}`)!);
    }
    // Desempates: menor diferencia, luego orden del archivo (resultado reproducible).
    aristas.sort((a, b) => b.puntaje - a.puntaje || Math.abs(a.diferencia) - Math.abs(b.diferencia) || a.i - b.i || a.j - b.j);
    const usadosB = new Set<number>();
    const usadosV = new Set<number>();
    for (const c of aristas) {
      if (usadosB.has(c.i) || usadosV.has(c.j)) continue;
      usadosB.add(c.i);
      usadosV.add(c.j);
      elegidos.push(c);
    }
  }

  // Ids de coincidencia en orden del extracto, no en orden de componentes.
  elegidos.sort((a, b) => a.i - b.i);
  const propuestas = elegidos.map((c): Propuesta => ({
    tipo: 'tolerancia', banco: [c.i], ventas: [c.j], puntaje: c.puntaje, motivo: 'candidato',
    dias: [c.dias], similitud: c.similitud, prefijo: c.prefijo,
  }));
  for (const p of propuestas) ocupar(ctx, p);

  // El grafo se entrega con los ids reales; el lado distingue ids repetidos entre lados.
  const real = (clave: string) => (clave[0] === 'b' ? ctx.banco : ctx.ventas)[indiceDe(clave)].id;
  return {
    propuestas,
    grafo: {
      nodos: grafo.nodos().map((n) => ({ id: real(n.id), lado: n.lado })),
      aristas: grafo.aristas().map((a) => ({ banco: real(a.banco), venta: real(a.venta), peso: a.peso })),
    },
  };
}

// ---------- Pase 3: agrupada N:1 por suma de subconjuntos ----------

export const MAX_CANDIDATOS_GRUPO = 40;
// Tope de nodos del backtracking por abono: acota el peor caso sin depender del reloj.
export const PRESUPUESTO_BUSQUEDA = 50_000;

export function paseAgrupado(ctx: ContextoCruce): { propuestas: Propuesta[]; omitidos: number } {
  const { perfil } = ctx;
  const propuestas: Propuesta[] = [];
  let omitidos = 0;
  if (perfil.maxGrupo < 2) return { propuestas, omitidos };

  // Ventas libres ordenadas por día para recortar la ventana con búsqueda binaria.
  const porDia = ctx.ventas.map((_, j) => j).filter((j) => ctx.libreVenta[j] && ctx.ventas[j].montoCentavos > 0)
    .sort((a, b) => ctx.diaVenta[a] - ctx.diaVenta[b] || a - b);
  const primeroDesde = (dia: number) => {
    let lo = 0, hi = porDia.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (ctx.diaVenta[porDia[m]] < dia) lo = m + 1; else hi = m;
    }
    return lo;
  };

  ctx.banco.forEach((b, i) => {
    if (!ctx.libreBanco[i] || b.montoCentavos <= 0) return;
    const { min, max } = rangoVentas(b.montoCentavos, perfil);
    const desde = ctx.diaBanco[i] - perfil.ventanaDias;
    const hasta = ctx.diaBanco[i] + perfil.diasDespues;
    const cand: number[] = [];
    for (let k = primeroDesde(desde); k < porDia.length && ctx.diaVenta[porDia[k]] <= hasta; k++) {
      const j = porDia[k];
      if (ctx.libreVenta[j] && ctx.ventas[j].montoCentavos <= max) cand.push(j);
    }
    if (cand.length < 2) return;
    if (cand.length > MAX_CANDIDATOS_GRUPO) { omitidos++; return; }

    // Montos de mayor a menor: la suma crece rápido y la poda corta antes.
    cand.sort((a, b) => ctx.ventas[b].montoCentavos - ctx.ventas[a].montoCentavos || a - b);
    const montos = cand.map((j) => ctx.ventas[j].montoCentavos);
    const acumulado = [0];
    for (const m of montos) acumulado.push(acumulado[acumulado.length - 1] + m);
    // Lo máximo que pueden sumar r ventas desde la posición k (las siguientes son las mayores).
    const maximoDesde = (k: number, r: number) => acumulado[Math.min(montos.length, k + r)] - acumulado[k];

    let mejor: { elegidos: number[]; puntaje: number } | null = null;
    let nodos = 0;
    let cortado = false;
    const pila: number[] = [];

    const evaluar = (suma: number) => {
      if (!dentroDeTolerancia(b.montoCentavos, suma, perfil)) return;
      let fecha = 0;
      for (const k of pila) fecha += puntajeFecha(ctx.diaBanco[i] - ctx.diaVenta[cand[k]], perfil);
      const puntaje = puntajeGrupo(puntajeMonto(b.montoCentavos, suma, perfil), fecha / pila.length);
      if (mejor === null || puntaje > mejor.puntaje) mejor = { elegidos: pila.slice(), puntaje };
    };

    const buscar = (desdeK: number, suma: number) => {
      if (++nodos > PRESUPUESTO_BUSQUEDA) { cortado = true; return; }
      if (pila.length >= 2 && suma >= min && suma <= max) evaluar(suma);
      const libres = perfil.maxGrupo - pila.length;
      if (libres === 0) return;
      for (let k = desdeK; k < montos.length && !cortado; k++) {
        const nueva = suma + montos[k];
        if (nueva > max) continue; // las siguientes son menores: alguna puede caber
        // Ni tomando las mayores restantes se llega al mínimo: los k siguientes tampoco.
        if (nueva + maximoDesde(k + 1, libres - 1) < min) break;
        pila.push(k);
        buscar(k + 1, nueva);
        pila.pop();
      }
    };
    buscar(0, 0);

    if (mejor === null) {
      if (cortado) omitidos++; // no se terminó de buscar: mejor que lo vea una persona
      return;
    }
    const elegido = mejor as { elegidos: number[]; puntaje: number };
    const ventas = elegido.elegidos.map((k) => cand[k]).sort((a, b) => a - b);
    const p: Propuesta = {
      tipo: 'agrupada', banco: [i], ventas, puntaje: elegido.puntaje, motivo: 'suma',
      dias: ventas.map((j) => ctx.diaBanco[i] - ctx.diaVenta[j]),
    };
    ocupar(ctx, p);
    propuestas.push(p);
  });

  return { propuestas, omitidos };
}
