// Cola persistente y worker: 202 + estado del trabajo, dos workers concurrentes sin
// procesar dos veces el mismo trabajo, reintentos, rollback y recuperación de abandonados.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { aplicarEsquema, crearPool } from '../src/bd.ts';
import { EMPRESA_DEMO_ID } from '../src/auth.ts';
import { encolarTrabajo, recuperarVencidos, tomarTrabajo } from '../src/trabajos.ts';
import type { CargaConciliar } from '../src/trabajos.ts';
import { crearWorker } from '../src/worker.ts';
import { URL_PRUEBA, cerrar, cliente, crearBaseUnica, cuerpoValido, esperarHasta, levantar } from './ayudas.ts';

const carga = (): CargaConciliar => cuerpoValido() as CargaConciliar;

describe('API asíncrona en modo memoria', () => {
  test('POST /conciliaciones?asincrono=1 sin base responde 503', async () => {
    const { servidor, base } = await levantar({ pool: null });
    try {
      const r = await cliente(base).post('/conciliaciones?asincrono=1', cuerpoValido());
      assert.equal(r.status, 503);
    } finally { await cerrar(servidor); }
  });
});

describe('Cola de trabajos con PostgreSQL', { skip: URL_PRUEBA ? false : 'sin DATABASE_URL_PRUEBA' }, () => {
  let borrar: () => Promise<void>;
  let url: string;
  let pool: Pool;
  let servidor: Server;
  let base: string;

  before(async () => {
    const creada = await crearBaseUnica('cola');
    borrar = creada.borrar;
    url = creada.url;
    pool = crearPool(url) as Pool;
    await aplicarEsquema(pool);
    ({ servidor, base } = await levantar({ pool, jwtSecreto: 'secreto-cola-0123456789' }));
  });
  after(async () => {
    if (servidor) await cerrar(servidor);
    if (pool) await pool.end();
    if (borrar) await borrar();
  });

  // Cada prueba deja la cola vacía para no contaminar a la siguiente.
  const vaciarCola = () => pool.query('DELETE FROM trabajos');
  const estadoDe = async (id: string) => (await pool.query('SELECT estado, intentos, error, conciliacion_id FROM trabajos WHERE id = $1', [id])).rows[0];
  const contarConciliaciones = async () => (await pool.query('SELECT count(*)::int AS n FROM conciliaciones')).rows[0].n as number;

  test('202 con id de trabajo; el worker concilia y GET /trabajos/:id lo refleja', async () => {
    await vaciarCola();
    const sincrono = await (await cliente(base).post('/conciliaciones', cuerpoValido())).json();
    const r = await cliente(base).post('/conciliaciones?asincrono=1', cuerpoValido());
    assert.equal(r.status, 202);
    const { trabajoId, estado } = await r.json();
    assert.equal(estado, 'pendiente');
    assert.equal(r.headers.get('location'), `/trabajos/${trabajoId}`);
    let t = await (await cliente(base).get(`/trabajos/${trabajoId}`)).json();
    assert.equal(t.estado, 'pendiente');
    assert.equal(t.conciliacionId, null);

    // Validación previa: un cuerpo malo no se encola.
    assert.equal((await cliente(base).post('/conciliaciones?asincrono=1', { banco: 1 })).status, 400);

    const worker = crearWorker({ pool, nombre: 'w-prueba' });
    assert.equal(await worker.procesarUno(), true);
    assert.equal(await worker.procesarUno(), false); // cola vacía
    t = await (await cliente(base).get(`/trabajos/${trabajoId}`)).json();
    assert.equal(t.estado, 'hecho');
    assert.equal(t.intentos, 1);
    assert.ok(t.terminado);
    const detalle = await (await cliente(base).get(`/conciliaciones/${t.conciliacionId}`)).json();
    assert.deepEqual(detalle.resultado.resumen, sincrono.resultado.resumen); // mismo cruce que el camino síncrono
    // La carga se vacía al terminar (ya está en conciliaciones).
    assert.equal((await pool.query('SELECT carga FROM trabajos WHERE id = $1', [trabajoId])).rows[0].carga, null);
  });

  test('aislamiento: otra empresa no ve el trabajo; el resultado queda en la empresa que lo encoló', async () => {
    await vaciarCola();
    const reg = await (await cliente(base).post('/auth/registro', {
      empresa: 'Empresa Cola', nombre: 'Admin Cola', correo: 'admin.cola@ejemplo.test', contrasena: 'clave-sintetica-123',
    })).json();
    const { trabajoId } = await (await cliente(base, reg.token).post('/conciliaciones?asincrono=1', cuerpoValido())).json();
    assert.equal((await cliente(base).get(`/trabajos/${trabajoId}`)).status, 404); // la demo no lo ve
    await crearWorker({ pool }).procesarUno();
    const t = await (await cliente(base, reg.token).get(`/trabajos/${trabajoId}`)).json();
    assert.equal(t.estado, 'hecho');
    assert.equal((await cliente(base).get(`/conciliaciones/${t.conciliacionId}`)).status, 404);
    assert.equal((await cliente(base, reg.token).get(`/conciliaciones/${t.conciliacionId}`)).status, 200);
    const { rows } = await pool.query('SELECT empresa_id, usuario_id FROM conciliaciones WHERE id = $1', [t.conciliacionId]);
    assert.deepEqual(rows[0], { empresa_id: reg.empresa.id, usuario_id: reg.usuario.id });
  });

  test('dos tomas simultáneas sobre un solo trabajo: solo una lo obtiene (SKIP LOCKED)', async () => {
    await vaciarCola();
    await encolarTrabajo(pool, { empresaId: EMPRESA_DEMO_ID, carga: carga() });
    const tomas = await Promise.all([tomarTrabajo(pool, 'a'), tomarTrabajo(pool, 'b'), tomarTrabajo(pool, 'c')]);
    assert.equal(tomas.filter((x) => x !== null).length, 1);
  });

  test('dos workers concurrentes (pools separados) procesan cada trabajo exactamente una vez', async () => {
    await vaciarCola();
    const antes = await contarConciliaciones();
    const N = 24;
    const ids: string[] = [];
    for (let i = 0; i < N; i++) ids.push(await encolarTrabajo(pool, { empresaId: EMPRESA_DEMO_ID, carga: carga() }));

    const poolA = crearPool(url) as Pool;
    const poolB = crearPool(url) as Pool;
    // Una pausa corta dentro de cada transacción hace que los trabajos se solapen de verdad.
    const pausa = () => new Promise<void>((r) => setTimeout(r, 5));
    const a = crearWorker({ pool: poolA, nombre: 'A', concurrencia: 2, intervaloMs: 20, alGuardar: pausa });
    const b = crearWorker({ pool: poolB, nombre: 'B', concurrencia: 2, intervaloMs: 20, alGuardar: pausa });
    a.iniciar();
    b.iniciar();
    try {
      await esperarHasta(async () => (await pool.query(`SELECT count(*)::int AS n FROM trabajos WHERE estado = 'hecho'`)).rows[0].n === N);
    } finally {
      await Promise.all([a.detener(), b.detener()]);
      await Promise.all([poolA.end(), poolB.end()]);
    }
    assert.equal(a.procesados + b.procesados, N);
    assert.ok(a.procesados > 0 && b.procesados > 0, `reparto A=${a.procesados} B=${b.procesados}`);
    const { rows } = await pool.query(
      `SELECT count(DISTINCT conciliacion_id)::int AS distintas, max(intentos) AS max_intentos,
         count(*) FILTER (WHERE worker = 'A')::int AS de_a FROM trabajos WHERE id = ANY($1)`, [ids]);
    assert.equal(rows[0].distintas, N);
    assert.equal(rows[0].max_intentos, 1); // nadie lo tomó dos veces
    assert.equal(await contarConciliaciones(), antes + N); // ni una conciliación de más
  });

  test('rollback: si falla al guardar no queda nada a medias y se reintenta', async () => {
    await vaciarCola();
    const antes = await contarConciliaciones();
    const id = await encolarTrabajo(pool, { empresaId: EMPRESA_DEMO_ID, carga: carga(), maxIntentos: 3 });
    let fallar = true;
    const worker = crearWorker({
      pool, esperaBaseMs: 0,
      alGuardar: () => { if (fallar) throw new Error('caída simulada después de insertar'); },
    });
    await worker.procesarUno();
    let t = await estadoDe(id);
    assert.equal(t.estado, 'pendiente');
    assert.equal(t.intentos, 1);
    assert.match(t.error, /caída simulada/);
    assert.equal(t.conciliacion_id, null);
    assert.equal(await contarConciliaciones(), antes); // la conciliación insertada se deshizo
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM movimientos m LEFT JOIN conciliaciones c ON c.id = m.conciliacion_id WHERE c.id IS NULL')).rows[0].n, 0);

    fallar = false;
    await worker.procesarUno();
    t = await estadoDe(id);
    assert.equal(t.estado, 'hecho');
    assert.equal(t.intentos, 2);
    assert.equal(t.error, null);
    assert.equal(await contarConciliaciones(), antes + 1);
  });

  test('reintentos con límite y espera; errores de datos fallan sin reintentar', async () => {
    await vaciarCola();
    const id = await encolarTrabajo(pool, { empresaId: EMPRESA_DEMO_ID, carga: carga(), maxIntentos: 2 });
    const roto = crearWorker({ pool, esperaBaseMs: 60_000, alGuardar: () => { throw new Error('base inestable'); } });
    await roto.procesarUno();
    assert.equal((await estadoDe(id)).estado, 'pendiente');
    // Con espera de 60 s no está disponible todavía.
    assert.equal(await roto.procesarUno(), false);
    await pool.query('UPDATE trabajos SET disponible_en = now() WHERE id = $1', [id]);
    await roto.procesarUno();
    const t = await estadoDe(id);
    assert.equal(t.estado, 'fallido');
    assert.equal(t.intentos, 2);

    const malo = await encolarTrabajo(pool, {
      empresaId: EMPRESA_DEMO_ID, maxIntentos: 5,
      carga: { ...carga(), banco: { nombre: 'x.txt', texto: 'nada que ver\n1 2 3' } },
    });
    await crearWorker({ pool }).procesarUno();
    const r = await (await cliente(base).get(`/trabajos/${malo}`)).json();
    assert.equal(r.estado, 'fallido');
    assert.equal(r.intentos, 1); // 422: reintentar no arregla los datos
    assert.match(r.error.mensaje, /No se pudieron leer/);
    assert.equal(r.error.detalles[0].archivo, 'banco');
  });

  test('worker caído: el trabajo abandonado vuelve a la cola y el worker lento no guarda dos veces', async () => {
    await vaciarCola();
    const antes = await contarConciliaciones();
    const id = await encolarTrabajo(pool, { empresaId: EMPRESA_DEMO_ID, carga: carga() });
    const poolB = crearPool(url) as Pool;
    const rapido = crearWorker({ pool: poolB, nombre: 'rapido' });
    // El lento se "congela" dentro de su transacción; mientras, su trabajo se da por perdido y otro lo termina.
    const lento = crearWorker({
      pool, nombre: 'lento',
      alGuardar: async () => {
        assert.equal(await recuperarVencidos(poolB, 0), 1);
        assert.equal(await rapido.procesarUno(), true);
      },
    });
    try {
      await lento.procesarUno();
    } finally { await poolB.end(); }
    const t = await estadoDe(id);
    assert.equal(t.estado, 'hecho');
    assert.equal(t.intentos, 2);
    assert.equal(lento.procesados, 0);
    assert.equal(rapido.procesados, 1);
    assert.equal(await contarConciliaciones(), antes + 1);
  });

  test('detener() es limpio aunque el worker esté esperando', async () => {
    await vaciarCola();
    const w = crearWorker({ pool, intervaloMs: 60_000 });
    w.iniciar();
    await new Promise((r) => setTimeout(r, 50));
    const t0 = Date.now();
    await w.detener();
    assert.ok(Date.now() - t0 < 1_000);
  });

  test('proceso worker real: npm run worker toma un trabajo y se apaga con SIGTERM', async () => {
    await vaciarCola();
    const id = await encolarTrabajo(pool, { empresaId: EMPRESA_DEMO_ID, carga: carga() });
    const hijo = spawn(process.execPath, [new URL('../src/worker.ts', import.meta.url).pathname], {
      env: { ...process.env, DATABASE_URL: url, WORKER_INTERVALO_MS: '50', LOG_NIVEL: 'info', NODE_TEST_CONTEXT: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let salida = '';
    hijo.stdout.on('data', (d) => { salida += d; });
    hijo.stderr.on('data', (d) => { salida += d; });
    const fin = new Promise<number | null>((r) => hijo.on('exit', (codigo) => r(codigo)));
    try {
      await esperarHasta(async () => (await estadoDe(id)).estado === 'hecho', 20_000);
    } finally {
      hijo.kill('SIGTERM');
    }
    assert.equal(await fin, 0, salida);
    // Registros estructurados: cada línea es JSON con ts, nivel y evento.
    const eventos = salida.trim().split('\n').map((l) => JSON.parse(l));
    for (const e of ['worker_iniciado', 'trabajo_tomado', 'trabajo_hecho', 'worker_apagando', 'worker_detenido']) {
      assert.ok(eventos.some((x) => x.evento === e), `falta ${e} en ${salida}`);
    }
    assert.ok(eventos.every((x) => typeof x.ts === 'string' && typeof x.nivel === 'string'));
  });

  test('/metricas cuenta trabajos por estado y tiempos', async () => {
    const m = await (await cliente(base).get('/metricas')).json();
    assert.ok(m.empresa.trabajos.porEstado.hecho >= 1);
    assert.ok(m.empresa.trabajos.tiempoProcesoMs.muestras >= 1);
    assert.equal(typeof m.empresa.trabajos.tiempoProcesoMs.promedio, 'number');
  });
});
