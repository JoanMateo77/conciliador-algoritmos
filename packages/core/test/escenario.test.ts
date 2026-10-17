// Prueba de aceptación de punta a punta: las muestras de @conciliador/plantillas,
// detectadas, leídas y conciliadas con PERFIL_POR_DEFECTO, deben dar exactamente
// lo que dice packages/plantillas/ESCENARIO.md.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RegistroPlantillas, procesarArchivos, conciliar, PERFIL_POR_DEFECTO } from '../src/index.ts';
import type { Movimiento, ResultadoConciliacion } from '../src/index.ts';
import { PLANTILLAS, MUESTRAS } from '../../plantillas/index.ts';

const registro = new RegistroPlantillas();
for (const p of PLANTILLAS) registro.registrar(p);

// Se pasa por procesarArchivos (sin plantillaId) para probar también la detección.
function cargar(idMuestra: string): Movimiento[] {
  const muestra = MUESTRAS.find((m) => m.id === idMuestra);
  assert.ok(muestra, `falta la muestra ${idMuestra}`);
  const [r] = procesarArchivos([{ nombre: idMuestra, texto: muestra.texto }], registro);
  assert.equal(r.plantillaId, muestra.plantillaId, `detección de ${idMuestra}`);
  assert.deepEqual(r.errores, []);
  return r.movimientos;
}

// Resume cada coincidencia como "líneas banco -> referencias ventas | tipo | diferencia",
// que es como el escenario nombra los movimientos.
function resumir(res: ResultadoConciliacion, banco: Movimiento[], ventas: Movimiento[]) {
  const porId = new Map([...banco, ...ventas].map((m) => [m.id, m]));
  const lineas = (ids: string[]) => ids.map((i) => porId.get(i)!.linea).sort((a, b) => a - b).join('+');
  const refs = (ids: string[]) => ids.map((i) => porId.get(i)!.referencia).sort().join('+');
  return {
    coincidencias: res.coincidencias
      .map((c) => `B${lineas(c.bancoIds)} -> ${refs(c.ventasIds)} | ${c.tipo} | ${c.diferenciaCentavos}`)
      .sort(),
    sinCruzarBanco: res.sinCruzarBanco.map((i) => porId.get(i)!.linea).sort((a, b) => a - b),
    sinCruzarVentas: res.sinCruzarVentas.map((i) => porId.get(i)!.referencia).sort(),
  };
}

describe('escenario Tienda La Ceiba, par 1: extracto-banco contra ventas-wompi', () => {
  const banco = cargar('extracto-banco');
  const ventas = cargar('ventas-wompi');
  const res = conciliar(banco, ventas, PERFIL_POR_DEFECTO);
  const r = resumir(res, banco, ventas);

  test('lectura: 14 abonos y 21 ventas aprobadas', () => {
    assert.equal(banco.length, 14);
    assert.equal(ventas.length, 21);
    assert.ok(banco.every((m) => m.id.startsWith('banco-csv-generico:')));
    // La rechazada con el mismo monto que una aprobada no debe entrar (omitirSi).
    assert.ok(!ventas.some((m) => m.referencia === 'PED2026115090'));
  });

  test('las 13 coincidencias esperadas', () => {
    assert.deepEqual(r.coincidencias, [
      'B10 -> PED2026171032+PED2026171568+PED2026171944 | agrupada | -491789',
      'B12 -> PED2026147390 | tolerancia | -930235',
      'B14 -> PED2026133018 | exacta | 0',
      'B15 -> PED2026152936 | tolerancia | -983892',
      'B16 -> PED2026109377 | tolerancia | 0',
      'B17 -> PED2026183205+PED2026183617+PED2026184090+PED2026184452 | agrupada | -694401',
      'B3 -> PED2026104823 | exacta | 0',
      'B4 -> PED2026160021+PED2026160487 | agrupada | -292329',
      'B5 -> PED2026117350 | exacta | 0',
      'B6 -> PED2026121904 | exacta | 0',
      'B7 -> PED2026126415 | tolerancia | -532626',
      'B8 -> PED2026118842 | tolerancia | -2419820',
      'B9 -> PED2026140277 | tolerancia | -231625',
    ]);
  });

  test('sin cruzar: la consignación B13 y dos ventas sin abono', () => {
    assert.deepEqual(r.sinCruzarBanco, [13]);
    assert.deepEqual(r.sinCruzarVentas, ['PED2026112268', 'PED2026190553']);
  });

  test('resumen, pases y diferencia total', () => {
    assert.equal(res.resumen.movimientosBanco, 14);
    assert.equal(res.resumen.movimientosVentas, 21);
    assert.equal(res.resumen.automaticas + res.resumen.sugeridas, 13);
    assert.equal(res.resumen.totalBancoCentavos, 296_983_283);
    assert.equal(res.resumen.totalVentasCentavos, 336_360_000);
    assert.deepEqual(res.pases.map((p) => [p.nombre, p.coincidencias]), [
      ['exacta', 4], ['tolerancia', 6], ['agrupada', 3],
    ]);
    const dif = res.coincidencias.reduce((s, c) => s + c.diferenciaCentavos, 0);
    assert.equal(dif, -6_576_717);
  });

  test('los faltantes con ReteFuente lo dicen en la explicación', () => {
    const conRete = res.coincidencias.filter((c) => c.diferenciaCentavos === -2_419_820 || c.diferenciaCentavos === -930_235);
    assert.equal(conRete.length, 2);
    for (const c of conRete) assert.match(c.explicacion, /ReteFuente/);
  });
});

describe('escenario Tienda La Ceiba, par 2: recaudo-asobancaria contra ventas-erp', () => {
  const banco = cargar('recaudo-asobancaria');
  const ventas = cargar('ventas-erp');
  const res = conciliar(banco, ventas, PERFIL_POR_DEFECTO);
  const r = resumir(res, banco, ventas);

  test('cinco exactas por referencia y V-2106 sin pagar', () => {
    assert.deepEqual(r.coincidencias, [
      'B3 -> 100245 | exacta | 0',
      'B4 -> 100251 | exacta | 0',
      'B5 -> 100263 | exacta | 0',
      'B6 -> 100270 | exacta | 0',
      'B7 -> 100288 | exacta | 0',
    ]);
    assert.deepEqual(r.sinCruzarBanco, []);
    assert.deepEqual(r.sinCruzarVentas, ['100294']);
    assert.ok(banco.every((m) => m.fecha === '2026-10-14'));
    assert.equal(res.resumen.totalBancoCentavos, 82_170_000);
    assert.equal(res.resumen.totalVentasCentavos, 92_150_000);
  });
});

describe('escenario: liquidacion-mercadopago suelta', () => {
  test('6 ventas con desglose que cuadra con el neto', () => {
    const ventas = cargar('liquidacion-mercadopago');
    assert.equal(ventas.length, 6);
    const [primera] = ventas;
    assert.equal(primera.montoCentavos, 15_000_000);
    assert.equal(primera.desglose?.comisionCentavos, 682_465);
    assert.equal(primera.desglose?.retencionesCentavos, 225_000);
    assert.equal(15_000_000 - 682_465 - 225_000, 14_092_535);
  });
});
