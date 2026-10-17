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

test('el secreto JWT es estable entre instancias aunque falte JWT_SECRETO', async () => {
  const { secretoJwt } = await import('../src/vercel.ts');
  assert.equal(secretoJwt({ JWT_SECRETO: 'propio' }), 'propio');
  const url = 'postgres://u:p@host/db';
  const a = secretoJwt({ DATABASE_URL: url });
  assert.ok(a && a.length >= 40);
  assert.equal(secretoJwt({ DATABASE_URL: url }), a);
  assert.notEqual(secretoJwt({ DATABASE_URL: `${url}2` }), a);
  assert.equal(secretoJwt({}), undefined);
});

test('solo la consulta de un trabajo mueve la cola', async () => {
  const { debeProcesarCola } = await import('../src/vercel.ts');
  assert.equal(debeProcesarCola('GET', '/trabajos/123e4567-e89b-12d3-a456-426614174000'), true);
  assert.equal(debeProcesarCola('POST', '/trabajos/abc'), false);
  assert.equal(debeProcesarCola('GET', '/trabajos'), false);
  assert.equal(debeProcesarCola('GET', '/conciliaciones'), false);
});
