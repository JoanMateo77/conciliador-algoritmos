// Los pases del cruce, de barato a caro. Cada pase solo ve lo que quedó libre
// y marca como ocupado lo que empareja: así ningún movimiento cae en dos coincidencias.
import type { Movimiento } from '../modelo.ts';
import type { Perfil } from './perfil.ts';
import { normalizarReferencia } from '../modelo.ts';
import { ArbolAVL } from '../estructuras/ArbolAVL.ts';
import { Trie } from '../estructuras/Trie.ts';
import { TopK } from '../estructuras/MinHeap.ts';
import { GrafoBipartito } from '../estructuras/GrafoBipartito.ts';
import {
  dentroDeTolerancia, dentroDeVentana, rangoVentas, similitudReferencia, puntajeMonto, puntajeFecha,
  puntaje1a1, puntajeGrupo, redondear, LARGO_MINIMO_PREFIJO,
} from './puntaje.ts';
import { emparejamientoMaximo } from './hungaro.ts';

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
  // Reglas (fase 10). null = ninguna regla de ese tipo, el camino rápido del MVP.
  clasificadoBanco: boolean[];
  clasificadoVenta: boolean[];
  perfilBanco: (Perfil | null)[] | null;   // tolerancia propia por regla
  perfilVenta: (Perfil | null)[] | null;
  perfilRangoVentas: Perfil;               // el más amplio entre el perfil y las reglas de ventas (rango del AVL)
  exigeBanco: (string | null)[] | null;    // nombre de la regla que exige la misma referencia
  exigeVenta: (string | null)[] | null;
  // Lo que los pases dejan anotado para explicar luego por qué algo no cruzó (fase 11).
  candidatos: Map<number, { j: number; puntaje: number }[]>; // aristas del pase 2 por abono
  omitidoGrupo: Map<number, number>;       // abono -> ventas libres en su ventana al omitir el grupo
  referenciaFuera: Map<number, number>;    // abono -> venta que su referencia nombra pero no cuadra
}

export interface Propuesta {
  tipo: 'exacta' | 'tolerancia' | 'agrupada' | 'agrupadaNM';
  banco: number[];
  ventas: number[];
  puntaje: number;
  motivo: 'referencia' | 'referenciaPago' | 'fecha' | 'candidato' | 'suma';
  dias: number[];             // por venta: días entre la venta y el abono más cercano (positivo = antes)
  similitud?: number;         // tolerancia: similitud de referencia usada
  prefijo?: boolean;          // tolerancia: la referencia se halló por prefijo en el Trie
}

export const DIA_MS = 86_400_000;

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
    clasificadoBanco: banco.map(() => false),
    clasificadoVenta: ventas.map(() => false),
    perfilBanco: null,
    perfilVenta: null,
    perfilRangoVentas: perfil,
    exigeBanco: null,
    exigeVenta: null,
    candidatos: new Map(),
    omitidoGrupo: new Map(),
    referenciaFuera: new Map(),
  };
}

// Perfil que decide la tolerancia de una pareja: la regla del abono, luego la de la venta.
export function perfilPar(ctx: ContextoCruce, i: number, j: number): Perfil {
  return ctx.perfilBanco?.[i] ?? ctx.perfilVenta?.[j] ?? ctx.perfil;
}

export const referenciaPago = (m: Movimiento) => (m.referenciaPago ? normalizarReferencia(m.referenciaPago) : '');

// Con una regla exigirReferencia, la pareja solo vale si comparte referencia (o referencia de pago).
export function referenciaCompatible(ctx: ContextoCruce, i: number, j: number): boolean {
  if (!ctx.exigeBanco?.[i] && !ctx.exigeVenta?.[j]) return true;
  const b = ctx.banco[i];
  const v = ctx.ventas[j];
  if (b.referencia !== '' && b.referencia === v.referencia) return true;
  const pb = referenciaPago(b);
  const pv = referenciaPago(v);
  return (pb !== '' && (pb === pv || pb === v.referencia)) || (pv !== '' && pv === b.referencia);
}

function ocupar(ctx: ContextoCruce, p: Propuesta): void {
  for (const i of p.banco) ctx.libreBanco[i] = false;
  for (const j of p.ventas) ctx.libreVenta[j] = false;
}

// ---------- Pase 1: exacta, O(n + m) con Map ----------

// Bre-B primero (la referencia de pago identifica la transferencia de punta a punta), luego
// monto|referencia y al final monto|fecha. Con varias ventas bajo la misma clave se toma
// la primera libre en orden del archivo.
export function paseExacto(ctx: ContextoCruce): Propuesta[] {
  const salida: Propuesta[] = [];
  const porClave = (claves: (j: number) => string[], clavesBanco: (i: number) => string[],
    motivo: Propuesta['motivo'], puntaje: number) => {
    const indice = new Map<string, number[]>();
    ctx.ventas.forEach((_, j) => {
      if (!ctx.libreVenta[j]) return;
      for (const k of claves(j)) {
        const lista = indice.get(k);
        if (!lista) indice.set(k, [j]);
        else if (lista[lista.length - 1] !== j) lista.push(j);
      }
    });
    const posicion = new Map<string, number>(); // siguiente venta libre de cada lista
    ctx.banco.forEach((_, i) => {
      if (!ctx.libreBanco[i]) return;
      for (const k of clavesBanco(i)) {
        const lista = indice.get(k);
        if (!lista) continue;
        let pos = posicion.get(k) ?? 0;
        // Una venta puede estar en dos listas (referencia de pago y referencia): se salta si ya se usó.
        while (pos < lista.length && !ctx.libreVenta[lista[pos]]) pos++;
        posicion.set(k, pos + 1);
        if (pos >= lista.length) continue;
        const j = lista[pos];
        const p: Propuesta = {
          tipo: 'exacta', banco: [i], ventas: [j], puntaje, motivo,
          dias: [ctx.diaBanco[i] - ctx.diaVenta[j]],
        };
        ocupar(ctx, p);
        salida.push(p);
        return;
      }
    });
  };
  const monto = (m: Movimiento) => m.montoCentavos;
  // Bre-B (0.2.0): la referencia de pago es la llave más fuerte. Con cruceOptimo: false se apaga
  // junto con las demás mejoras, para que un perfil del MVP dé exactamente lo mismo que en 0.1.0.
  const usarReferenciaPago = ctx.perfil.cruceOptimo !== false
    && (ctx.banco.some((m) => m.referenciaPago) || ctx.ventas.some((m) => m.referenciaPago));
  if (usarReferenciaPago) {
    // Referencia de pago del abono contra referencia de pago o referencia de la venta.
    porClave(
      (j) => {
        const v = ctx.ventas[j];
        const pv = referenciaPago(v);
        const claves = pv ? [`${monto(v)}|${pv}`] : [];
        if (v.referencia && v.referencia !== pv) claves.push(`${monto(v)}|${v.referencia}`);
        return claves;
      },
      (i) => (referenciaPago(ctx.banco[i]) ? [`${monto(ctx.banco[i])}|${referenciaPago(ctx.banco[i])}`] : []),
      'referenciaPago', 1,
    );
    // Referencia de pago de la venta contra la referencia del abono.
    porClave(
      (j) => (referenciaPago(ctx.ventas[j]) ? [`${monto(ctx.ventas[j])}|${referenciaPago(ctx.ventas[j])}`] : []),
      (i) => (ctx.banco[i].referencia ? [`${monto(ctx.banco[i])}|${ctx.banco[i].referencia}`] : []),
      'referenciaPago', 1,
    );
  }
  porClave(
    (j) => (ctx.ventas[j].referencia ? [`${monto(ctx.ventas[j])}|${ctx.ventas[j].referencia}`] : []),
    (i) => (ctx.banco[i].referencia ? [`${monto(ctx.banco[i])}|${ctx.banco[i].referencia}`] : []),
    'referencia', 1,
  );
  // Mismo monto y día pero referencias distintas: algo menos seguro. No vale si una regla exige referencia.
  porClave(
    (j) => (ctx.exigeVenta?.[j] ? [] : [`${monto(ctx.ventas[j])}|${ctx.ventas[j].fecha}`]),
    (i) => (ctx.exigeBanco?.[i] ? [] : [`${monto(ctx.banco[i])}|${ctx.banco[i].fecha}`]),
    'fecha', 0.95,
  );
  return salida;
}

// ---------- Pase 2: tolerancia 1:1 con AVL + Trie + TopK + grafo ----------

// Candidatos que se guardan por abono; más no cambian el resultado en la práctica
// y mantienen el grafo pequeño.
export const CANDIDATOS_POR_ABONO = 5;
// Hasta este tamaño de componente se usa el Húngaro (O(k³)); más grande, el greedy.
export const MAX_NODOS_OPTIMO = 60;

export interface AristaCruce { i: number; j: number; puntaje: number; diferencia: number }

interface Candidato extends AristaCruce {
  dias: number; similitud: number; prefijo: boolean;
}

const claveBanco = (i: number) => `b${i}`;
const claveVenta = (j: number) => `v${j}`;
const indiceDe = (clave: string) => Number(clave.slice(1));

// Greedy por componente (MVP): de mayor a menor puntaje sin repetir nodos.
// Desempates: menor diferencia, luego orden del archivo (resultado reproducible).
export function asignarGreedy<T extends AristaCruce>(aristas: T[]): T[] {
  const orden = aristas.slice().sort((a, b) => b.puntaje - a.puntaje || Math.abs(a.diferencia) - Math.abs(b.diferencia) || a.i - b.i || a.j - b.j);
  const usadosB = new Set<number>();
  const usadosV = new Set<number>();
  const salida: T[] = [];
  for (const c of orden) {
    if (usadosB.has(c.i) || usadosV.has(c.j)) continue;
    usadosB.add(c.i);
    usadosV.add(c.j);
    salida.push(c);
  }
  return salida;
}

// Asignación óptima con el Húngaro: maximiza la suma de puntajes del componente.
// Pesos enteros: puntaje (4 decimales) en la parte alta y, en la baja, una penalización
// por el puesto de la arista en el orden de desempate del greedy. Así, a igual suma
// de puntajes, gana la misma preferencia que usa el greedy y el resultado es reproducible.
const ESCALA_DESEMPATE = 2 ** 20; // > suma de puestos posible (<= 30 parejas x 300 aristas)
export function asignarOptimo<T extends AristaCruce>(aristas: T[]): T[] {
  if (aristas.length <= 1) return aristas.slice();
  const filas = [...new Set(aristas.map((a) => a.i))].sort((a, b) => a - b);
  const columnas = [...new Set(aristas.map((a) => a.j))].sort((a, b) => a - b);
  const fila = new Map(filas.map((i, n) => [i, n]));
  const columna = new Map(columnas.map((j, n) => [j, n]));
  const puesto = aristas.slice().sort((a, b) => Math.abs(a.diferencia) - Math.abs(b.diferencia) || a.i - b.i || a.j - b.j);
  const pesos: (number | null)[][] = filas.map(() => columnas.map(() => null));
  const arista: (T | null)[][] = filas.map(() => columnas.map(() => null));
  puesto.forEach((a, n) => {
    const f = fila.get(a.i)!;
    const c = columna.get(a.j)!;
    pesos[f][c] = Math.round(a.puntaje * 10_000) * ESCALA_DESEMPATE - n;
    arista[f][c] = a;
  });
  return emparejamientoMaximo(pesos).map(({ fila: f, columna: c }) => arista[f][c]!);
}

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
    const { min, max } = rangoVentas(b.montoCentavos, ctx.perfilBanco?.[i] ?? ctx.perfilRangoVentas);
    const mejores = new TopK<Candidato>(CANDIDATOS_POR_ABONO, (c) => c.puntaje);
    for (const j of arbol.buscarRango(min, max)) {
      if (!ctx.libreVenta[j]) continue;
      const v = ctx.ventas[j];
      const p = perfilPar(ctx, i, j);
      const dias = ctx.diaBanco[i] - ctx.diaVenta[j];
      if (!dentroDeVentana(dias, perfil) || !dentroDeTolerancia(b.montoCentavos, v.montoCentavos, p)) continue;
      if (!referenciaCompatible(ctx, i, j)) continue;
      const prefijo = porPrefijo.has(j);
      const similitud = similitudReferencia(b.referencia, v.referencia, prefijo);
      const puntaje = puntaje1a1(puntajeMonto(b.montoCentavos, v.montoCentavos, p), puntajeFecha(dias, perfil), similitud);
      // Bajo el umbral de sugerencia no vale la pena mostrarlo: queda para revisión manual.
      if (puntaje < perfil.umbralSugerencia) continue;
      mejores.agregar({ i, j, puntaje, dias, similitud, prefijo, diferencia: b.montoCentavos - v.montoCentavos });
    }
    const lista = mejores.resultado();
    if (lista.length > 0) ctx.candidatos.set(i, lista.map((c) => ({ j: c.j, puntaje: c.puntaje })));
    for (const c of lista) {
      grafo.agregarArista(claveBanco(i), claveVenta(c.j), c.puntaje);
      candidatos.set(`${i}|${c.j}`, c);
    }
  });

  // Conflictos: cada componente conexa es un grupo de abonos que se disputan ventas.
  // Con cruceOptimo (por defecto) y componentes de hasta 60 nodos se usa el Húngaro, que
  // maximiza la suma de puntajes; en componentes más grandes, el greedy del MVP, que evita
  // el error del greedy ingenuo (abono por abono en orden de archivo) sin costo cúbico.
  const optimo = perfil.cruceOptimo !== false;
  const elegidos: Candidato[] = [];
  for (const componente of grafo.componentes()) {
    const aristas: Candidato[] = [];
    for (const clave of componente) {
      if (clave[0] !== 'b') continue;
      const i = indiceDe(clave);
      for (const vecino of grafo.vecinos(clave)) aristas.push(candidatos.get(`${i}|${indiceDe(vecino.id)}`)!);
    }
    const usarOptimo = optimo && componente.length <= MAX_NODOS_OPTIMO && aristas.length > 1;
    elegidos.push(...(usarOptimo ? asignarOptimo(aristas) : asignarGreedy(aristas)));
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

// ---------- Suma de subconjuntos acotada (pases 3 y N:M) ----------

export const MAX_CANDIDATOS_GRUPO = 40;
// Tope de nodos del backtracking por búsqueda: acota el peor caso sin depender del reloj.
export const PRESUPUESTO_BUSQUEDA = 50_000;

interface Hallazgo { elegidos: number[]; puntaje: number }

// montos de mayor a menor. Busca subconjuntos de minimo..maximo elementos cuya suma caiga
// en [min, max] y se queda con el de mayor puntaje según evaluar (null = no sirve).
// Poda: corta si la suma pasa el máximo o si ni las mayores restantes alcanzan el mínimo.
function buscarSubconjunto(montos: number[], min: number, max: number, minimo: number, maximo: number,
  presupuesto: number, evaluar: (pila: number[], suma: number) => number | null): { mejor: Hallazgo | null; cortado: boolean } {
  const acumulado = [0];
  for (const m of montos) acumulado.push(acumulado[acumulado.length - 1] + m);
  // Lo máximo que pueden sumar r elementos desde la posición k (los siguientes son los mayores).
  const maximoDesde = (k: number, r: number) => acumulado[Math.min(montos.length, k + r)] - acumulado[k];
  let mejor: Hallazgo | null = null;
  let nodos = 0;
  let cortado = false;
  const pila: number[] = [];
  const buscar = (desdeK: number, suma: number) => {
    if (++nodos > presupuesto) { cortado = true; return; }
    if (pila.length >= minimo && suma >= min && suma <= max) {
      const puntaje = evaluar(pila, suma);
      if (puntaje !== null && (mejor === null || puntaje > mejor.puntaje)) mejor = { elegidos: pila.slice(), puntaje };
    }
    const libres = maximo - pila.length;
    if (libres === 0) return;
    for (let k = desdeK; k < montos.length && !cortado; k++) {
      const nueva = suma + montos[k];
      if (nueva > max) continue; // los siguientes son menores: alguno puede caber
      // Ni tomando los mayores restantes se llega al mínimo: los k siguientes tampoco.
      if (nueva + maximoDesde(k + 1, libres - 1) < min) break;
      pila.push(k);
      buscar(k + 1, nueva);
      pila.pop();
    }
  };
  buscar(0, 0);
  return { mejor, cortado };
}

// Ventas libres (monto > 0, sin regla de referencia) ordenadas por día, con búsqueda binaria.
function ventasPorDia(ctx: ContextoCruce): { porDia: number[]; primeroDesde: (dia: number) => number } {
  const porDia = ctx.ventas.map((_, j) => j)
    .filter((j) => ctx.libreVenta[j] && ctx.ventas[j].montoCentavos > 0 && !ctx.exigeVenta?.[j])
    .sort((a, b) => ctx.diaVenta[a] - ctx.diaVenta[b] || a - b);
  const primeroDesde = (dia: number) => {
    let lo = 0, hi = porDia.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (ctx.diaVenta[porDia[m]] < dia) lo = m + 1; else hi = m;
    }
    return lo;
  };
  return { porDia, primeroDesde };
}

// Ventas (no clasificadas) por referencia: un abono cuya referencia nombra una venta concreta
// no debe agruparse con otras ventas que no la incluyan (ver nota del 4 % en ESCENARIO.md).
function ventasPorReferencia(ctx: ContextoCruce): Map<string, number[]> {
  const mapa = new Map<string, number[]>();
  ctx.ventas.forEach((v, j) => {
    if (ctx.clasificadoVenta[j] || v.referencia === '') return;
    const lista = mapa.get(v.referencia);
    if (lista) lista.push(j); else mapa.set(v.referencia, [j]);
  });
  return mapa;
}

// ---------- Pase 3: agrupada N:1 por suma de subconjuntos ----------

export function paseAgrupado(ctx: ContextoCruce): { propuestas: Propuesta[]; omitidos: number } {
  const { perfil } = ctx;
  const propuestas: Propuesta[] = [];
  let omitidos = 0;
  if (perfil.maxGrupo < 2) return { propuestas, omitidos };

  const { porDia, primeroDesde } = ventasPorDia(ctx);
  const porReferencia = ventasPorReferencia(ctx);

  ctx.banco.forEach((b, i) => {
    if (!ctx.libreBanco[i] || b.montoCentavos <= 0 || ctx.exigeBanco?.[i]) return;
    const pb = ctx.perfilBanco?.[i] ?? perfil;
    const { min, max } = rangoVentas(b.montoCentavos, pb);
    const desde = ctx.diaBanco[i] - perfil.ventanaDias;
    const hasta = ctx.diaBanco[i] + perfil.diasDespues;
    const cand: number[] = [];
    for (let k = primeroDesde(desde); k < porDia.length && ctx.diaVenta[porDia[k]] <= hasta; k++) {
      const j = porDia[k];
      if (ctx.libreVenta[j] && ctx.ventas[j].montoCentavos <= max) cand.push(j);
    }
    // Si la referencia del abono nombra una venta, el grupo tiene que incluirla (evita sumas
    // casuales de ventas ajenas). Es parte del cruce óptimo: con cruceOptimo false el pase 3
    // se comporta como en 0.1.0.
    const nombradas = b.referencia !== '' && perfil.cruceOptimo !== false ? porReferencia.get(b.referencia) : undefined;
    let requeridas: Set<number> | null = null;
    if (nombradas) {
      requeridas = new Set(nombradas.filter((j) => cand.includes(j)));
      if (requeridas.size === 0) { ctx.referenciaFuera.set(i, nombradas[0]); return; }
    }
    if (cand.length < 2) return;
    if (cand.length > MAX_CANDIDATOS_GRUPO) { omitidos++; ctx.omitidoGrupo.set(i, cand.length); return; }

    // Montos de mayor a menor: la suma crece rápido y la poda corta antes.
    cand.sort((a, c) => ctx.ventas[c].montoCentavos - ctx.ventas[a].montoCentavos || a - c);
    const montos = cand.map((j) => ctx.ventas[j].montoCentavos);
    const req = requeridas;
    const { mejor, cortado } = buscarSubconjunto(montos, min, max, 2, perfil.maxGrupo, PRESUPUESTO_BUSQUEDA, (pila, suma) => {
      if (!dentroDeTolerancia(b.montoCentavos, suma, pb)) return null;
      if (req && !pila.some((k) => req.has(cand[k]))) return null;
      let fecha = 0;
      for (const k of pila) fecha += puntajeFecha(ctx.diaBanco[i] - ctx.diaVenta[cand[k]], perfil);
      return puntajeGrupo(puntajeMonto(b.montoCentavos, suma, pb), fecha / pila.length);
    });

    if (mejor === null) {
      // No se terminó de buscar: mejor que lo vea una persona.
      if (cortado) { omitidos++; ctx.omitidoGrupo.set(i, cand.length); }
      return;
    }
    const ventas = mejor.elegidos.map((k) => cand[k]).sort((a, c) => a - c);
    const p: Propuesta = {
      tipo: 'agrupada', banco: [i], ventas, puntaje: mejor.puntaje, motivo: 'suma',
      dias: ventas.map((j) => ctx.diaBanco[i] - ctx.diaVenta[j]),
    };
    ocupar(ctx, p);
    propuestas.push(p);
  });

  return { propuestas, omitidos };
}

// ---------- Pase 4 (opcional): clusters N:M por componente ----------

// Varios abonos que juntos pagan varias ventas (p. ej. una liquidación partida en dos
// depósitos). Sobre lo que quedó libre se arma un GrafoBipartito abono↔venta por ventana
// de fechas; en cada componente pequeña se busca el subconjunto de abonos (2 o más) y de
// ventas cuyas sumas cuadran dentro de la tolerancia. Siempre queda como sugerida.
// Igual que el pase 3, se apaga con maxGrupo < 2: en el MVP maxGrupo 1 era "no agrupar".
export const MAX_NODOS_NM = 24;
export const MAX_ABONOS_NM = 6;
const PRESUPUESTO_NM = 20_000; // por subconjunto de abonos (hasta 57 por componente)
const FACTOR_NM = 0.95;        // N:M es menos seguro que N:1

export function paseNM(ctx: ContextoCruce): { propuestas: Propuesta[]; omitidos: number } {
  const { perfil } = ctx;
  const propuestas: Propuesta[] = [];
  let omitidos = 0;
  if (perfil.maxGrupo < 2) return { propuestas, omitidos };

  const { porDia, primeroDesde } = ventasPorDia(ctx);
  const grafo = new GrafoBipartito();
  ctx.banco.forEach((b, i) => {
    if (!ctx.libreBanco[i] || b.montoCentavos <= 0 || ctx.exigeBanco?.[i] || ctx.referenciaFuera.has(i)) return;
    const desde = ctx.diaBanco[i] - perfil.ventanaDias;
    const hasta = ctx.diaBanco[i] + perfil.diasDespues;
    const inicio = primeroDesde(desde);
    let fin = inicio;
    // Basta saber si pasa del máximo: no hace falta contar toda la ventana.
    while (fin < porDia.length && ctx.diaVenta[porDia[fin]] <= hasta && fin - inicio <= MAX_CANDIDATOS_GRUPO) fin++;
    if (fin === inicio) return;
    if (fin - inicio > MAX_CANDIDATOS_GRUPO) {
      // No se agregan sus aristas: haría componentes enormes que de todas formas se omitirían.
      if (!ctx.omitidoGrupo.has(i)) ctx.omitidoGrupo.set(i, fin - inicio);
      return;
    }
    for (let k = inicio; k < fin; k++) {
      const j = porDia[k];
      grafo.agregarArista(claveBanco(i), claveVenta(j), puntajeFecha(ctx.diaBanco[i] - ctx.diaVenta[j], perfil));
    }
  });

  for (const componente of grafo.componentes()) {
    const abonos = componente.filter((c) => c[0] === 'b').map(indiceDe).sort((a, b) => a - b);
    if (abonos.length < 2) continue; // un solo abono ya lo intentó el pase 3
    if (componente.length > MAX_NODOS_NM || abonos.length > MAX_ABONOS_NM) {
      omitidos++;
      for (const i of abonos) if (!ctx.omitidoGrupo.has(i)) ctx.omitidoGrupo.set(i, componente.length - abonos.length);
      continue;
    }
    // Se repite mientras aparezcan clusters: cada uno libera el resto del componente para el siguiente.
    for (;;) {
      const libres = abonos.filter((i) => ctx.libreBanco[i]);
      if (libres.length < 2) break;
      let mejor: { banco: number[]; ventas: number[]; puntaje: number } | null = null;
      let cortado = false;
      for (let mascara = 1; mascara < 1 << libres.length; mascara++) {
        const sub = libres.filter((_, n) => mascara & (1 << n));
        if (sub.length < 2) continue;
        const suma = sub.reduce((s, i) => s + ctx.banco[i].montoCentavos, 0);
        const { min, max } = rangoVentas(suma, perfil);
        const cand = new Set<number>();
        for (const i of sub) {
          for (const vecino of grafo.vecinos(claveBanco(i))) {
            const j = indiceDe(vecino.id);
            if (ctx.libreVenta[j] && ctx.ventas[j].montoCentavos <= max) cand.add(j);
          }
        }
        const lista = [...cand].sort((a, c) => ctx.ventas[c].montoCentavos - ctx.ventas[a].montoCentavos || a - c);
        if (lista.length === 0) continue;
        const montos = lista.map((j) => ctx.ventas[j].montoCentavos);
        const r = buscarSubconjunto(montos, min, max, 1, perfil.maxGrupo, PRESUPUESTO_NM, (pila, total) => {
          if (!dentroDeTolerancia(suma, total, perfil)) return null;
          // Cada abono debe tener al menos una venta del grupo en su ventana.
          for (const i of sub) {
            if (!pila.some((k) => dentroDeVentana(ctx.diaBanco[i] - ctx.diaVenta[lista[k]], perfil))) return null;
          }
          let fecha = 0;
          for (const k of pila) {
            let mejorFecha = 0;
            for (const i of sub) {
              const d = ctx.diaBanco[i] - ctx.diaVenta[lista[k]];
              if (dentroDeVentana(d, perfil)) mejorFecha = Math.max(mejorFecha, puntajeFecha(d, perfil));
            }
            fecha += mejorFecha;
          }
          return redondear(FACTOR_NM * puntajeGrupo(puntajeMonto(suma, total, perfil), fecha / pila.length));
        });
        if (r.cortado) cortado = true;
        if (r.mejor && (mejor === null || r.mejor.puntaje > mejor.puntaje)) {
          mejor = { banco: sub, ventas: r.mejor.elegidos.map((k) => lista[k]).sort((a, c) => a - c), puntaje: r.mejor.puntaje };
        }
      }
      if (mejor === null) {
        if (cortado) {
          omitidos++;
          for (const i of libres) if (!ctx.omitidoGrupo.has(i)) ctx.omitidoGrupo.set(i, componente.length - abonos.length);
        }
        break;
      }
      const elegido = mejor;
      const p: Propuesta = {
        tipo: 'agrupadaNM', banco: elegido.banco, ventas: elegido.ventas, puntaje: elegido.puntaje, motivo: 'suma',
        // Días respecto al abono más cercano de los que están en su ventana.
        dias: elegido.ventas.map((j) => {
          let mejorD = Infinity;
          for (const i of elegido.banco) {
            const d = ctx.diaBanco[i] - ctx.diaVenta[j];
            if (dentroDeVentana(d, perfil) && Math.abs(d) < Math.abs(mejorD)) mejorD = d;
          }
          return mejorD;
        }),
      };
      ocupar(ctx, p);
      propuestas.push(p);
    }
  }
  // Orden del extracto, como en los demás pases.
  propuestas.sort((a, b) => a.banco[0] - b.banco[0]);
  return { propuestas, omitidos };
}
