// Pruebas de la API: levantan el servidor real en un puerto libre.
// Las de base de datos necesitan DATABASE_URL_PRUEBA (una base desechable) y si no está se saltan.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { MUESTRAS } from '@conciliador/plantillas';
import { crearServidor } from '../src/servidor.ts';
import { aplicarEsquema, crearPool, enTransaccion } from '../src/bd.ts';
import { guardarConciliacion } from '../src/repositorio.ts';

const URL_PRUEBA = process.env.DATABASE_URL_PRUEBA;

const muestra = (id: string) => {
  const m = MUESTRAS.find((x) => x.id === id);
  if (!m) throw new Error(`Falta la muestra ${id}`);
  return m;
};
const banco = muestra('extracto-banco');
const ventas = muestra('ventas-wompi');

// Perfil de la demo (ESCENARIO.md): 5 % de faltante cubre comisión + IVA + ReteFuente.
const PERFIL_DEMO = {
  id: 'demo', nombre: 'Demo Tienda La Ceiba',
  toleranciaFaltanteCentavos: 0, toleranciaFaltantePorcentaje: 0.05, toleranciaSobranteCentavos: 0,
  ventanaDias: 4, diasDespues: 1, maxGrupo: 8, umbralAutomatico: 0.9, umbralSugerencia: 0.6,
  retenciones: [{ nombre: 'ReteFuente', tasa: 0.015 }],
};

const cuerpoValido = () => ({
  banco: { nombre: 'extracto-banco.csv', texto: banco.texto },
  ventas: { nombre: 'ventas-wompi.csv', texto: ventas.texto },
  perfil: PERFIL_DEMO,
});

async function levantar(opciones: Parameters<typeof crearServidor>[0]) {
  const servidor = crearServidor(opciones);
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  const { port } = servidor.address() as AddressInfo;
  return { servidor, base: `http://127.0.0.1:${port}` };
}
const cerrar = (s: Server) => new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()); });

const postJson = (url: string, cuerpo: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });

describe('API en modo memoria (sin base de datos)', () => {
  let servidor: Server;
  let base: string;
  before(async () => { ({ servidor, base } = await levantar({ pool: null })); });
  after(() => cerrar(servidor));

  test('/salud responde sin base de datos', async () => {
    const r = await fetch(`${base}/salud`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, baseDeDatos: false });
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
  });

  test('/plantillas lista las plantillas incluidas', async () => {
    const lista = await (await fetch(`${base}/plantillas`)).json() as { id: string }[];
    const ids = lista.map((p) => p.id);
    for (const id of ['banco-csv-generico', 'wompi-transacciones', 'asobancaria-2001']) assert.ok(ids.includes(id), id);
  });

  test('POST /conciliaciones devuelve el resultado sin guardar', async () => {
    const r = await postJson(`${base}/conciliaciones`, cuerpoValido());
    assert.equal(r.status, 200);
    const cuerpo = await r.json();
    assert.equal(cuerpo.id, null);
    assert.equal(cuerpo.guardada, false);
    assert.equal(cuerpo.resultado.resumen.movimientosBanco, 14);
    assert.equal(cuerpo.resultado.resumen.movimientosVentas, 21);
    assert.ok(cuerpo.resultado.coincidencias.length > 0);
    assert.deepEqual(cuerpo.ingesta.map((i: { plantillaId: string }) => i.plantillaId), ['banco-csv-generico', 'wompi-transacciones']);
  });

  test('las rutas que necesitan base responden 503', async () => {
    const id = randomUUID();
    for (const [metodo, ruta] of [['GET', '/conciliaciones'], ['GET', `/conciliaciones/${id}`],
      ['POST', `/conciliaciones/${id}/coincidencias/c1/confirmar`], ['POST', `/conciliaciones/${id}/coincidencias/c1/rechazar`]]) {
      const r = await fetch(`${base}${ruta}`, { method: metodo });
      assert.equal(r.status, 503, `${metodo} ${ruta}`);
      const cuerpo = await r.json();
      assert.match(cuerpo.error.mensaje, /base de datos/);
    }
  });

  test('valida la entrada con errores en español', async () => {
    let r = await postJson(`${base}/conciliaciones`, { banco: { nombre: '', texto: 5 } });
    assert.equal(r.status, 400);
    let cuerpo = await r.json();
    assert.equal(cuerpo.error.codigo, 400);
    assert.ok(cuerpo.error.detalles.some((d: string) => d.includes('ventas')));
    assert.ok(cuerpo.error.detalles.some((d: string) => d.includes('banco.texto')));

    r = await postJson(`${base}/conciliaciones`, { ...cuerpoValido(), perfil: { id: 'x' } });
    assert.equal(r.status, 400);
    assert.ok((await r.json()).error.detalles.every((d: string) => d.startsWith('perfil:')));

    // Plantilla de ventas usada en el lado banco.
    r = await postJson(`${base}/conciliaciones`, { ...cuerpoValido(), banco: { nombre: 'b.csv', texto: banco.texto, plantillaId: 'wompi-transacciones' } });
    assert.equal(r.status, 400);

    r = await fetch(`${base}/conciliaciones`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{malo' });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error.mensaje, /JSON/);

    r = await fetch(`${base}/conciliaciones`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hola' });
    assert.equal(r.status, 415);
  });

  test('archivo irreconocible o del lado equivocado da 422', async () => {
    let r = await postJson(`${base}/conciliaciones`, { ...cuerpoValido(), banco: { nombre: 'x.txt', texto: 'nada que ver\n1 2 3' } });
    assert.equal(r.status, 422);
    const cuerpo = await r.json();
    assert.equal(cuerpo.error.detalles[0].archivo, 'banco');

    // Los archivos intercambiados: el de ventas llega como banco.
    r = await postJson(`${base}/conciliaciones`, { banco: cuerpoValido().ventas, ventas: cuerpoValido().banco });
    assert.equal(r.status, 422);
  });

  test('rechaza cuerpos de más de 2 MB con 413', async () => {
    const enorme = 'x'.repeat(2 * 1024 * 1024 + 10);
    const r = await fetch(`${base}/conciliaciones`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: enorme });
    assert.equal(r.status, 413);
    assert.match((await r.json()).error.mensaje, /2 MB/);
  });

  test('404, 405 y preflight CORS', async () => {
    let r = await fetch(`${base}/no-existe`);
    assert.equal(r.status, 404);
    r = await fetch(`${base}/plantillas`, { method: 'POST' });
    assert.equal(r.status, 405);
    assert.match(r.headers.get('allow') ?? '', /GET/);
    r = await fetch(`${base}/conciliaciones/no-es-uuid`);
    assert.equal(r.status, 404);
    r = await fetch(`${base}/conciliaciones`, { method: 'OPTIONS', headers: { Origin: 'http://panel.ejemplo.test' } });
    assert.equal(r.status, 204);
    assert.match(r.headers.get('access-control-allow-methods') ?? '', /POST/);
  });

  test('CORS_ORIGEN restringido solo refleja orígenes permitidos', async () => {
    const otro = await levantar({ pool: null, corsOrigen: 'http://panel.ejemplo.test' });
    try {
      let r = await fetch(`${otro.base}/salud`, { headers: { Origin: 'http://panel.ejemplo.test' } });
      assert.equal(r.headers.get('access-control-allow-origin'), 'http://panel.ejemplo.test');
      r = await fetch(`${otro.base}/salud`, { headers: { Origin: 'http://intruso.ejemplo.test' } });
      assert.equal(r.headers.get('access-control-allow-origin'), null);
    } finally {
      await cerrar(otro.servidor);
    }
  });
});

describe('API con PostgreSQL', { skip: URL_PRUEBA ? false : 'sin DATABASE_URL_PRUEBA' }, () => {
  let servidor: Server;
  let base: string;
  let pool: Pool;

  before(async () => {
    pool = crearPool(URL_PRUEBA) as Pool;
    await aplicarEsquema(pool);
    await aplicarEsquema(pool); // idempotente: la segunda vez no debe fallar
    ({ servidor, base } = await levantar({ pool }));
  });
  after(async () => {
    if (servidor) await cerrar(servidor);
    if (pool) await pool.end();
  });

  const contarFilas = async (id: string) => {
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM conciliaciones WHERE id = $1)::int AS c,
              (SELECT count(*) FROM coincidencias WHERE conciliacion_id = $1)::int AS k,
              (SELECT count(*) FROM movimientos WHERE conciliacion_id = $1)::int AS m,
              (SELECT count(*) FROM eventos WHERE conciliacion_id = $1)::int AS e`, [id]);
    return rows[0] as { c: number; k: number; m: number; e: number };
  };

  test('/salud informa la base de datos', async () => {
    assert.deepEqual(await (await fetch(`${base}/salud`)).json(), { ok: true, baseDeDatos: true });
  });

  test('guarda, lista, confirma y rechaza con bitácora', async () => {
    const r = await postJson(`${base}/conciliaciones`, cuerpoValido());
    assert.equal(r.status, 201);
    const { id, resultado, guardada } = await r.json();
    assert.equal(guardada, true);
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.equal(r.headers.get('location'), `/conciliaciones/${id}`);

    const filas = await contarFilas(id);
    assert.deepEqual(filas, { c: 1, k: resultado.coincidencias.length, m: 14 + 21, e: 0 });

    const lista = await (await fetch(`${base}/conciliaciones`)).json();
    assert.ok(lista.some((x: { id: string }) => x.id === id));

    let detalle = await (await fetch(`${base}/conciliaciones/${id}`)).json();
    assert.deepEqual(detalle.resultado, resultado); // se reconstruye idéntico al original
    assert.deepEqual(detalle.bitacora, []);

    const [primera, segunda] = resultado.coincidencias;
    let d = await fetch(`${base}/conciliaciones/${id}/coincidencias/${primera.id}/confirmar`, { method: 'POST' });
    assert.equal(d.status, 200);
    assert.equal((await d.json()).estado, 'confirmada');
    d = await fetch(`${base}/conciliaciones/${id}/coincidencias/${primera.id}/confirmar`, { method: 'POST' });
    assert.equal(d.status, 409);

    d = await fetch(`${base}/conciliaciones/${id}/coincidencias/${segunda.id}/rechazar`, { method: 'POST' });
    assert.equal(d.status, 200);
    const rechazo = await d.json();
    assert.equal(rechazo.estado, 'rechazada');
    assert.deepEqual(rechazo.liberados.banco, [...segunda.bancoIds].sort());
    assert.deepEqual(rechazo.liberados.ventas, [...segunda.ventasIds].sort());
    d = await fetch(`${base}/conciliaciones/${id}/coincidencias/${segunda.id}/confirmar`, { method: 'POST' });
    assert.equal(d.status, 409);

    d = await fetch(`${base}/conciliaciones/${id}/coincidencias/no-existe/confirmar`, { method: 'POST' });
    assert.equal(d.status, 404);

    detalle = await (await fetch(`${base}/conciliaciones/${id}`)).json();
    assert.equal(detalle.estados[primera.id], 'confirmada');
    assert.equal(detalle.estados[segunda.id], 'rechazada');
    assert.deepEqual(detalle.bitacora.map((e: { tipo: string; coincidenciaId: string }) => [e.tipo, e.coincidenciaId]),
      [['confirmar', primera.id], ['rechazar', segunda.id]]);
    for (const b of segunda.bancoIds) assert.ok(detalle.sinCruzar.banco.includes(b));
    for (const v of segunda.ventasIds) assert.ok(detalle.sinCruzar.ventas.includes(v));

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM movimientos WHERE conciliacion_id = $1 AND coincidencia_id = $2', [id, segunda.id]);
    assert.equal(rows[0].n, 0);
  });

  test('conciliación inexistente da 404', async () => {
    const r = await fetch(`${base}/conciliaciones/${randomUUID()}`);
    assert.equal(r.status, 404);
  });

  test('un fallo a mitad del guardado no deja filas a medias', async () => {
    // Se arma una conciliación real y se duplica un movimiento: el INSERT de movimientos
    // falla por clave primaria DESPUÉS de insertar la conciliación y sus coincidencias.
    const r = await postJson(`${base}/conciliaciones`, cuerpoValido());
    const { id: original, resultado } = await r.json();
    const movs = await pool.query(
      `SELECT lado, id, fecha::text AS fecha, monto_centavos, referencia, descripcion, plantilla, linea
       FROM movimientos WHERE conciliacion_id = $1`, [original]);
    const aMov = (f: Record<string, unknown>) => ({ id: f.id, lado: f.lado, fecha: f.fecha, montoCentavos: Number(f.monto_centavos),
      referencia: f.referencia, descripcion: f.descripcion, plantilla: f.plantilla, linea: f.linea });
    const bancoMovs = movs.rows.filter((f) => f.lado === 'banco').map(aMov);
    const ventasMovs = movs.rows.filter((f) => f.lado === 'ventas').map(aMov);

    const id = randomUUID();
    await assert.rejects(guardarConciliacion(pool, {
      id, archivoBanco: 'b.csv', archivoVentas: 'v.csv', plantillaBanco: 'banco-csv-generico', plantillaVentas: 'wompi-transacciones',
      perfil: PERFIL_DEMO, banco: [...bancoMovs, bancoMovs[0]] as never, ventas: ventasMovs as never, resultado,
    }), /duplicate key|llave duplicada/);
    assert.deepEqual(await contarFilas(id), { c: 0, k: 0, m: 0, e: 0 });

    // Y el mismo guardado sin el duplicado sí funciona, para descartar que fallara por otra cosa.
    const otro = await guardarConciliacion(pool, {
      archivoBanco: 'b.csv', archivoVentas: 'v.csv', plantillaBanco: 'banco-csv-generico', plantillaVentas: 'wompi-transacciones',
      perfil: PERFIL_DEMO, banco: bancoMovs as never, ventas: ventasMovs as never, resultado,
    });
    assert.equal((await contarFilas(otro)).c, 1);
  });

  test('si falla algo dentro de una decisión, el estado no cambia', async () => {
    const r = await postJson(`${base}/conciliaciones`, cuerpoValido());
    const { id, resultado } = await r.json();
    const cid = resultado.coincidencias[0].id;
    // Simula un rechazo que se cae después de actualizar estado y bitácora.
    await assert.rejects(enTransaccion(pool, async (cliente) => {
      await cliente.query(`UPDATE coincidencias SET estado = 'rechazada' WHERE conciliacion_id = $1 AND id = $2`, [id, cid]);
      await cliente.query(`INSERT INTO eventos (conciliacion_id, coincidencia_id, tipo, estado_anterior, estado_nuevo)
        VALUES ($1, $2, 'rechazar', 'automatica', 'rechazada')`, [id, cid]);
      await cliente.query('UPDATE movimientos SET coincidencia_id = NULL WHERE conciliacion_id = $1 AND coincidencia_id = $2', [id, cid]);
      throw new Error('caída simulada');
    }), /caída simulada/);
    const detalle = await (await fetch(`${base}/conciliaciones/${id}`)).json();
    assert.equal(detalle.estados[cid], resultado.coincidencias[0].estado);
    assert.deepEqual(detalle.bitacora, []);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM movimientos WHERE conciliacion_id = $1 AND coincidencia_id = $2', [id, cid]);
    assert.equal(rows[0].n, resultado.coincidencias[0].bancoIds.length + resultado.coincidencias[0].ventasIds.length);
  });

  test('el esquema rechaza estados inválidos (CHECK)', async () => {
    const r = await postJson(`${base}/conciliaciones`, cuerpoValido());
    const { id, resultado } = await r.json();
    await assert.rejects(pool.query(`UPDATE coincidencias SET estado = 'perdida' WHERE conciliacion_id = $1 AND id = $2`,
      [id, resultado.coincidencias[0].id]), /check/i);
  });

  test('confirmaciones simultáneas: solo una gana', async () => {
    const r = await postJson(`${base}/conciliaciones`, cuerpoValido());
    const { id, resultado } = await r.json();
    const cid = resultado.coincidencias[0].id;
    const respuestas = await Promise.all([1, 2, 3].map(() =>
      fetch(`${base}/conciliaciones/${id}/coincidencias/${cid}/confirmar`, { method: 'POST' })));
    assert.deepEqual(respuestas.map((x) => x.status).sort(), [200, 409, 409]);
    assert.equal((await contarFilas(id)).e, 1);
  });
});

describe('API: regex de usuario y ReDoS (sin base de datos)', () => {
  let servidor: Server;
  let base: string;
  before(async () => { ({ servidor, base } = await levantar({ pool: null })); });
  after(() => cerrar(servidor));

  const conRegla = (valor: string) => ({
    ...cuerpoValido(),
    perfil: {
      ...PERFIL_DEMO,
      reglas: [{ id: 'r', nombre: 'Regex', prioridad: 1, lado: 'banco', si: { todas: [{ campo: 'descripcion', op: 'regex', valor }] }, accion: { tipo: 'clasificar', categoria: 'x' } }],
    },
  });

  test('el patrón del revisor se rechaza con 400 antes de conciliar', async () => {
    const t0 = performance.now();
    const r = await postJson(`${base}/conciliaciones`, conRegla('^(a+)+$'));
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(await r.json()), /cuantificadores anidados/);
    assert.ok(performance.now() - t0 < 1000);
  });

  test('sin token no se aceptan reglas con op regex (403), aunque sean inofensivas', async () => {
    const r = await postJson(`${base}/conciliaciones`, conRegla('^GMF'));
    assert.equal(r.status, 403);
    assert.match((await r.json()).error.mensaje, /iniciar sesión/);
    // Sin regex la demo anónima sigue igual.
    assert.equal((await postJson(`${base}/conciliaciones`, cuerpoValido())).status, 200);
  });
});
