// La función de Vercel recibe /api/... o la ruta reescrita /api?ruta=...; ambas deben llegar igual al enrutador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rutaInterna } from '../src/vercel.ts';

test('quita el prefijo /api de la ruta original', () => {
  assert.equal(rutaInterna('/api/salud'), '/salud');
  assert.equal(rutaInterna('/api/conciliaciones/abc/coincidencias/c1/confirmar'), '/conciliaciones/abc/coincidencias/c1/confirmar');
  assert.equal(rutaInterna('/api'), '/');
});

test('usa el parámetro ruta de la reescritura y conserva los demás', () => {
  assert.equal(rutaInterna('/api?ruta=salud'), '/salud');
  assert.equal(rutaInterna('/api?ruta=conciliaciones&limite=5'), '/conciliaciones?limite=5');
  assert.equal(rutaInterna('/api?ruta='), '/');
});

test('no confunde rutas que solo empiezan parecido', () => {
  assert.equal(rutaInterna('/apiario'), '/apiario');
});
