// Piezas de seguridad sin base de datos: JWT, contraseñas, límite de velocidad y cursores.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { firmarJwt, verificarJwt } from '../src/jwt.ts';
import { hashContrasena, verificarContrasena } from '../src/contrasenas.ts';
import { LimitadorVelocidad, autenticar, exigirRol, CONTEXTO_DEMO } from '../src/auth.ts';
import { codificarCursor, leerPaginacion } from '../src/paginacion.ts';
import { ErrorHttp } from '../src/http.ts';
import type { IncomingMessage } from 'node:http';

const SECRETO = 'secreto-de-prueba-que-no-es-real-0123456789';
const DATOS = { sub: 'u1', emp: 'e1', rol: 'analista' };

describe('JWT HS256', () => {
  test('firma y verifica', () => {
    const token = firmarJwt(DATOS, SECRETO, 60);
    const r = verificarJwt(token, SECRETO);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.carga.sub, 'u1');
      assert.equal(r.carga.exp - r.carga.iat, 60);
    }
    const [encabezado] = token.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(encabezado, 'base64url').toString()), { alg: 'HS256', typ: 'JWT' });
  });

  test('vencido', () => {
    const hace2h = Date.now() - 2 * 3600_000;
    const token = firmarJwt(DATOS, SECRETO, 3600, hace2h);
    assert.deepEqual(verificarJwt(token, SECRETO), { ok: false, motivo: 'vencido' });
    // Justo en el segundo de expiración ya no vale.
    const t = firmarJwt(DATOS, SECRETO, 10, 1_000_000_000_000);
    assert.equal(verificarJwt(t, SECRETO, 1_000_000_009_999).ok, true);
    assert.equal(verificarJwt(t, SECRETO, 1_000_000_010_000).ok, false);
  });

  test('alterado: carga cambiada, firma cambiada u otro secreto', () => {
    const token = firmarJwt(DATOS, SECRETO, 60);
    const [e, c, f] = token.split('.');
    const cargaAdmin = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(c, 'base64url').toString()), rol: 'admin' })).toString('base64url');
    assert.deepEqual(verificarJwt(`${e}.${cargaAdmin}.${f}`, SECRETO), { ok: false, motivo: 'firma' });
    const otraFirma = (f[0] === 'A' ? 'B' : 'A') + f.slice(1);
    assert.deepEqual(verificarJwt(`${e}.${c}.${otraFirma}`, SECRETO), { ok: false, motivo: 'firma' });
    assert.deepEqual(verificarJwt(`${e}.${c}.${f.slice(0, -4)}`, SECRETO), { ok: false, motivo: 'firma' });
    assert.deepEqual(verificarJwt(token, 'otro-secreto'), { ok: false, motivo: 'firma' });
  });

  test('rechaza alg none y formatos raros', () => {
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const carga = Buffer.from(JSON.stringify({ ...DATOS, iat: 1, exp: 9_999_999_999 })).toString('base64url');
    assert.equal(verificarJwt(`${none}.${carga}.`, SECRETO).ok, false);
    // HS256 con la firma correcta pero alg distinto en el encabezado (p. ej. HS512) tampoco pasa.
    const hs512 = Buffer.from(JSON.stringify({ alg: 'HS512', typ: 'JWT' })).toString('base64url');
    const firma = createHmac('sha256', SECRETO).update(`${hs512}.${carga}`).digest('base64url');
    assert.deepEqual(verificarJwt(`${hs512}.${carga}.${firma}`, SECRETO), { ok: false, motivo: 'formato' });
    for (const malo of ['', 'a.b', 'a.b.c.d', '***.***.***', 'eyJ.eyJ.x']) assert.equal(verificarJwt(malo, SECRETO).ok, false, malo);
  });

  test('autenticar: sin cabecera es la demo; cabecera mala o token alterado es 401', async () => {
    const req = (authorization?: string) => ({ headers: authorization === undefined ? {} : { authorization } }) as IncomingMessage;
    assert.equal(await autenticar(req(), null, SECRETO), CONTEXTO_DEMO);
    for (const cabecera of ['Basic abc', 'Bearer', `Bearer ${firmarJwt(DATOS, 'otro', 60)}`, `Bearer ${firmarJwt(DATOS, SECRETO, 60, 0)}`]) {
      await assert.rejects(autenticar(req(cabecera), null, SECRETO), (e: ErrorHttp) => e.estado === 401, cabecera);
    }
    // Token válido pero sin base: no se puede comprobar el usuario.
    await assert.rejects(autenticar(req(`Bearer ${firmarJwt(DATOS, SECRETO, 60)}`), null, SECRETO), (e: ErrorHttp) => e.estado === 503);
  });

  test('exigirRol: jerarquía lector < analista < admin', () => {
    const ctx = (rol: 'admin' | 'analista' | 'lector') => ({ empresaId: 'e', usuarioId: 'u', rol, anonimo: false });
    assert.doesNotThrow(() => exigirRol(ctx('admin'), 'analista'));
    assert.throws(() => exigirRol(ctx('lector'), 'analista'), (e: ErrorHttp) => e.estado === 403);
    assert.throws(() => exigirRol(ctx('analista'), 'admin'), (e: ErrorHttp) => e.estado === 403);
    assert.throws(() => exigirRol(CONTEXTO_DEMO, 'lector', true), (e: ErrorHttp) => e.estado === 401);
    assert.doesNotThrow(() => exigirRol(CONTEXTO_DEMO, 'analista'));
  });
});

describe('contraseñas con scrypt', () => {
  test('verifica la correcta y rechaza la incorrecta; la sal cambia el hash', async () => {
    const a = await hashContrasena('clave-sintetica-1');
    const b = await hashContrasena('clave-sintetica-1');
    assert.match(a, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    assert.notEqual(a, b);
    assert.equal(await verificarContrasena('clave-sintetica-1', a), true);
    assert.equal(await verificarContrasena('clave-sintetica-2', a), false);
    assert.equal(await verificarContrasena('x', 'bcrypt$no$aplica'), false);
  });
});

describe('límite de velocidad', () => {
  test('ventana fija por clave', () => {
    const l = new LimitadorVelocidad(3, 60_000);
    const t = 1_000_000;
    assert.deepEqual([1, 2, 3].map(() => l.consumir('ip1', t)), [null, null, null]);
    assert.equal(l.consumir('ip1', t + 1_000), 59);
    assert.equal(l.consumir('ip2', t + 1_000), null); // otra IP no se ve afectada
    assert.equal(l.consumir('ip1', t + 60_000), null); // nueva ventana
  });
});

describe('cursores de paginación', () => {
  test('ida y vuelta y errores en español', () => {
    const url = new URL(`http://x/?limite=5&cursor=${codificarCursor(['2026-10-01 10:00:00.123456+00', 'abc'])}`);
    assert.deepEqual(leerPaginacion(url, 2), { limite: 5, cursor: ['2026-10-01 10:00:00.123456+00', 'abc'] });
    assert.deepEqual(leerPaginacion(new URL('http://x/'), 2), { limite: 50, cursor: null });
    assert.throws(() => leerPaginacion(new URL('http://x/?cursor=basura'), 2), /cursor/);
    assert.throws(() => leerPaginacion(new URL(`http://x/?cursor=${codificarCursor(['solo-uno'])}`), 2), /cursor/);
    assert.throws(() => leerPaginacion(new URL('http://x/?limite=0'), 2), /limite/);
    assert.throws(() => leerPaginacion(new URL('http://x/?limite=201'), 2), /limite/);
  });
});
