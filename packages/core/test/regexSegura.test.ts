// Regex de usuario contra ReDoS: revisión estática, presupuesto de tiempo y su uso en
// reglas del perfil y plantillas. Datos sintéticos.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Movimiento } from '../src/modelo.ts';
import type { Perfil, Regla } from '../src/cruce/index.ts';
import { conciliar, validarPerfil, validarReglas, PERFIL_POR_DEFECTO, REGLAS_MAXIMAS } from '../src/cruce/index.ts';
import {
  revisarRegex, crearProbador, regexSegura, ErrorRegexCostosa, LARGO_MAXIMO_PATRON,
} from '../src/regexSegura.ts';
import { validarPlantilla } from '../src/plantillas/index.ts';
import { PLANTILLAS } from '../../plantillas/index.ts';

const reglaRegex = (valor: string, id = 'r'): Regla => ({
  id, nombre: 'Regex', prioridad: 1, lado: 'banco',
  si: { todas: [{ campo: 'descripcion', op: 'regex', valor }] },
  accion: { tipo: 'clasificar', categoria: 'x' },
});

const mov = (id: string, lado: 'banco' | 'ventas', descripcion: string): Movimiento => ({
  id, lado, fecha: '2026-03-02', montoCentavos: 100_000, referencia: '', descripcion, plantilla: 'p', linea: 1,
});

describe('revisarRegex', () => {
  test('rechaza las formas que dan tiempo exponencial', () => {
    for (const p of ['^(a+)+$', '(a*)*', '(\\w+\\s?)*$', '(?:x+)+', '(a|a)+', '((a|b))+', '(.*a){3}', '(?<n>a+)+']) {
      assert.match(revisarRegex(p, 'i') ?? '', /anidados|alternancia/, p);
    }
  });

  test('rechaza referencias hacia atrás, patrones largos, muchos cuantificadores e inválidos', () => {
    assert.match(revisarRegex('(a)\\1') ?? '', /referencias/);
    assert.match(revisarRegex('x'.repeat(LARGO_MAXIMO_PATRON + 1)) ?? '', /supera/);
    assert.match(revisarRegex('a*a*a*!') ?? '', /demasiados/);
    assert.equal(revisarRegex('('), 'expresión regular inválida');
  });

  test('acepta los patrones normales y los de todas las plantillas incluidas', () => {
    for (const p of ['^devol', '.*GMF.*', '(ABONO|PAGO)?', '^(ABONO|PAGO)?\\s*(\\d+)$', 'REF[: ]*(\\S+)', '[(]+', 'x{1000}', '^(?!APPROVED$)']) {
      assert.equal(revisarRegex(p, 'i'), null, p);
    }
    for (const pl of PLANTILLAS) assert.equal(validarPlantilla(pl).ok, true, pl.id);
  });

  test('regexSegura lanza con el motivo', () => {
    assert.throws(() => regexSegura('^(a+)+$'), /anidados/);
    assert.ok(regexSegura('^ab', 'i').test('ABC'));
  });

  test('crearProbador: recorta el texto y corta cuando se agota el tiempo', () => {
    const probar = crearProbador(5);
    assert.equal(probar(/x$/, 'a'.repeat(300) + 'x'), null); // la x queda fuera del recorte
    const lento = /a*a*!/;
    assert.throws(() => { for (let n = 0; n < 1000; n++) probar(lento, 'a'.repeat(256)); }, ErrorRegexCostosa);
  });
});

describe('reglas y plantillas usan la revisión', () => {
  test('validarReglas: el regex del revisor, topes de reglas y de condiciones', () => {
    assert.match(validarReglas([reglaRegex('^(a+)+$')]).join(), /reglas\[0\]\.si\.todas\[0\]\.valor: cuantificadores anidados/);
    const muchas = Array.from({ length: REGLAS_MAXIMAS + 1 }, (_, n) => reglaRegex('^x', `r${n}`));
    assert.match(validarReglas(muchas).join(), /a lo sumo/);
    const conds = Array.from({ length: 21 }, () => ({ campo: 'descripcion' as const, op: 'contiene' as const, valor: 'x' }));
    assert.match(validarReglas([{ ...reglaRegex('x'), si: { alguna: conds } }]).join(), /a lo sumo 20 condiciones/);
    assert.equal(validarPerfil({ ...PERFIL_POR_DEFECTO, reglas: [reglaRegex('^(a+)+$')] }).ok, false);
  });

  test('conciliar con un perfil sin validar no ejecuta el regex peligroso: falla al instante', () => {
    const perfil: Perfil = { ...PERFIL_POR_DEFECTO, reglas: [reglaRegex('^(a+)+$')] };
    const banco = [mov('b1', 'banco', 'a'.repeat(40) + '!')];
    const t0 = performance.now();
    assert.throws(() => conciliar(banco, [], perfil), /anidados/);
    assert.ok(performance.now() - t0 < 500);
  });

  test('una regex aceptada sigue clasificando como antes', () => {
    const perfil: Perfil = { ...PERFIL_POR_DEFECTO, reglas: [reglaRegex('^comision\\s+\\w+')] };
    const r = conciliar([mov('b1', 'banco', 'COMISION MENSUAL'), mov('b2', 'banco', 'ABONO')], [], perfil);
    assert.deepEqual((r.clasificados ?? []).map((c) => c.id), ['b1']);
  });

  test('validarPlantilla rechaza regex peligrosas en omitirSi y en columnas', () => {
    const base = PLANTILLAS.find((p) => p.tipo === 'delimitado')!;
    const mala = { ...base, omitirSi: [{ campo: 'X', regex: '(a+)+' }], columnas: { ...base.columnas, referencia: { de: 'X', regex: '(\\d|\\d)*' } } };
    const v = validarPlantilla(mala);
    const errores = (v.ok ? [] : v.errores).join('\n');
    assert.match(errores, /omitirSi\[0\]\.regex: cuantificadores anidados/);
    assert.match(errores, /columnas\.referencia\.regex: una alternancia repetida/);
  });
});
