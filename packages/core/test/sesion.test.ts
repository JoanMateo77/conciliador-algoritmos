import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Movimiento } from '../src/modelo.ts';
import { conciliar, PERFIL_POR_DEFECTO, REGLA_GMF } from '../src/cruce/index.ts';
import { SesionRevision } from '../src/sesion.ts';

// Datos sintéticos.
function mov(lado: 'banco' | 'ventas', id: string, fecha: string, monto: number, referencia = ''): Movimiento {
  return { id, lado, fecha, montoCentavos: monto, referencia, descripcion: '', plantilla: 'prueba', linea: 0 };
}

// c1 exacta (automática), c2 tolerancia (sugerida); B3 y V3 sin cruzar.
function preparar() {
  const banco = [
    mov('banco', 'B1', '2026-10-01', 100_000_00, 'PED1'),
    mov('banco', 'B2', '2026-10-03', 48_500_00, 'PED2'),
    mov('banco', 'B3', '2026-10-04', 77_000_00),
  ];
  const ventas = [
    mov('ventas', 'V1', '2026-10-01', 100_000_00, 'PED1'),
    mov('ventas', 'V2', '2026-10-02', 50_000_00, 'PED2'),
    mov('ventas', 'V3', '2026-10-02', 80_000_00, 'OTRA'),
  ];
  const resultado = conciliar(banco, ventas, { ...PERFIL_POR_DEFECTO, toleranciaFaltantePorcentaje: 0.035, maxGrupo: 1 });
  return { banco, ventas, resultado, sesion: new SesionRevision(resultado) };
}

describe('SesionRevision', () => {
  test('estado inicial según el resultado', () => {
    const { sesion, resultado } = preparar();
    assert.deepEqual(resultado.coincidencias.map((c) => [c.id, c.estado]), [['c1', 'automatica'], ['c2', 'sugerida']]);
    assert.equal(sesion.estadoDe('c1'), 'automatica');
    assert.equal(sesion.estadoDe('c2'), 'sugerida');
    assert.deepEqual(sesion.sinCruzar(), { banco: ['B3'], ventas: ['V3'] });
    assert.equal(sesion.puedeDeshacer(), false);
    assert.equal(sesion.puedeRehacer(), false);
    assert.throws(() => sesion.estadoDe('c99'), /No existe/);
  });

  test('confirmar y rechazar; rechazar libera los movimientos', () => {
    const { sesion } = preparar();
    sesion.confirmar('c1');
    assert.equal(sesion.estadoDe('c1'), 'confirmada');
    sesion.rechazar('c2');
    assert.equal(sesion.estadoDe('c2'), 'rechazada');
    assert.deepEqual(sesion.sinCruzar(), { banco: ['B3', 'B2'], ventas: ['V3', 'V2'] });
    assert.deepEqual(sesion.coincidencias().map((c) => c.estadoRevision), ['confirmada', 'rechazada']);
    // Confirmar una rechazada no tiene sentido sin deshacer antes.
    assert.throws(() => sesion.confirmar('c2'), /rechazada/);
    // Repetir una acción no agrega eventos.
    sesion.confirmar('c1');
    sesion.rechazar('c2');
    assert.equal(sesion.bitacora().length, 2);
  });

  test('emparejar a mano usa movimientos libres y crea un id nuevo', () => {
    const { sesion, banco, ventas } = preparar();
    const c = sesion.emparejarManual(['B3'], ['V3'], banco, ventas);
    assert.equal(c.id, 'c3');
    assert.equal(c.tipo, 'manual');
    assert.equal(c.diferenciaCentavos, -3_000_00);
    assert.match(c.explicacion, /a mano.*\$77\.000.*\$80\.000.*-\$3\.000/);
    assert.equal(sesion.estadoDe('c3'), 'confirmada');
    assert.deepEqual(sesion.sinCruzar(), { banco: [], ventas: [] });
    // Un movimiento ya usado no puede ir en otra coincidencia.
    assert.throws(() => sesion.emparejarManual(['B1'], ['V3'], banco, ventas), /ya está en la coincidencia/);
    assert.throws(() => sesion.emparejarManual(['NO'], ['V3'], banco, ventas), /No existe/);
    assert.throws(() => sesion.emparejarManual([], ['V3'], banco, ventas), /al menos/);
  });

  test('rechazar y luego emparejar a mano con lo liberado', () => {
    const { sesion, banco, ventas } = preparar();
    sesion.rechazar('c2');
    sesion.emparejarManual(['B2', 'B3'], ['V2', 'V3'], banco, ventas);
    assert.deepEqual(sesion.sinCruzar(), { banco: [], ventas: [] });
  });

  test('deshacer y rehacer con dos pilas', () => {
    const { sesion, banco, ventas } = preparar();
    sesion.confirmar('c2');
    sesion.rechazar('c1');
    sesion.emparejarManual(['B1'], ['V3'], banco, ventas);

    assert.equal(sesion.deshacer(), true); // quita el manual
    assert.deepEqual(sesion.coincidencias().map((c) => c.id), ['c1', 'c2']);
    assert.deepEqual(sesion.sinCruzar(), { banco: ['B3', 'B1'], ventas: ['V3', 'V1'] });
    assert.equal(sesion.deshacer(), true); // quita el rechazo
    assert.equal(sesion.estadoDe('c1'), 'automatica');
    assert.deepEqual(sesion.sinCruzar(), { banco: ['B3'], ventas: ['V3'] });
    assert.equal(sesion.deshacer(), true); // quita la confirmación: vuelve a sugerida
    assert.equal(sesion.estadoDe('c2'), 'sugerida');
    assert.equal(sesion.deshacer(), false);
    assert.equal(sesion.puedeRehacer(), true);

    assert.equal(sesion.rehacer(), true);
    assert.equal(sesion.estadoDe('c2'), 'confirmada');
    assert.equal(sesion.rehacer(), true);
    assert.equal(sesion.estadoDe('c1'), 'rechazada');
    assert.equal(sesion.rehacer(), true);
    assert.equal(sesion.estadoDe('c3'), 'confirmada'); // el mismo id que antes
    assert.equal(sesion.rehacer(), false);
    assert.deepEqual(sesion.sinCruzar(), { banco: ['B3'], ventas: ['V1'] });
  });

  test('una acción nueva vacía la pila de rehacer', () => {
    const { sesion } = preparar();
    sesion.confirmar('c1');
    sesion.deshacer();
    assert.equal(sesion.puedeRehacer(), true);
    sesion.rechazar('c2');
    assert.equal(sesion.puedeRehacer(), false);
    assert.equal(sesion.rehacer(), false);
  });

  test('la bitácora solo crece: deshacer y rehacer se agregan', () => {
    const { sesion, banco, ventas } = preparar();
    sesion.confirmar('c1');
    sesion.emparejarManual(['B3'], ['V3'], banco, ventas);
    sesion.deshacer();
    sesion.rehacer();
    const bitacora = sesion.bitacora();
    assert.deepEqual(bitacora.map((e) => e.tipo), ['confirmar', 'manual', 'deshacer', 'rehacer']);
    assert.deepEqual(bitacora[0], { tipo: 'confirmar', coincidenciaId: 'c1' });
    const deshecho = bitacora[2];
    assert.ok(deshecho.tipo === 'deshacer' && deshecho.evento.tipo === 'manual' && deshecho.evento.coincidencia.id === 'c3');
    // Es una copia: modificarla no cambia la sesión.
    bitacora.length = 0;
    assert.equal(sesion.bitacora().length, 4);
  });

  test('no modifica el resultado original', () => {
    const { sesion, resultado } = preparar();
    const copia = structuredClone(resultado);
    sesion.rechazar('c1');
    sesion.coincidencias()[0].bancoIds.push('X');
    assert.deepEqual(resultado, copia);
  });
});

describe('SesionRevision: clasificados y motivos (fases 10 y 11)', () => {
  test('lista los clasificados y explica por qué algo está libre', () => {
    const { banco, ventas } = preparar();
    const gmf = mov('banco', 'G1', '2026-10-04', -400_00);
    gmf.descripcion = 'GMF 4X1000';
    const conGmf = [...banco, gmf];
    const resultado = conciliar(conGmf, ventas, {
      ...PERFIL_POR_DEFECTO, toleranciaFaltantePorcentaje: 0.035, maxGrupo: 1, reglas: [REGLA_GMF],
    });
    const sesion = new SesionRevision(resultado);
    assert.deepEqual(sesion.clasificados(), [{ id: 'G1', lado: 'banco', categoria: 'gasto:GMF', reglaId: 'gmf-4x1000' }]);
    assert.match(sesion.motivo('G1', 'banco')!, /Clasificado como gasto:GMF/);
    assert.equal(sesion.motivo('B3', 'banco'), resultado.motivos!.B3);
    assert.equal(sesion.motivo('B1', 'banco'), null, 'está en c1');
    sesion.rechazar('c1');
    assert.equal(sesion.motivo('B1', 'banco'), 'Quedó libre al rechazar c1.');
    assert.equal(sesion.motivo('V1', 'ventas'), 'Quedó libre al rechazar c1.');
    sesion.deshacer();
    assert.equal(sesion.motivo('B1', 'banco'), null);
    // Emparejar a mano un clasificado lo saca de la lista.
    sesion.emparejarManual(['G1'], ['V3'], conGmf, ventas);
    assert.deepEqual(sesion.clasificados(), []);
  });

  test('un resultado guardado antes de la fase 10 (sin clasificados ni motivos) sigue funcionando', () => {
    const { resultado } = preparar();
    const { clasificados: _c, motivos: _m, ...viejo } = resultado;
    const sesion = new SesionRevision(viejo);
    assert.deepEqual(sesion.clasificados(), []);
    assert.equal(sesion.motivo('B3', 'banco'), null);
    assert.deepEqual(sesion.sinCruzar(), { banco: ['B3'], ventas: ['V3'] });
  });
});
