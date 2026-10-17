import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Movimiento } from '../src/modelo.ts';
import { normalizarReferencia } from '../src/modelo.ts';
import type { Perfil, ResultadoConciliacion } from '../src/cruce/index.ts';
import { conciliar, PERFIL_POR_DEFECTO, validarPerfil, levenshtein, dentroDeTolerancia } from '../src/cruce/index.ts';

// Datos sintéticos: ningún monto, referencia ni persona es real.

function mov(lado: 'banco' | 'ventas', id: string, fecha: string, monto: number, referencia = '', descripcion = ''): Movimiento {
  return {
    id, lado, fecha, montoCentavos: monto, referencia: normalizarReferencia(referencia), descripcion,
    plantilla: 'prueba', linea: 0,
  };
}
const b = (id: string, fecha: string, monto: number, ref = '') => mov('banco', id, fecha, monto, ref);
const v = (id: string, fecha: string, monto: number, ref = '') => mov('ventas', id, fecha, monto, ref);

const perfil = (cambios: Partial<Perfil> = {}): Perfil => ({ ...PERFIL_POR_DEFECTO, ...cambios });

// Busca la coincidencia que contiene un abono.
function deAbono(r: ResultadoConciliacion, id: string) {
  return r.coincidencias.find((c) => c.bancoIds.includes(id));
}

// Generador congruencial lineal: "aleatorio" pero igual en cada corrida.
function generador(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// Revisa las invariantes que todo resultado debe cumplir.
function verificarInvariantes(r: ResultadoConciliacion, banco: Movimiento[], ventas: Movimiento[], p: Perfil): void {
  const usadosB = new Set<string>();
  const usadosV = new Set<string>();
  const porIdB = new Map(banco.map((m) => [m.id, m]));
  const porIdV = new Map(ventas.map((m) => [m.id, m]));
  r.coincidencias.forEach((c, n) => {
    assert.equal(c.id, `c${n + 1}`);
    for (const id of c.bancoIds) { assert.ok(!usadosB.has(id), `abono ${id} en dos coincidencias`); usadosB.add(id); }
    for (const id of c.ventasIds) { assert.ok(!usadosV.has(id), `venta ${id} en dos coincidencias`); usadosV.add(id); }
    const sb = c.bancoIds.reduce((s, id) => s + porIdB.get(id)!.montoCentavos, 0);
    const sv = c.ventasIds.reduce((s, id) => s + porIdV.get(id)!.montoCentavos, 0);
    assert.equal(c.diferenciaCentavos, sb - sv);
    assert.ok(dentroDeTolerancia(sb, sv, p), `${c.id} fuera de tolerancia`);
    assert.ok(c.ventasIds.length <= p.maxGrupo);
    assert.ok(c.puntaje >= 0 && c.puntaje <= 1);
    assert.equal(c.estado, c.puntaje >= p.umbralAutomatico ? 'automatica' : 'sugerida');
    assert.ok(c.explicacion.length > 0);
  });
  for (const id of r.sinCruzarBanco) { assert.ok(!usadosB.has(id)); usadosB.add(id); }
  for (const id of r.sinCruzarVentas) { assert.ok(!usadosV.has(id)); usadosV.add(id); }
  assert.equal(usadosB.size, banco.length, 'coincidencias + sin cruzar = todos los abonos');
  assert.equal(usadosV.size, ventas.length, 'coincidencias + sin cruzar = todas las ventas');
  assert.equal(r.resumen.automaticas + r.resumen.sugeridas, r.coincidencias.length);
  assert.equal(r.pases.slice(0, 3).reduce((s, x) => s + x.coincidencias, 0), r.coincidencias.length);
}

describe('validarPerfil', () => {
  test('el perfil por defecto es válido y se copia', () => {
    const r = validarPerfil(PERFIL_POR_DEFECTO);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.perfil, PERFIL_POR_DEFECTO);
      assert.notEqual(r.perfil.retenciones, PERFIL_POR_DEFECTO.retenciones);
    }
  });

  test('reporta todos los errores juntos', () => {
    const r = validarPerfil({ ...PERFIL_POR_DEFECTO, id: '', toleranciaFaltantePorcentaje: 1, ventanaDias: -1,
      maxGrupo: 0, umbralSugerencia: 0.95, retenciones: [{ nombre: 'X', tasa: 2 }] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.errores.length, 6);
    assert.equal(validarPerfil(null).ok, false);
    assert.equal(validarPerfil({ ...PERFIL_POR_DEFECTO, toleranciaSobranteCentavos: 1.5 }).ok, false);
  });

  test('conciliar rechaza un perfil inválido', () => {
    assert.throws(() => conciliar([], [], perfil({ maxGrupo: -1 })), /Perfil inválido/);
  });
});

describe('utilidades de puntaje', () => {
  test('levenshtein', () => {
    assert.equal(levenshtein('KITTEN', 'SITTING'), 3);
    assert.equal(levenshtein('', 'ABC'), 3);
    assert.equal(levenshtein('ABC', 'ABC'), 0);
  });
});

describe('pase 1: exacta', () => {
  test('por monto y referencia, y luego por monto y fecha', () => {
    const banco = [b('B1', '2026-10-05', 100_000_00, 'PED-1'), b('B2', '2026-10-06', 50_000_00, 'OTRA')];
    const ventas = [v('V1', '2026-10-01', 100_000_00, 'ped 1'), v('V2', '2026-10-06', 50_000_00, 'XYZ')];
    const r = conciliar(banco, ventas);
    assert.equal(r.coincidencias.length, 2);
    assert.deepEqual(r.coincidencias.map((c) => [c.tipo, c.bancoIds[0], c.ventasIds[0], c.diferenciaCentavos]),
      [['exacta', 'B1', 'V1', 0], ['exacta', 'B2', 'V2', 0]]);
    assert.match(r.coincidencias[0].explicacion, /Mismo monto \(\$100\.000\) y misma referencia PED1/);
    assert.match(r.coincidencias[1].explicacion, /misma fecha/);
    assert.deepEqual(r.pases.map((p) => p.coincidencias), [2, 0, 0]);
  });

  test('montos repetidos con la misma referencia no se usan dos veces', () => {
    const banco = [b('B1', '2026-10-05', 1000, 'R1'), b('B2', '2026-10-05', 1000, 'R1'), b('B3', '2026-10-05', 1000, 'R1')];
    const ventas = [v('V1', '2026-10-05', 1000, 'R1'), v('V2', '2026-10-05', 1000, 'R1')];
    const r = conciliar(banco, ventas);
    assert.deepEqual(r.coincidencias.map((c) => c.ventasIds[0]), ['V1', 'V2']);
    assert.deepEqual(r.sinCruzarBanco, ['B3']);
  });
});

describe('pase 2: tolerancia 1:1', () => {
  test('faltante dentro del % se acepta y fuera no', () => {
    // 4 % menos con tolerancia 5 %: cruza. 6 % menos: no.
    const ventas = [v('V1', '2026-10-01', 100_000_00, 'PED-77'), v('V2', '2026-10-01', 200_000_00, 'PED-88')];
    const banco = [b('B1', '2026-10-02', 96_000_00, 'PED-77'), b('B2', '2026-10-02', 188_000_00, 'PED-88')];
    const r = conciliar(banco, ventas, perfil());
    assert.equal(r.coincidencias.length, 1);
    assert.equal(r.coincidencias[0].tipo, 'tolerancia');
    assert.equal(r.coincidencias[0].diferenciaCentavos, -4_000_00);
    assert.match(r.coincidencias[0].explicacion, /Faltan \$4\.000 \(4 % de \$100\.000\)/);
    assert.deepEqual(r.sinCruzarBanco, ['B2']);
  });

  test('la tolerancia en centavos se usa cuando es mayor que el %', () => {
    const banco = [b('B1', '2026-10-02', 9_000_00, 'R9')];
    const ventas = [v('V1', '2026-10-02', 10_000_00, 'R9')];
    assert.equal(conciliar(banco, ventas, perfil({ toleranciaFaltantePorcentaje: 0.05 })).coincidencias.length, 0);
    assert.equal(conciliar(banco, ventas, perfil({ toleranciaFaltanteCentavos: 1_000_00 })).coincidencias.length, 1);
  });

  test('tolerancia asimétrica: un sobrepago no se acepta si toleranciaSobranteCentavos es 0', () => {
    const banco = [b('B1', '2026-10-02', 100_000_01, 'PED-5')];
    const ventas = [v('V1', '2026-10-02', 100_000_00, 'PED-5')];
    const sin = conciliar(banco, ventas, perfil({ toleranciaSobranteCentavos: 0 }));
    assert.equal(sin.coincidencias.length, 0);
    assert.deepEqual(sin.sinCruzarBanco, ['B1']);
    const con = conciliar(banco, ventas, perfil({ toleranciaSobranteCentavos: 100 }));
    assert.equal(con.coincidencias.length, 1);
    assert.equal(con.coincidencias[0].diferenciaCentavos, 1);
    assert.match(con.coincidencias[0].explicacion, /Sobran \$0,01/);
  });

  test('ventana de días antes y después del abono', () => {
    const banco = [b('B1', '2026-10-10', 97_000_00, 'PED-1')];
    const conVenta = (fecha: string) => [v('V1', fecha, 100_000_00, 'PED-1')];
    // 5 días antes, ventana 5: entra; ventana 4: no.
    assert.equal(conciliar(banco, conVenta('2026-10-05'), perfil({ ventanaDias: 5 })).coincidencias.length, 1);
    assert.equal(conciliar(banco, conVenta('2026-10-05'), perfil({ ventanaDias: 4 })).coincidencias.length, 0);
    // Venta 1 día después del abono: depende de diasDespues.
    assert.equal(conciliar(banco, conVenta('2026-10-11'), perfil({ diasDespues: 1 })).coincidencias.length, 1);
    assert.equal(conciliar(banco, conVenta('2026-10-11'), perfil({ diasDespues: 0 })).coincidencias.length, 0);
    const r = conciliar(banco, conVenta('2026-10-08'));
    assert.match(r.coincidencias[0].explicacion, /venta 2 días antes del abono/);
  });

  test('referencia truncada por el banco se encuentra por prefijo (Trie)', () => {
    const banco = [b('B1', '2026-10-14', 135_700_00, 'PED-2026-109')];
    const ventas = [v('V0', '2026-10-13', 135_700_00, 'PED-2026-555555'), v('V1', '2026-10-13', 135_700_00, 'PED-2026-109377')];
    const r = conciliar(banco, ventas);
    assert.equal(r.coincidencias[0].ventasIds[0], 'V1');
    assert.match(r.coincidencias[0].explicacion, /prefijo/);
  });

  test('conflicto donde el greedy ingenuo falla: se resuelve por componente', () => {
    // B1 (sin referencia) prefiere V1 pero también acepta V2. B2 solo acepta V1 (misma referencia).
    // Un greedy abono por abono en orden de archivo le daría V1 a B1 y dejaría a B2 sin pareja.
    const banco = [b('B1', '2026-10-02', 100_000_00), b('B2', '2026-10-02', 99_500_00, 'REF777')];
    const ventas = [v('V1', '2026-10-01', 100_000_00, 'REF777'), v('V2', '2026-10-01', 101_500_00, 'XYZ999')];
    const r = conciliar(banco, ventas);

    // El grafo tiene las 3 aristas candidatas y B2 tiene un solo vecino.
    assert.equal(r.grafo.aristas.length, 3);
    assert.deepEqual(r.grafo.aristas.filter((a) => a.banco === 'B2').map((a) => a.venta), ['V1']);
    const b1v1 = r.grafo.aristas.find((a) => a.banco === 'B1' && a.venta === 'V1')!;
    const b1v2 = r.grafo.aristas.find((a) => a.banco === 'B1' && a.venta === 'V2')!;
    assert.ok(b1v1.peso > b1v2.peso, 'el greedy ingenuo elegiría V1 para B1');

    assert.equal(deAbono(r, 'B1')!.ventasIds[0], 'V2');
    assert.equal(deAbono(r, 'B2')!.ventasIds[0], 'V1');
    assert.deepEqual(r.sinCruzarBanco, []);
    assert.deepEqual(r.sinCruzarVentas, []);
  });

  test('ids repetidos entre lados no confunden el grafo', () => {
    const banco = [b('X', '2026-10-02', 99_000_00, 'R1')];
    const ventas = [v('X', '2026-10-01', 100_000_00, 'R1')];
    const r = conciliar(banco, ventas);
    assert.equal(r.coincidencias.length, 1);
    assert.deepEqual(r.grafo.nodos, [{ id: 'X', lado: 'banco' }, { id: 'X', lado: 'ventas' }]);
  });

  test('ids repetidos dentro de un lado son un error', () => {
    assert.throws(() => conciliar([b('B', '2026-10-01', 1), b('B', '2026-10-01', 2)], []), /Id repetido/);
  });
});

describe('pase 3: agrupada N:1', () => {
  // Abono de un lote de 3 ventas con 3 % de comisión.
  const ventas = [v('V1', '2026-10-07', 41_200_00, 'A1'), v('V2', '2026-10-07', 18_750_00, 'A2'), v('V3', '2026-10-07', 96_000_00, 'A3'),
    v('V4', '2026-10-01', 500_000_00, 'A4')];
  const bruto = 155_950_00;
  const banco = [b('B1', '2026-10-08', bruto - Math.round(bruto * 0.03), 'LOTE')];

  test('encuentra el subconjunto que suma dentro de la tolerancia', () => {
    const r = conciliar(banco, ventas, perfil({ maxGrupo: 8 }));
    assert.equal(r.coincidencias.length, 1);
    const c = r.coincidencias[0];
    assert.equal(c.tipo, 'agrupada');
    assert.deepEqual(c.ventasIds, ['V1', 'V2', 'V3']);
    assert.equal(c.diferenciaCentavos, -Math.round(bruto * 0.03));
    assert.match(c.explicacion, /agrupa 3 ventas por \$155\.950/);
    assert.deepEqual(r.sinCruzarVentas, ['V4']);
    assert.deepEqual(r.pases.map((p) => p.coincidencias), [0, 0, 1]);
  });

  test('maxGrupo limita el tamaño del grupo', () => {
    const r = conciliar(banco, ventas, perfil({ maxGrupo: 2 }));
    assert.equal(r.coincidencias.length, 0);
    assert.deepEqual(r.sinCruzarBanco, ['B1']);
    assert.equal(conciliar(banco, ventas, perfil({ maxGrupo: 3 })).coincidencias.length, 1);
  });

  test('con más de 40 candidatos se deja a revisión manual y se informa', () => {
    const muchas = Array.from({ length: 41 }, (_, k) => v(`V${k}`, '2026-10-07', 10_000_00 + k * 100, `M${k}`));
    const r = conciliar([b('B1', '2026-10-08', 25_000_00)], muchas);
    assert.equal(r.coincidencias.length, 0);
    const omitidos = r.pases.find((p) => p.nombre.startsWith('agrupada omitida'));
    assert.equal(omitidos?.coincidencias, 1);
  });
});

// ---------- Réplica en código de packages/plantillas/ESCENARIO.md ----------

// Par 1: extracto-banco.csv (14 abonos tras omitir saldos, totales y el GMF).
const EXTRACTO: [number, string, number, string][] = [
  [3, '2026-10-01', 8_950_000, 'PED-2026-104823'],
  [4, '2026-10-02', 8_977_671, 'WOMPI20261002'],
  [5, '2026-10-02', 24_500_000, 'PED-2026-117350'],
  [6, '2026-10-05', 6_230_000, 'PED-2026-121904'],
  [7, '2026-10-05', 16_357_374, 'PED-2026-126415'],
  [8, '2026-10-06', 49_580_180, 'PED-2026-118842'],
  [9, '2026-10-07', 7_113_375, 'PED-2026-140277'],
  [10, '2026-10-08', 15_103_211, 'WOMPI20261008'],
  [12, '2026-10-09', 19_059_765, 'PED-2026-147390'],
  [13, '2026-10-09', 35_000_000, ''],
  [14, '2026-10-09', 41_000_000, 'PED-2026-133018'],
  [15, '2026-10-13', 30_216_108, 'PED-2026-152936'],
  [16, '2026-10-14', 13_570_000, 'PED-2026-109'],
  [17, '2026-10-14', 21_325_599, 'WOMPI20261014'],
];
// ventas-wompi.csv: las 21 aprobadas (las DECLINED, ERROR y VOIDED ya omitidas).
const WOMPI: [string, string, string, number][] = [
  ['99999-1790846062-10000', '2026-10-01', 'PED-2026-104823', 8_950_000],
  ['99999-1790852627-10037', '2026-10-01', 'PED-2026-160021', 3_490_000],
  ['99999-1790869959-10074', '2026-10-01', 'PED-2026-160487', 5_780_000],
  ['99999-1790932462-10111', '2026-10-02', 'PED-2026-112268', 38_900_000],
  ['99999-1790956359-10185', '2026-10-02', 'PED-2026-117350', 24_500_000],
  ['99999-1791018862-10222', '2026-10-03', 'PED-2026-126415', 16_890_000],
  ['99999-1791196865-10259', '2026-10-05', 'PED-2026-118842', 52_000_000],
  ['99999-1791206896-10296', '2026-10-05', 'PED-2026-121904', 6_230_000],
  ['99999-1791284627-10370', '2026-10-06', 'PED-2026-140277', 7_345_000],
  ['99999-1791371027-10407', '2026-10-07', 'PED-2026-171032', 4_120_000],
  ['99999-1791388359-10444', '2026-10-07', 'PED-2026-171568', 1_875_000],
  ['99999-1791394511-10481', '2026-10-07', 'PED-2026-171944', 9_600_000],
  ['99999-1791457427-10518', '2026-10-08', 'PED-2026-147390', 19_990_000],
  ['99999-1791537262-10555', '2026-10-09', 'PED-2026-133018', 41_000_000],
  ['99999-1791630227-10629', '2026-10-10', 'PED-2026-152936', 31_200_000],
  ['99999-1791796462-10666', '2026-10-12', 'PED-2026-183205', 2_730_000],
  ['99999-1791803027-10703', '2026-10-12', 'PED-2026-183617', 6_490_000],
  ['99999-1791889427-10740', '2026-10-13', 'PED-2026-109377', 13_570_000],
  ['99999-1791906759-10777', '2026-10-13', 'PED-2026-184090', 1_560_000],
  ['99999-1791912911-10814', '2026-10-13', 'PED-2026-184452', 11_240_000],
  ['99999-1792055662-10888', '2026-10-15', 'PED-2026-190553', 28_900_000],
];
// Tabla de coincidencias esperadas de ESCENARIO.md (línea del extracto -> referencias de venta).
const ESPERADO: [number, 'exacta' | 'tolerancia' | 'agrupada', string[], number][] = [
  [3, 'exacta', ['PED-2026-104823'], 0],
  [4, 'agrupada', ['PED-2026-160021', 'PED-2026-160487'], -292_329],
  [5, 'exacta', ['PED-2026-117350'], 0],
  [6, 'exacta', ['PED-2026-121904'], 0],
  [7, 'tolerancia', ['PED-2026-126415'], -532_626],
  [8, 'tolerancia', ['PED-2026-118842'], -2_419_820],
  [9, 'tolerancia', ['PED-2026-140277'], -231_625],
  [10, 'agrupada', ['PED-2026-171032', 'PED-2026-171568', 'PED-2026-171944'], -491_789],
  [12, 'tolerancia', ['PED-2026-147390'], -930_235],
  [14, 'exacta', ['PED-2026-133018'], 0],
  [15, 'tolerancia', ['PED-2026-152936'], -983_892],
  [16, 'tolerancia', ['PED-2026-109377'], 0],
  [17, 'agrupada', ['PED-2026-183205', 'PED-2026-183617', 'PED-2026-184090', 'PED-2026-184452'], -694_401],
];

const PERFIL_DEMO = perfil({ toleranciaFaltantePorcentaje: 0.05, toleranciaFaltanteCentavos: 0, toleranciaSobranteCentavos: 0,
  ventanaDias: 5, diasDespues: 1, maxGrupo: 8, retenciones: [{ nombre: 'ReteFuente', tasa: 0.015 }] });

function escenarioPar1() {
  const banco = EXTRACTO.map(([linea, fecha, monto, ref]) => ({ ...b(`banco-csv-generico:${linea}`, fecha, monto, ref), linea }));
  const ventas = WOMPI.map(([id, fecha, ref, monto]) => v(id, fecha, monto, ref));
  return { banco, ventas };
}

describe('escenario Tienda La Ceiba (ESCENARIO.md)', () => {
  test('par 1: cada abono cruza con las ventas esperadas', () => {
    const { banco, ventas } = escenarioPar1();
    const refDe = new Map(ventas.map((m) => [m.id, m.referencia]));
    const r = conciliar(banco, ventas, PERFIL_DEMO);
    verificarInvariantes(r, banco, ventas, PERFIL_DEMO);

    for (const [linea, tipo, refs, diferencia] of ESPERADO) {
      const c = deAbono(r, `banco-csv-generico:${linea}`);
      assert.ok(c, `B${linea} debería cruzar`);
      assert.equal(c.tipo, tipo, `tipo de B${linea}`);
      assert.deepEqual(c.ventasIds.map((id) => refDe.get(id)).sort(), refs.map(normalizarReferencia).sort(), `ventas de B${linea}`);
      assert.equal(c.diferenciaCentavos, diferencia, `diferencia de B${linea}`);
    }
    assert.equal(r.coincidencias.length, 13);
    assert.deepEqual(r.pases.map((p) => [p.nombre, p.coincidencias]), [['exacta', 4], ['tolerancia', 6], ['agrupada', 3]]);
    assert.deepEqual(r.sinCruzarBanco, ['banco-csv-generico:13']);
    assert.deepEqual(r.sinCruzarVentas.map((id) => refDe.get(id)), ['PED2026112268', 'PED2026190553']);
    assert.equal(r.resumen.movimientosBanco, 14);
    assert.equal(r.resumen.movimientosVentas, 21);
    assert.equal(r.resumen.totalBancoCentavos, 296_983_283);
    assert.equal(r.resumen.totalVentasCentavos, 336_360_000);
    assert.equal(r.resumen.totalConciliadoCentavos, 261_983_283);
    assert.equal(r.coincidencias.reduce((s, c) => s + c.diferenciaCentavos, 0), -6_576_717);
  });

  test('par 1: las explicaciones nombran la comisión y la ReteFuente', () => {
    const { banco, ventas } = escenarioPar1();
    const r = conciliar(banco, ventas, PERFIL_DEMO);
    const b8 = deAbono(r, 'banco-csv-generico:8')!;
    assert.match(b8.explicacion, /Faltan \$24\.198,20 \(4,65 % de \$520\.000\)/);
    assert.match(b8.explicacion, /comisión 3,15 % \+ ReteFuente 1,5 % \(\$7\.800\)/);
    assert.match(deAbono(r, 'banco-csv-generico:12')!.explicacion, /ReteFuente/);
    const b7 = deAbono(r, 'banco-csv-generico:7')!;
    assert.match(b7.explicacion, /Faltan \$5\.326,26 .*≈ comisión 3,15 %\./);
    assert.doesNotMatch(b7.explicacion, /ReteFuente/);
    assert.match(deAbono(r, 'banco-csv-generico:16')!.explicacion, /Monto exacto.*prefijo/);
  });

  test('par 1: con tolerancia del 4 % B8 y B12 ya no cruzan con su venta real', () => {
    const { banco, ventas } = escenarioPar1();
    const refDe = new Map(ventas.map((m) => [m.id, m.referencia]));
    const p4 = { ...PERFIL_DEMO, toleranciaFaltantePorcentaje: 0.04 };
    const r = conciliar(banco, ventas, p4);
    verificarInvariantes(r, banco, ventas, p4);
    // El faltante de 4,65 % no cabe en 4 %. Con cruceOptimo (por defecto) la referencia de B8 lo ata
    // a su venta y queda sin cruzar (ver reglas.test.ts); con cruceOptimo false el pase 3 puede hallar,
    // como en 0.1.0, una suma casual de otras ventas, pero nunca la venta real ni como automática.
    for (const [linea, ref] of [[8, 'PED2026118842'], [12, 'PED2026147390']] as const) {
      const c = deAbono(r, `banco-csv-generico:${linea}`);
      if (!c) continue;
      assert.ok(!c.ventasIds.some((id) => refDe.get(id) === ref), `B${linea} no debería cruzar con ${ref}`);
      assert.equal(c.estado, 'sugerida');
    }
    assert.ok(r.sinCruzarBanco.includes('banco-csv-generico:12'));
  });

  test('par 1: con 4 % y cruceOptimo false el pase 3 se comporta como en 0.1.0', () => {
    const { banco, ventas } = escenarioPar1();
    const refDe = new Map(ventas.map((m) => [m.id, m.referencia]));
    const p4 = { ...PERFIL_DEMO, toleranciaFaltantePorcentaje: 0.04, cruceOptimo: false };
    const r = conciliar(banco, ventas, p4);
    verificarInvariantes(r, banco, ventas, p4);
    // 0.1.0 agrupaba B8 con tres ventas que no son la suya (puntaje 0,6255), solo como sugerida.
    const b8 = deAbono(r, 'banco-csv-generico:8');
    assert.ok(b8, 'B8 agrupa como en 0.1.0');
    assert.equal(b8.tipo, 'agrupada');
    assert.equal(b8.ventasIds.length, 3);
    assert.equal(b8.estado, 'sugerida');
    assert.ok(Math.abs(b8.puntaje - 0.6255) < 0.0001, `puntaje ${b8.puntaje}`);
    assert.ok(!b8.ventasIds.some((id) => refDe.get(id) === 'PED2026118842'));
    // Con el valor por defecto, la referencia de B8 manda y queda sin cruzar.
    assert.ok(conciliar(banco, ventas, { ...p4, cruceOptimo: true }).sinCruzarBanco.includes('banco-csv-generico:8'));
  });

  test('par 1: el resultado no cambia en todo el rango de perfiles verificado', () => {
    const { banco, ventas } = escenarioPar1();
    const base = conciliar(banco, ventas, PERFIL_DEMO);
    const firma = (r: ResultadoConciliacion) => r.coincidencias.map((c) => `${c.bancoIds}|${[...c.ventasIds].sort()}`).sort();
    for (const pct of [0.05, 0.06, 0.07]) {
      for (const ventanaDias of [3, 6]) {
        for (const diasDespues of [0, 1]) {
          const r = conciliar(banco, ventas, { ...PERFIL_DEMO, toleranciaFaltantePorcentaje: pct, ventanaDias, diasDespues, maxGrupo: 4 });
          assert.deepEqual(firma(r), firma(base), `pct ${pct}, ventana ${ventanaDias}, después ${diasDespues}`);
        }
      }
    }
  });

  test('par 2: recaudo Asobancaria contra ventas del ERP, 5 exactas', () => {
    const banco = [['100245', 12_500_000], ['100251', 8_735_000], ['100263', 34_290_000], ['100270', 5_600_000], ['100288', 21_045_000]]
      .map(([ref, monto], k) => b(`asobancaria-2001:${k + 3}`, '2026-10-14', monto as number, ref as string));
    const ventas = [
      v('V-2101', '2026-10-09', 12_500_000, '100245'), v('V-2102', '2026-10-10', 8_735_000, '100251'),
      v('V-2103', '2026-10-12', 34_290_000, '100263'), v('V-2104', '2026-10-13', 5_600_000, '100270'),
      v('V-2105', '2026-10-13', 21_045_000, '100288'), v('V-2106', '2026-10-14', 9_980_000, '100294'),
    ];
    const r = conciliar(banco, ventas, PERFIL_DEMO);
    verificarInvariantes(r, banco, ventas, PERFIL_DEMO);
    assert.deepEqual(r.coincidencias.map((c) => [c.tipo, c.ventasIds[0]]),
      [['exacta', 'V-2101'], ['exacta', 'V-2102'], ['exacta', 'V-2103'], ['exacta', 'V-2104'], ['exacta', 'V-2105']]);
    assert.deepEqual(r.sinCruzarVentas, ['V-2106']);
    assert.deepEqual(r.sinCruzarBanco, []);
    assert.equal(r.resumen.totalBancoCentavos, 82_170_000);
    assert.equal(r.resumen.totalVentasCentavos, 92_150_000);
  });
});

describe('determinismo e invariantes', () => {
  test('mismo input, mismo output', () => {
    const { banco, ventas } = escenarioPar1();
    assert.deepEqual(conciliar(banco, ventas, PERFIL_DEMO), conciliar(banco, ventas, PERFIL_DEMO));
  });

  test('1000 movimientos pseudoaleatorios: invariantes y menos de 2 s', () => {
    const azar = generador(20261016);
    const entero = (min: number, max: number) => min + Math.floor(azar() * (max - min + 1));
    const fecha = (dia: number) => `2026-10-${String(dia).padStart(2, '0')}`;
    const ventas: Movimiento[] = [];
    const banco: Movimiento[] = [];
    let nv = 0;
    let nb = 0;
    while (ventas.length + banco.length < 1000) {
      const dia = entero(1, 28);
      const tipo = azar();
      if (tipo < 0.3) { // exacta
        const monto = entero(10_000, 2_000_000) * 100;
        ventas.push(v(`V${nv++}`, fecha(dia), monto, `PED-${nv}`));
        banco.push(b(`B${nb++}`, fecha(dia), monto, `PED-${nv}`));
      } else if (tipo < 0.55) { // con comisión, 1 a 3 días después
        const monto = entero(10_000, 2_000_000) * 100;
        ventas.push(v(`V${nv++}`, fecha(dia), monto, `PED-${nv}`));
        banco.push(b(`B${nb++}`, fecha(Math.min(31, dia + entero(0, 3))), monto - Math.round(monto * 0.0315), azar() < 0.5 ? `PED-${nv}` : ''));
      } else if (tipo < 0.7) { // lote de 2 a 4 ventas
        const n = entero(2, 4);
        let bruto = 0;
        for (let k = 0; k < n; k++) {
          const monto = entero(5_000, 300_000) * 100;
          bruto += monto;
          ventas.push(v(`V${nv++}`, fecha(dia), monto, `PED-${nv}`));
        }
        banco.push(b(`B${nb++}`, fecha(Math.min(31, dia + 1)), bruto - Math.round(bruto * 0.03), `LOTE-${nb}`));
      } else if (tipo < 0.85) { // venta sin abono
        ventas.push(v(`V${nv++}`, fecha(dia), entero(10_000, 2_000_000) * 100, `PED-${nv}`));
      } else { // abono desconocido
        banco.push(b(`B${nb++}`, fecha(dia), entero(10_000, 2_000_000) * 100));
      }
    }
    const inicio = performance.now();
    const r = conciliar(banco, ventas, PERFIL_DEMO);
    const ms = performance.now() - inicio;
    verificarInvariantes(r, banco, ventas, PERFIL_DEMO);
    assert.ok(ms < 2000, `tardó ${ms.toFixed(0)} ms`);
    assert.ok(r.coincidencias.length > 200, `solo ${r.coincidencias.length} coincidencias`);
    assert.deepEqual(conciliar(banco, ventas, PERFIL_DEMO), r);
  });
});

// Revisión de 0.2.0: con cruceOptimo false el cruce por referencia de pago (Bre-B) también se apaga,
// así un perfil del MVP da lo mismo que 0.1.0 aunque los movimientos traigan referenciaPago.
test('referenciaPago solo manda cuando cruceOptimo está activo', () => {
  const base = { descripcion: '', plantilla: 'p', linea: 1 };
  const banco: Movimiento[] = [
    { ...base, id: 'B1', lado: 'banco', fecha: '2026-10-05', montoCentavos: 5_000_000, referencia: 'TRF991', referenciaPago: 'PED1' },
    { ...base, id: 'B2', lado: 'banco', fecha: '2026-10-05', montoCentavos: 5_000_000, referencia: 'TRF992' },
  ];
  const ventas: Movimiento[] = [
    { ...base, id: 'V1', lado: 'ventas', fecha: '2026-10-03', montoCentavos: 5_000_000, referencia: 'PED1' },
    { ...base, id: 'V2', lado: 'ventas', fecha: '2026-10-05', montoCentavos: 5_000_000, referencia: 'PED2' },
  ];
  const parejas = (perfil: Perfil) => conciliar(banco, ventas, perfil).coincidencias
    .map((c) => `${c.bancoIds.join('+')}-${c.ventasIds.join('+')}:${c.tipo}`).sort();
  assert.deepEqual(parejas({ ...PERFIL_POR_DEFECTO }), ['B1-V1:exacta', 'B2-V2:exacta']);
  assert.deepEqual(parejas({ ...PERFIL_POR_DEFECTO, cruceOptimo: false }), ['B1-V2:exacta', 'B2-V1:tolerancia']);
});
