// Fase 11: Húngaro propio contra fuerza bruta, propiedad "nunca peor que el greedy",
// clusters N:M y motivos de lo que no cruzó. Datos sintéticos.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Movimiento } from '../src/modelo.ts';
import { normalizarReferencia } from '../src/modelo.ts';
import type { AristaCruce, Perfil, ResultadoConciliacion } from '../src/cruce/index.ts';
import {
  asignacionMinima, emparejamientoMaximo, asignarGreedy, asignarOptimo, conciliar, PERFIL_POR_DEFECTO,
} from '../src/cruce/index.ts';

function generador(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function mov(lado: 'banco' | 'ventas', id: string, fecha: string, monto: number, referencia = ''): Movimiento {
  return { id, lado, fecha, montoCentavos: monto, referencia: normalizarReferencia(referencia), descripcion: '', plantilla: 'prueba', linea: 0 };
}
const b = (id: string, fecha: string, monto: number, ref = '') => mov('banco', id, fecha, monto, ref);
const v = (id: string, fecha: string, monto: number, ref = '') => mov('ventas', id, fecha, monto, ref);
const perfil = (cambios: Partial<Perfil> = {}): Perfil => ({ ...PERFIL_POR_DEFECTO, ...cambios });

// Mejor asignación por fuerza bruta: prueba cada columna (o ninguna) para cada fila.
function bruta(pesos: (number | null)[][], permitirVacio: boolean): number {
  const filas = pesos.length;
  const columnas = filas ? pesos[0].length : 0;
  const usada = new Array<boolean>(columnas).fill(false);
  let mejor = -Infinity;
  const recorrer = (f: number, total: number) => {
    if (f === filas) { mejor = Math.max(mejor, total); return; }
    if (permitirVacio) recorrer(f + 1, total);
    for (let c = 0; c < columnas; c++) {
      const w = pesos[f][c];
      if (usada[c] || w === null) continue;
      usada[c] = true;
      recorrer(f + 1, total + w);
      usada[c] = false;
    }
  };
  recorrer(0, 0);
  return mejor;
}

function invariantes(r: ResultadoConciliacion, banco: Movimiento[], ventas: Movimiento[]): void {
  const vistosB = new Set<string>();
  const vistosV = new Set<string>();
  for (const c of r.coincidencias) {
    for (const id of c.bancoIds) { assert.ok(!vistosB.has(id)); vistosB.add(id); }
    for (const id of c.ventasIds) { assert.ok(!vistosV.has(id)); vistosV.add(id); }
  }
  for (const c of r.clasificados ?? []) (c.lado === 'banco' ? vistosB : vistosV).add(c.id);
  for (const id of r.sinCruzarBanco) { assert.ok(!vistosB.has(id)); vistosB.add(id); }
  for (const id of r.sinCruzarVentas) { assert.ok(!vistosV.has(id)); vistosV.add(id); }
  assert.equal(vistosB.size, banco.length, 'coincidencias + clasificados + sin cruzar = todos los abonos');
  assert.equal(vistosV.size, ventas.length, 'coincidencias + clasificados + sin cruzar = todas las ventas');
  // Todo lo que no cruzó tiene su motivo.
  for (const id of [...r.sinCruzarBanco, ...r.sinCruzarVentas]) assert.ok(r.motivos?.[id], `sin motivo: ${id}`);
}

describe('algoritmo Húngaro', () => {
  test('asignacionMinima coincide con la fuerza bruta en matrices pequeñas', () => {
    const azar = generador(11);
    for (let caso = 0; caso < 300; caso++) {
      const filas = 1 + Math.floor(azar() * 6);
      const columnas = filas + Math.floor(azar() * 3);
      const costo = Array.from({ length: filas }, () => Array.from({ length: columnas }, () => Math.floor(azar() * 50) - 10));
      const asignada = asignacionMinima(costo);
      assert.equal(new Set(asignada).size, filas, 'cada fila con una columna distinta');
      const total = asignada.reduce((s, c, f) => s + costo[f][c], 0);
      const negado = costo.map((fila) => fila.map((x) => -x));
      assert.equal(total + bruta(negado, false), 0, `caso ${caso}`);
    }
  });

  test('emparejamientoMaximo con aristas faltantes y matrices rectangulares', () => {
    const azar = generador(22);
    for (let caso = 0; caso < 300; caso++) {
      const filas = 1 + Math.floor(azar() * 6);
      const columnas = 1 + Math.floor(azar() * 6);
      const pesos = Array.from({ length: filas }, () => Array.from({ length: columnas }, () => (azar() < 0.4 ? null : 1 + Math.floor(azar() * 100))));
      const pares = emparejamientoMaximo(pesos);
      assert.equal(new Set(pares.map((p) => p.fila)).size, pares.length);
      assert.equal(new Set(pares.map((p) => p.columna)).size, pares.length);
      for (const p of pares) assert.notEqual(pesos[p.fila][p.columna], null);
      const total = pares.reduce((s, p) => s + pesos[p.fila][p.columna]!, 0);
      assert.equal(total, Math.max(0, bruta(pesos, true)), `caso ${caso}`);
    }
    assert.deepEqual(emparejamientoMaximo([]), []);
  });

  test('donde el greedy pierde: una arista alta que bloquea dos buenas', () => {
    const aristas: AristaCruce[] = [
      { i: 0, j: 0, puntaje: 0.95, diferencia: 0 },
      { i: 0, j: 1, puntaje: 0.9, diferencia: -10 },
      { i: 1, j: 0, puntaje: 0.9, diferencia: -10 },
    ];
    const suma = (xs: AristaCruce[]) => xs.reduce((s, a) => s + a.puntaje, 0);
    assert.equal(asignarGreedy(aristas).length, 1);
    const optimo = asignarOptimo(aristas);
    assert.equal(optimo.length, 2);
    assert.ok(suma(optimo) > suma(asignarGreedy(aristas)));
  });

  test('a igual suma, desempata como el greedy (menor diferencia)', () => {
    const aristas: AristaCruce[] = [
      { i: 0, j: 0, puntaje: 0.8, diferencia: -500 },
      { i: 0, j: 1, puntaje: 0.8, diferencia: -100 },
    ];
    assert.deepEqual(asignarOptimo(aristas).map((a) => a.j), [1]);
    assert.deepEqual(asignarGreedy(aristas).map((a) => a.j), [1]);
  });

  test('propiedad: el óptimo nunca suma menos que el greedy (componentes pseudoaleatorias)', () => {
    const azar = generador(20261017);
    for (let caso = 0; caso < 500; caso++) {
      const nb = 1 + Math.floor(azar() * 8);
      const nv = 1 + Math.floor(azar() * 8);
      const aristas: AristaCruce[] = [];
      for (let i = 0; i < nb; i++) {
        for (let j = 0; j < nv; j++) {
          // Puntajes con 4 decimales y muchos empates, como en el pase 2.
          if (azar() < 0.5) aristas.push({ i, j, puntaje: Math.round((0.6 + azar() * 0.4) * 20) / 20, diferencia: -Math.floor(azar() * 1000) });
        }
      }
      const g = asignarGreedy(aristas);
      const o = asignarOptimo(aristas);
      const suma = (xs: AristaCruce[]) => Math.round(xs.reduce((s, a) => s + a.puntaje, 0) * 10_000);
      assert.ok(suma(o) >= suma(g), `caso ${caso}: óptimo ${suma(o)} < greedy ${suma(g)}`);
      assert.equal(new Set(o.map((a) => a.i)).size, o.length);
      assert.equal(new Set(o.map((a) => a.j)).size, o.length);
    }
  });

  test('propiedad en conciliar: el pase 2 óptimo suma al menos lo del greedy', () => {
    for (let semilla = 1; semilla <= 15; semilla++) {
      const azar = generador(semilla * 7919);
      const entero = (min: number, max: number) => min + Math.floor(azar() * (max - min + 1));
      const fecha = (d: number) => `2026-10-${String(d).padStart(2, '0')}`;
      const banco: Movimiento[] = [];
      const ventas: Movimiento[] = [];
      // Montos de pocos valores distintos para que muchos abonos compitan por las mismas ventas.
      for (let k = 0; k < 120; k++) {
        const monto = entero(10, 20) * 10_000_00;
        ventas.push(v(`V${k}`, fecha(entero(1, 10)), monto, azar() < 0.5 ? `PED-${entero(1, 40)}` : ''));
        if (azar() < 0.8) {
          banco.push(b(`B${k}`, fecha(entero(2, 12)), monto - Math.round(monto * entero(0, 45) / 1000), azar() < 0.5 ? `PED-${entero(1, 40)}` : ''));
        }
      }
      const p = perfil({ maxGrupo: 1 });
      const optimo = conciliar(banco, ventas, p);
      const greedy = conciliar(banco, ventas, { ...p, cruceOptimo: false });
      const suma = (r: ResultadoConciliacion) => Math.round(r.coincidencias.filter((c) => c.tipo === 'tolerancia').reduce((s, c) => s + c.puntaje, 0) * 10_000);
      assert.ok(suma(optimo) >= suma(greedy), `semilla ${semilla}: ${suma(optimo)} < ${suma(greedy)}`);
      invariantes(optimo, banco, ventas);
      invariantes(greedy, banco, ventas);
    }
  });
});

describe('clusters N:M', () => {
  // Una liquidación de 3 ventas (3 % de comisión) que el banco abona en dos depósitos.
  // Ningún abono solo cuadra con una venta ni con una suma de ventas: solo los dos juntos.
  const ventas = [v('V1', '2026-10-01', 310_000_00), v('V2', '2026-10-01', 205_000_00), v('V3', '2026-10-01', 137_000_00)];
  const banco = [b('B1', '2026-10-02', 352_440_00, 'LIQ-A'), b('B2', '2026-10-02', 280_000_00, 'LIQ-B')];

  test('dos abonos pagan juntos tres ventas: agrupadaNM sugerida', () => {
    const r = conciliar(banco, ventas, PERFIL_POR_DEFECTO);
    invariantes(r, banco, ventas);
    assert.equal(r.coincidencias.length, 1);
    const c = r.coincidencias[0];
    assert.equal(c.tipo, 'agrupadaNM');
    assert.deepEqual(c.bancoIds, ['B1', 'B2']);
    assert.deepEqual(c.ventasIds, ['V1', 'V2', 'V3']);
    assert.equal(c.diferenciaCentavos, 632_440_00 - 652_000_00);
    assert.equal(c.estado, 'sugerida');
    assert.ok(c.puntaje < PERFIL_POR_DEFECTO.umbralAutomatico);
    assert.match(c.explicacion, /2 abonos por \$632\.440 pagan juntos 3 ventas por \$652\.000/);
    assert.deepEqual(r.pases.map((p) => [p.nombre, p.coincidencias]), [['exacta', 0], ['tolerancia', 0], ['agrupada', 0], ['agrupadaNM', 1]]);
  });

  test('con cruceOptimo: false no hay pase N:M (como el MVP)', () => {
    const r = conciliar(banco, ventas, { ...PERFIL_POR_DEFECTO, cruceOptimo: false });
    assert.equal(r.coincidencias.length, 0);
    assert.equal(r.pases.length, 3);
    invariantes(r, banco, ventas);
  });

  test('el N:M respeta la ventana de fechas', () => {
    const lejos = [b('B1', '2026-10-02', 352_440_00), b('B2', '2026-10-20', 280_000_00)];
    const r = conciliar(lejos, ventas, PERFIL_POR_DEFECTO);
    assert.equal(r.coincidencias.length, 0);
  });

  test('maxGrupo 1 apaga también el N:M (como en el MVP: no agrupar)', () => {
    const partes = [b('B1', '2026-10-02', 50_000_00), b('B2', '2026-10-02', 48_000_00)];
    const una = [v('V1', '2026-10-01', 100_000_00)];
    const conGrupos = conciliar(partes, una, PERFIL_POR_DEFECTO);
    assert.deepEqual(conGrupos.coincidencias.map((c) => [c.tipo, c.bancoIds, c.ventasIds]), [['agrupadaNM', ['B1', 'B2'], ['V1']]]);
    const sinGrupos = conciliar(partes, una, perfil({ maxGrupo: 1 }));
    assert.equal(sinGrupos.coincidencias.length, 0);
    invariantes(sinGrupos, partes, una);
  });
});

describe('motivos: por qué no cruzó', () => {
  test('sin candidatos en la ventana de fechas', () => {
    const banco = [b('B1', '2026-10-20', 50_000_00)];
    const ventas = [v('V1', '2026-10-01', 50_000_00)];
    const r = conciliar(banco, ventas, PERFIL_POR_DEFECTO);
    invariantes(r, banco, ventas);
    assert.equal(r.motivos!.B1, 'Sin ventas en la ventana de fechas (2026-10-15 a 2026-10-21).');
    assert.equal(r.motivos!.V1, 'Sin abonos en la ventana de fechas (2026-09-30 a 2026-10-06).');
  });

  test('monto fuera de tolerancia por X', () => {
    // 10 % menos con tolerancia del 5 %: faltan $10.000 y se permiten $5.000.
    const banco = [b('B1', '2026-10-02', 90_000_00, 'PED-1')];
    const ventas = [v('V1', '2026-10-01', 100_000_00, 'OTRA-9')];
    const r = conciliar(banco, ventas, PERFIL_POR_DEFECTO);
    assert.match(r.motivos!.B1, /^Monto fuera de tolerancia por \$5\.000: la venta más cercana en monto en la ventana es V1 \(\$100\.000\)/);
    assert.match(r.motivos!.V1, /^Monto fuera de tolerancia por \$5\.000: el abono más cercano en monto en la ventana es B1/);
  });

  test('candidato tomado por otra coincidencia con mayor puntaje', () => {
    const ventas = [v('V1', '2026-10-01', 100_000_00, 'PED-1')];
    const banco = [b('B1', '2026-10-02', 97_000_00, 'PED-1'), b('B2', '2026-10-02', 97_500_00)];
    const r = conciliar(banco, ventas, PERFIL_POR_DEFECTO);
    invariantes(r, banco, ventas);
    assert.deepEqual(r.coincidencias.map((c) => c.bancoIds[0]), ['B1']);
    assert.match(r.motivos!.B2, /^Su candidato V1 quedó en c1 \(puntaje \d,\d\d\), con mayor puntaje que esta pareja \(\d,\d\d\)\.$/);
  });

  test('demasiados candidatos para agrupar', () => {
    const muchas = Array.from({ length: 41 }, (_, k) => v(`V${k}`, '2026-10-07', 10_000_00 + k * 100, `M${k}`));
    const banco = [b('B1', '2026-10-08', 25_000_00)];
    const r = conciliar(banco, muchas, PERFIL_POR_DEFECTO);
    invariantes(r, banco, muchas);
    assert.match(r.motivos!.B1, /^Demasiados candidatos para agrupar \(41 ventas libres/);
  });

  test('débitos y ventas negativas', () => {
    const banco = [b('B1', '2026-10-08', -4_000_00)];
    const ventas = [v('V1', '2026-10-08', -10_000_00)];
    const r = conciliar(banco, ventas, PERFIL_POR_DEFECTO);
    assert.match(r.motivos!.B1, /débito/);
    assert.match(r.motivos!.V1, /devolución/);
  });

  test('ids repetidos entre lados sin cruzar llevan prefijo', () => {
    const r = conciliar([b('X', '2026-10-20', 1_00)], [v('X', '2026-10-01', 2_00)], PERFIL_POR_DEFECTO);
    assert.deepEqual(Object.keys(r.motivos!).sort(), ['banco:X', 'ventas:X']);
  });
});
