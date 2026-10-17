// Fase 10: reglas AND/OR, tarifas con vigencia, GMF, Bre-B y compatibilidad con el MVP.
// Datos sintéticos: ningún monto, referencia ni persona es real.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Movimiento } from '../src/modelo.ts';
import { normalizarReferencia } from '../src/modelo.ts';
import type { Perfil, Regla, ResultadoConciliacion, Tarifa } from '../src/cruce/index.ts';
import {
  conciliar, validarPerfil, compilarReglas, calcularTarifas, PERFIL_POR_DEFECTO, REGLA_GMF, TARIFAS_EJEMPLO,
} from '../src/cruce/index.ts';
import { RegistroPlantillas, procesarArchivos } from '../src/index.ts';
import { PLANTILLAS, MUESTRAS } from '../../plantillas/index.ts';

function mov(lado: 'banco' | 'ventas', id: string, fecha: string, monto: number, referencia = '', descripcion = ''): Movimiento {
  return { id, lado, fecha, montoCentavos: monto, referencia: normalizarReferencia(referencia), descripcion, plantilla: 'prueba', linea: 0 };
}
const b = (id: string, fecha: string, monto: number, ref = '', desc = '') => mov('banco', id, fecha, monto, ref, desc);
const v = (id: string, fecha: string, monto: number, ref = '', desc = '') => mov('ventas', id, fecha, monto, ref, desc);
const perfil = (cambios: Partial<Perfil> = {}): Perfil => ({ ...PERFIL_POR_DEFECTO, ...cambios });

function invariantes(r: ResultadoConciliacion, banco: Movimiento[], ventas: Movimiento[]): void {
  const cuenta = (lado: 'banco' | 'ventas') => {
    const ids = [
      ...r.coincidencias.flatMap((c) => (lado === 'banco' ? c.bancoIds : c.ventasIds)),
      ...(r.clasificados ?? []).filter((c) => c.lado === lado).map((c) => c.id),
      ...(lado === 'banco' ? r.sinCruzarBanco : r.sinCruzarVentas),
    ];
    assert.equal(new Set(ids).size, ids.length, `${lado}: ningún movimiento en dos lugares`);
    assert.equal(ids.length, (lado === 'banco' ? banco : ventas).length, `${lado}: coincidencias + clasificados + sin cruzar = todos`);
  };
  cuenta('banco');
  cuenta('ventas');
}

const registro = new RegistroPlantillas();
for (const p of PLANTILLAS) registro.registrar(p);
function cargar(id: string): Movimiento[] {
  const muestra = MUESTRAS.find((m) => m.id === id)!;
  return procesarArchivos([{ nombre: id, texto: muestra.texto }], registro)[0].movimientos;
}

describe('perfil con reglas y tarifas', () => {
  test('acepta reglas y tarifas válidas y no agrega campos a un perfil del MVP', () => {
    const r = validarPerfil({ ...PERFIL_POR_DEFECTO, reglas: [REGLA_GMF], tarifas: TARIFAS_EJEMPLO, municipio: 'Cali', cruceOptimo: true });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.perfil.reglas, [REGLA_GMF]);
      assert.notEqual(r.perfil.reglas, PERFIL_POR_DEFECTO.reglas);
    }
    const mvp = validarPerfil(PERFIL_POR_DEFECTO);
    assert.ok(mvp.ok && !('reglas' in mvp.perfil) && !('tarifas' in mvp.perfil) && !('cruceOptimo' in mvp.perfil));
  });

  test('reporta errores de reglas y tarifas con su ruta', () => {
    const r = validarPerfil({
      ...PERFIL_POR_DEFECTO,
      reglas: [
        { id: 'a', nombre: 'Sin condiciones', prioridad: 1, lado: 'banco', si: {}, accion: { tipo: 'exigirReferencia' } },
        { id: 'b', nombre: 'Regex rota', prioridad: 1, lado: 'banco', si: { todas: [{ campo: 'descripcion', op: 'regex', valor: '(' }] }, accion: { tipo: 'clasificar', categoria: 'x' } },
        { id: 'b', nombre: 'Repetida', prioridad: 1, lado: 'otro', si: { alguna: [{ campo: 'monto', op: 'entre', min: 5, max: 1 }] }, accion: { tipo: 'tolerancia' } },
      ],
      tarifas: [{ nombre: 'X', tasa: 0.01, base: 'neto', desde: '2026-10-10', hasta: '2026-10-01' }],
      cruceOptimo: 'si',
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      const todo = r.errores.join('\n');
      for (const esperado of [/reglas\[0\]\.si: necesita al menos una condición/, /reglas\[1\]\.si\.todas\[0\]\.valor: expresión regular inválida/,
        /reglas\[2\]\.id: repetido/, /reglas\[2\]\.lado/, /reglas\[2\]\.si\.alguna\[0\]: min no puede ser mayor que max/,
        /reglas\[2\]\.accion: la tolerancia necesita/, /tarifas\[0\]\.base/, /tarifas\[0\]\.hasta: no puede ser anterior/, /cruceOptimo/]) {
        assert.match(todo, esperado);
      }
    }
  });
});

describe('reglas: condiciones, prioridad y acciones', () => {
  test('AND (todas) y OR (alguna), sin importar mayúsculas ni tildes', () => {
    const regla: Regla = {
      id: 'pse-grande', nombre: 'PSE grande', prioridad: 1, lado: 'banco',
      si: {
        todas: [{ campo: 'monto', op: 'entre', min: 1_000_000_00, max: 9_000_000_00 }],
        alguna: [{ campo: 'descripcion', op: 'contiene', valor: 'pse' }, { campo: 'referencia', op: 'empiezaPor', valor: 'ped-' }],
      },
      accion: { tipo: 'clasificar', categoria: 'revisar' },
    };
    const evaluar = compilarReglas([regla]);
    assert.ok(evaluar(b('1', '2026-10-01', 2_000_000_00, '', 'Abono PSÉ'), 'banco')?.clasificar);
    assert.ok(evaluar(b('2', '2026-10-01', 2_000_000_00, 'PED-9'), 'banco')?.clasificar);
    assert.equal(evaluar(b('3', '2026-10-01', 2_000_000_00, 'X', 'efectivo'), 'banco'), null, 'falla el OR');
    assert.equal(evaluar(b('4', '2026-10-01', 500_00, '', 'PSE'), 'banco'), null, 'falla el AND');
    assert.equal(evaluar(v('5', '2026-10-01', 2_000_000_00, '', 'PSE'), 'ventas'), null, 'otro lado');
  });

  test('regex, igual y rango de fechas', () => {
    const evaluar = compilarReglas([
      { id: 'r', nombre: 'Regex', prioridad: 1, lado: 'ventas', si: { todas: [{ campo: 'descripcion', op: 'regex', valor: '^devol' }] }, accion: { tipo: 'clasificar', categoria: 'devolucion' } },
      { id: 'f', nombre: 'Fechas', prioridad: 2, lado: 'ventas', si: { todas: [{ campo: 'fecha', op: 'entre', desde: '2026-10-01', hasta: '2026-10-05' }, { campo: 'plantilla', op: 'igual', valor: 'PRUEBA' }] }, accion: { tipo: 'clasificar', categoria: 'octubre' } },
    ]);
    assert.equal(evaluar(v('1', '2026-10-20', 1, '', 'Devolución cliente'), 'ventas')?.clasificar?.id, 'r');
    assert.equal(evaluar(v('2', '2026-10-03', 1), 'ventas')?.clasificar?.id, 'f');
    assert.equal(evaluar(v('3', '2026-10-06', 1), 'ventas'), null);
  });

  test('la prioridad decide entre reglas del mismo tipo (menor primero)', () => {
    const base: Omit<Regla, 'id' | 'prioridad' | 'accion'> = { nombre: 'x', lado: 'banco', si: { todas: [{ campo: 'descripcion', op: 'contiene', valor: 'ABONO' }] } };
    const evaluar = compilarReglas([
      { ...base, id: 'tarde', prioridad: 20, accion: { tipo: 'clasificar', categoria: 'b' } },
      { ...base, id: 'pronto', prioridad: 5, accion: { tipo: 'clasificar', categoria: 'a' } },
    ]);
    assert.equal(evaluar(b('1', '2026-10-01', 1, '', 'ABONO'), 'banco')?.clasificar?.id, 'pronto');
  });

  test('GMF 4x1000: la regla de ejemplo lo clasifica como gasto y sale del cruce', () => {
    const banco = [b('B1', '2026-10-02', 100_000_00, 'PED-1', 'ABONO PSE'), b('B2', '2026-10-02', -400_00, '', 'GMF 4X1000 DEBITO')];
    const ventas = [v('V1', '2026-10-02', 100_000_00, 'PED-1')];
    const sin = conciliar(banco, ventas, PERFIL_POR_DEFECTO);
    assert.deepEqual(sin.sinCruzarBanco, ['B2']);
    assert.match(sin.motivos!.B2, /débito.*regla de clasificación/);

    const con = conciliar(banco, ventas, perfil({ reglas: [REGLA_GMF] }));
    invariantes(con, banco, ventas);
    assert.deepEqual(con.clasificados, [{ id: 'B2', lado: 'banco', categoria: 'gasto:GMF', reglaId: 'gmf-4x1000' }]);
    assert.deepEqual(con.sinCruzarBanco, []);
    assert.equal(con.resumen.sinCruzarBanco, 0);
    assert.equal(con.resumen.totalConciliadoCentavos, 100_000_00);
    assert.deepEqual(con.motivos, {});
  });

  test('exigirReferencia: sin la misma referencia no cruza ni por monto y fecha', () => {
    const banco = [b('B1', '2026-10-02', 50_000_00, 'TRF-77', 'TRANSFERENCIA B2B')];
    const ventas = [v('V1', '2026-10-02', 50_000_00, 'FAC-12')];
    assert.equal(conciliar(banco, ventas, PERFIL_POR_DEFECTO).coincidencias[0].tipo, 'exacta');
    const regla: Regla = {
      id: 'b2b', nombre: 'Transferencias B2B con referencia', prioridad: 1, lado: 'banco',
      si: { todas: [{ campo: 'descripcion', op: 'contiene', valor: 'transferencia' }] }, accion: { tipo: 'exigirReferencia' },
    };
    const r = conciliar(banco, ventas, perfil({ reglas: [regla] }));
    invariantes(r, banco, ventas);
    assert.equal(r.coincidencias.length, 0);
    assert.match(r.motivos!.B1, /La regla "Transferencias B2B con referencia" exige la misma referencia/);
    // Con la misma referencia y comisión sí cruza (pase 2).
    const r2 = conciliar([b('B1', '2026-10-03', 48_500_00, 'FAC-12', 'TRANSFERENCIA B2B')], ventas, perfil({ reglas: [regla] }));
    assert.equal(r2.coincidencias[0]?.tipo, 'tolerancia');
  });

  test('tolerancia propia por regla: una pasarela con comisión más alta', () => {
    // 8 % menos: fuera del 5 % del perfil, dentro del 10 % de la regla.
    const banco = [b('B1', '2026-10-03', 92_000_00, 'PED-5', 'LIQUIDACION PASARELA CARA')];
    const ventas = [v('V1', '2026-10-02', 100_000_00, 'PED-5')];
    assert.equal(conciliar(banco, ventas, PERFIL_POR_DEFECTO).coincidencias.length, 0);
    const reglaBanco: Regla = {
      id: 'cara', nombre: 'Pasarela cara', prioridad: 1, lado: 'banco',
      si: { todas: [{ campo: 'descripcion', op: 'contiene', valor: 'pasarela cara' }] }, accion: { tipo: 'tolerancia', faltantePorcentaje: 0.1 },
    };
    const r = conciliar(banco, ventas, perfil({ reglas: [reglaBanco] }));
    assert.equal(r.coincidencias.length, 1);
    assert.equal(r.coincidencias[0].diferenciaCentavos, -8_000_00);
    // La regla también puede estar del lado de las ventas (el AVL amplía su rango).
    const reglaVentas: Regla = { ...reglaBanco, id: 'cara-v', lado: 'ventas', si: { todas: [{ campo: 'referencia', op: 'igual', valor: 'PED-5' }] } };
    assert.equal(conciliar([{ ...banco[0], descripcion: '' }], ventas, perfil({ reglas: [reglaVentas] })).coincidencias.length, 1);
  });
});

describe('tarifas con vigencia', () => {
  test('explican el faltante del escenario sin cambiar el cruce', () => {
    const banco = cargar('extracto-banco');
    const ventas = cargar('ventas-wompi');
    const sinTarifas = conciliar(banco, ventas, PERFIL_POR_DEFECTO);
    const tarifas = TARIFAS_EJEMPLO.filter((t) => t.nombre !== 'ReteIVA');
    const con = conciliar(banco, ventas, perfil({ tarifas }));
    assert.deepEqual(con.coincidencias.map((c) => [c.bancoIds, c.ventasIds, c.tipo]), sinTarifas.coincidencias.map((c) => [c.bancoIds, c.ventasIds, c.tipo]));
    const de = (linea: number) => con.coincidencias.find((c) => c.bancoIds.includes(`banco-csv-generico:${linea}`))!.explicacion;
    assert.match(de(8), /Faltan \$24\.198,20 \(4,65 % de \$520\.000\) ≈ Comision 2,65 % \(\$13\.780\) \+ IVA 19 % de la comisión \(\$2\.618,20\) \+ ReteFuente 1,5 % \(\$7\.800\), tarifas vigentes al 2026-10-06\./);
    assert.match(de(7), /≈ Comision 2,65 % \(\$4\.475,85\) \+ IVA 19 % de la comisión \(\$850,41\), tarifas vigentes al 2026-10-05\./);
    // ReteICA es de Cali: sin municipio en el perfil no aparece.
    assert.doesNotMatch(con.coincidencias.map((c) => c.explicacion).join(' '), /ReteICA/);
  });

  test('se usa la tarifa vigente a la fecha del abono', () => {
    const tarifas: Tarifa[] = [
      { nombre: 'Comision', tasa: 0.0265, base: 'bruto', desde: '2026-01-01', hasta: '2026-10-05' },
      { nombre: 'Comision', tasa: 0.0299, base: 'bruto', desde: '2026-10-06' },
    ];
    const ventas = [v('V1', '2026-10-04', 100_000_00, 'PED-1'), v('V2', '2026-10-06', 100_000_00, 'PED-2')];
    const banco = [b('B1', '2026-10-05', 97_350_00, 'PED-1'), b('B2', '2026-10-07', 97_010_00, 'PED-2')];
    const r = conciliar(banco, ventas, perfil({ tarifas }));
    assert.match(r.coincidencias[0].explicacion, /Comision 2,65 % \(\$2\.650\), tarifas vigentes al 2026-10-05/);
    assert.match(r.coincidencias[1].explicacion, /Comision 2,99 % \(\$2\.990\), tarifas vigentes al 2026-10-07/);
  });

  test('municipio y medio de pago', () => {
    const tarifas: Tarifa[] = [
      { nombre: 'Comision', tasa: 0.0265, base: 'bruto', desde: '2026-01-01' },
      { nombre: 'Comision', tasa: 0.015, base: 'bruto', desde: '2026-01-01', medioPago: 'NEQUI' },
      { nombre: 'ReteICA', tasa: 0.0033, base: 'bruto', desde: '2026-01-01', municipio: 'Cali' },
    ];
    const tarjeta = v('V1', '2026-10-01', 100_000_00, '', 'CARD cardona@ejemplo.test');
    const nequi = v('V2', '2026-10-01', 100_000_00, '', 'NEQUI cliente@ejemplo.test');
    assert.deepEqual(calcularTarifas(tarifas, [tarjeta], '2026-10-02').map((p) => [p.nombre, p.montoCentavos]), [['Comision', 2_650_00]]);
    assert.deepEqual(calcularTarifas(tarifas, [nequi], '2026-10-02', 'cali').map((p) => [p.nombre, p.montoCentavos]),
      [['Comision', 1_500_00], ['ReteICA', 330_00]]);
    assert.deepEqual(calcularTarifas(tarifas, [tarjeta, nequi], '2026-10-02', 'Bogotá').map((p) => [p.nombre, p.tasas, p.montoCentavos]),
      [['Comision', [0.0265, 0.015], 4_150_00]]);
    assert.deepEqual(calcularTarifas(tarifas, [tarjeta], '2025-12-31'), []);
  });

  test('ReteIVA se calcula sobre el IVA de la comisión', () => {
    const partes = calcularTarifas(TARIFAS_EJEMPLO, [v('V1', '2026-10-01', 100_000_00)], '2026-10-02');
    assert.deepEqual(partes.map((p) => [p.nombre, p.montoCentavos]), [['Comision', 2_650_00], ['IVA', 503_50], ['ReteFuente', 1_500_00], ['ReteIVA', 75_53]]);
  });
});

describe('Bre-B: referencia de pago como llave principal', () => {
  test('la referencia de pago del abono encuentra la venta aunque la fecha difiera', () => {
    const banco = [{ ...b('B1', '2026-10-03', 75_000_00, 'TRANSFERENCIA'), referenciaPago: 'BRB-2026-0001' }];
    const ventas = [v('V0', '2026-10-03', 75_000_00, 'OTRA'), v('V1', '2026-10-01', 75_000_00, 'BRB-2026-0001')];
    const r = conciliar(banco, ventas, PERFIL_POR_DEFECTO);
    invariantes(r, banco, ventas);
    // Sin Bre-B ganaría V0 por monto y fecha; con la referencia de pago gana V1.
    assert.deepEqual(r.coincidencias.map((c) => [c.tipo, c.ventasIds[0], c.puntaje]), [['exacta', 'V1', 1]]);
    assert.match(r.coincidencias[0].explicacion, /misma referencia de pago Bre-B BRB-2026-0001/);
  });

  test('la referencia de pago de la venta contra la referencia del abono', () => {
    const banco = [b('B1', '2026-10-03', 75_000_00, 'BRB20260002')];
    const ventas = [{ ...v('V1', '2026-10-01', 75_000_00, 'FAC-9'), referenciaPago: 'brb-2026-0002' }];
    const r = conciliar(banco, ventas, PERFIL_POR_DEFECTO);
    assert.equal(r.coincidencias[0]?.tipo, 'exacta');
    assert.equal(r.coincidencias[0]?.ventasIds[0], 'V1');
  });
});

describe('compatibilidad con el MVP', () => {
  test('perfil sin reglas ni tarifas: la demo da exactamente lo mismo que el MVP', () => {
    const esperado = JSON.parse(readFileSync(new URL('./fixtures/demo-mvp.json', import.meta.url), 'utf8'));
    const pares = { par1: ['extracto-banco', 'ventas-wompi'], par2: ['recaudo-asobancaria', 'ventas-erp'] } as const;
    for (const [nombre, [idBanco, idVentas]] of Object.entries(pares)) {
      const { clasificados, motivos, ...mvp } = conciliar(cargar(idBanco), cargar(idVentas), PERFIL_POR_DEFECTO);
      assert.deepEqual(JSON.parse(JSON.stringify(mvp)), esperado[nombre], nombre);
      assert.deepEqual(clasificados, []);
      assert.deepEqual(Object.keys(motivos!).sort(), [...mvp.sinCruzarBanco, ...mvp.sinCruzarVentas].sort());
    }
  });

  test('nota del 4 %: B8 ya no roba ventas del lote de B10', () => {
    const banco = cargar('extracto-banco');
    const ventas = cargar('ventas-wompi');
    const r = conciliar(banco, ventas, perfil({ toleranciaFaltantePorcentaje: 0.04 }));
    invariantes(r, banco, ventas);
    const refDe = new Map(ventas.map((m) => [m.id, m.referencia]));
    const b10 = r.coincidencias.find((c) => c.bancoIds.includes('banco-csv-generico:10'));
    assert.ok(b10, 'B10 debe cruzar con su lote');
    assert.deepEqual(b10.ventasIds.map((id) => refDe.get(id)).sort(), ['PED2026171032', 'PED2026171568', 'PED2026171944']);
    for (const linea of [8, 12]) {
      const id = `banco-csv-generico:${linea}`;
      assert.ok(r.sinCruzarBanco.includes(id), `B${linea} queda sin cruzar`);
      assert.match(r.motivos![id], /corresponde a la venta .* pero el monto queda fuera de tolerancia por \$/);
    }
    assert.match(r.motivos!['banco-csv-generico:8'], /fuera de tolerancia por \$3\.398,20/);
  });
});
