// Multiempresa con PostgreSQL: migraciones, aislamiento entre empresas, roles, JWT,
// versiones de plantillas y perfiles, auditoría y paginación. Usa una base propia y desechable.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { aplicarEsquema, crearPool } from '../src/bd.ts';
import { aplicarMigraciones, leerMigraciones } from '../src/migraciones.ts';
import { firmarJwt } from '../src/jwt.ts';
import { EMPRESA_DEMO_ID } from '../src/auth.ts';
import { URL_PRUEBA, cerrar, cliente, crearBaseUnica, cuerpoValido, levantar, PERFIL_DEMO } from './ayudas.ts';

const SECRETO = 'secreto-de-prueba-multiempresa-0123456789';

// Plantilla propia (la del README): extracto ficticio separado por '|'.
const PLANTILLA_PROPIA = {
  id: 'banco-ejemplo-csv', nombre: 'Banco Ejemplo: movimientos CSV', version: 1, lado: 'banco',
  tipo: 'delimitado', separador: '|', separadorDecimal: '.', formatoFecha: 'yyyy-MM-dd', filasEncabezado: 1,
  omitirSi: [{ campo: 'Concepto', regex: '^(SALDO|TOTAL)' }, { campo: 'Credito', regex: '^\\s*$' }],
  soloEntradas: true,
  detectar: { encabezados: ['Fecha Mov', 'Concepto', 'Documento', 'Credito', 'Debito'] },
  columnas: { fecha: 'Fecha Mov', descripcion: 'Concepto', referencia: { de: 'Concepto', regex: 'REF[: ]*(\\S+)' }, monto: 'Credito' },
};
const EXTRACTO_PROPIO = [
  'Fecha Mov|Concepto|Documento|Credito|Debito',
  '2026-10-01|SALDO INICIAL|||',
  '2026-10-01|ABONO PSE REF:PED-2026-0001|884512|89500.00|',
  '2026-10-02|PAGO PROVEEDOR|884513||-120000.00',
  '2026-10-02|TRANSFERENCIA REF PED-2026-0002|884514|1250000.50|',
].join('\n');

describe('Multiempresa con PostgreSQL', { skip: URL_PRUEBA ? false : 'sin DATABASE_URL_PRUEBA' }, () => {
  let borrar: () => Promise<void>;
  let pool: Pool;
  let servidor: Server;
  let base: string;
  // Tokens por empresa y rol.
  const t: Record<string, string> = {};
  const ids: Record<string, string> = {};

  before(async () => {
    const creada = await crearBaseUnica('multi');
    borrar = creada.borrar;
    pool = crearPool(creada.url) as Pool;
    await aplicarEsquema(pool);
    ({ servidor, base } = await levantar({ pool, jwtSecreto: SECRETO, limiteIngreso: { maximo: 1000, ventanaMs: 60_000 } }));

    for (const empresa of ['A', 'B']) {
      const r = await cliente(base).post('/auth/registro', {
        empresa: `Empresa ${empresa} SAS`, nombre: `Admin ${empresa}`, correo: `admin.${empresa.toLowerCase()}@ejemplo.test`, contrasena: 'clave-sintetica-123',
      });
      assert.equal(r.status, 201);
      const cuerpo = await r.json();
      t[`admin${empresa}`] = cuerpo.token;
      ids[`empresa${empresa}`] = cuerpo.empresa.id;
      ids[`admin${empresa}`] = cuerpo.usuario.id;
      assert.equal(cuerpo.usuario.rol, 'admin');
      assert.equal(cuerpo.usuario.hash_contrasena, undefined);
    }
    for (const rol of ['analista', 'lector']) {
      const correo = `${rol}.a@ejemplo.test`;
      const r = await cliente(base, t.adminA).post('/empresa/usuarios', { nombre: `Persona ${rol}`, correo, contrasena: 'clave-sintetica-456', rol });
      assert.equal(r.status, 201);
      ids[`${rol}A`] = (await r.json()).id;
      const ingreso = await cliente(base).post('/auth/ingreso', { correo: correo.toUpperCase(), contrasena: 'clave-sintetica-456' });
      assert.equal(ingreso.status, 200);
      t[`${rol}A`] = (await ingreso.json()).token;
    }
  });
  after(async () => {
    if (servidor) await cerrar(servidor);
    if (pool) await pool.end();
    if (borrar) await borrar();
  });

  test('migraciones: idempotentes, ordenadas y registradas', async () => {
    assert.deepEqual(await aplicarMigraciones(pool), []); // ya estaba al día
    const { rows } = await pool.query('SELECT version FROM migraciones ORDER BY version');
    const esperadas = (await leerMigraciones()).map((m) => m.version);
    assert.deepEqual(rows.map((f) => f.version), esperadas);
    assert.deepEqual(esperadas, [...esperadas].sort());
    // Dos arranques simultáneos no chocan (candado).
    await Promise.all([aplicarEsquema(pool), aplicarEsquema(pool)]);
  });

  test('una base creada por el MVP se migra sin perder datos (quedan en la empresa demo)', async () => {
    const otra = await crearBaseUnica('mvp');
    const viejo = crearPool(otra.url) as Pool;
    try {
      const [inicial] = await leerMigraciones();
      await viejo.query(inicial.sql); // así quedaba una base del MVP: sin tabla migraciones
      const id = randomUUID();
      await viejo.query(`INSERT INTO conciliaciones VALUES ($1, now(), 'b.csv', 'v.csv', 'pb', 'pv', '{}', '{"movimientosBanco":1}', '{}')`, [id]);
      await viejo.query(`INSERT INTO coincidencias VALUES ($1, 'c1', 0, 'exacta', '{b1}', '{v1}', 1, 0, 'x', 'automatica', 'confirmada')`, [id]);
      await viejo.query(`INSERT INTO eventos (conciliacion_id, coincidencia_id, tipo, estado_anterior, estado_nuevo) VALUES ($1, 'c1', 'confirmar', 'automatica', 'confirmada')`, [id]);
      const aplicadas = await aplicarMigraciones(viejo);
      assert.equal(aplicadas[0], '001');
      const { rows } = await viejo.query(
        `SELECT c.empresa_id, k.empresa_id AS k_emp, e.empresa_id AS e_emp, k.estado FROM conciliaciones c
         JOIN coincidencias k ON k.conciliacion_id = c.id JOIN eventos e ON e.conciliacion_id = c.id WHERE c.id = $1`, [id]);
      assert.deepEqual(rows, [{ empresa_id: EMPRESA_DEMO_ID, k_emp: EMPRESA_DEMO_ID, e_emp: EMPRESA_DEMO_ID, estado: 'confirmada' }]);
      // Y la API la sirve sin token, como antes.
      const srv = await levantar({ pool: viejo, jwtSecreto: SECRETO });
      try {
        const detalle = await (await cliente(srv.base).get(`/conciliaciones/${id}`)).json();
        assert.equal(detalle.estados.c1, 'confirmada');
        assert.equal(detalle.bitacora.length, 1);
      } finally { await cerrar(srv.servidor); }
    } finally {
      await viejo.end();
      await otra.borrar();
    }
  });

  test('aislamiento: una empresa no ve ni toca datos de otra (ni la demo)', async () => {
    const r = await cliente(base, t.analistaA).post('/conciliaciones', cuerpoValido());
    assert.equal(r.status, 201);
    const { id, resultado } = await r.json();
    const cid = resultado.coincidencias[0].id;
    const demo = await (await cliente(base).post('/conciliaciones', cuerpoValido())).json();

    // A la ve; B y la demo no (404, igual que si no existiera).
    assert.equal((await cliente(base, t.lectorA).get(`/conciliaciones/${id}`)).status, 200);
    assert.equal((await cliente(base, t.adminB).get(`/conciliaciones/${id}`)).status, 404);
    assert.equal((await cliente(base).get(`/conciliaciones/${id}`)).status, 404);
    assert.equal((await cliente(base, t.adminA).get(`/conciliaciones/${demo.id}`)).status, 404);

    const listaB = await (await cliente(base, t.adminB).get('/conciliaciones')).json();
    assert.deepEqual(listaB, []);
    const listaA = (await (await cliente(base, t.adminA).get('/conciliaciones')).json()).map((x: { id: string }) => x.id);
    assert.ok(listaA.includes(id) && !listaA.includes(demo.id));
    const listaDemo = (await (await cliente(base).get('/conciliaciones')).json()).map((x: { id: string }) => x.id);
    assert.ok(listaDemo.includes(demo.id) && !listaDemo.includes(id));

    // B no puede decidir sobre la coincidencia de A y el estado no cambia.
    assert.equal((await cliente(base, t.adminB).post(`/conciliaciones/${id}/coincidencias/${cid}/rechazar`)).status, 404);
    assert.equal((await cliente(base).post(`/conciliaciones/${id}/coincidencias/${cid}/rechazar`)).status, 404);
    const detalle = await (await cliente(base, t.adminA).get(`/conciliaciones/${id}`)).json();
    assert.equal(detalle.estados[cid], resultado.coincidencias[0].estado);

    // En la base, cada fila hija lleva la empresa de su conciliación.
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM movimientos WHERE conciliacion_id = $1 AND empresa_id <> $2)::int AS m,
              (SELECT count(*) FROM coincidencias WHERE conciliacion_id = $1 AND empresa_id <> $2)::int AS k`, [id, ids.empresaA]);
    assert.deepEqual(rows[0], { m: 0, k: 0 });
    // Y la base impide colgar filas de una conciliación ajena con otra empresa.
    await assert.rejects(pool.query(
      `INSERT INTO eventos (conciliacion_id, empresa_id, coincidencia_id, tipo, estado_anterior, estado_nuevo)
       VALUES ($1, $2, $3, 'confirmar', 'automatica', 'confirmada')`, [id, ids.empresaB, cid]), /foreign key|llave foránea/);
  });

  test('con token se aceptan reglas con regex segura (la demo anónima no)', async () => {
    const perfil = {
      ...cuerpoValido().perfil,
      reglas: [{ id: 'r', nombre: 'Regex', prioridad: 1, lado: 'banco', si: { todas: [{ campo: 'descripcion', op: 'regex', valor: '^gmf' }] }, accion: { tipo: 'clasificar', categoria: 'gasto:GMF' } }],
    };
    assert.equal((await cliente(base, t.analistaA).post('/conciliaciones', { ...cuerpoValido(), perfil })).status, 201);
    assert.equal((await cliente(base).post('/conciliaciones', { ...cuerpoValido(), perfil })).status, 403);
  });

  test('roles: lector solo lee, analista concilia, admin administra', async () => {
    const lector = cliente(base, t.lectorA);
    const analista = cliente(base, t.analistaA);
    assert.equal((await lector.get('/conciliaciones')).status, 200);
    assert.equal((await lector.post('/conciliaciones', cuerpoValido())).status, 403);
    assert.equal((await lector.post('/empresa/perfiles', PERFIL_DEMO)).status, 403);
    assert.equal((await lector.get('/empresa/usuarios')).status, 403);
    assert.equal((await analista.get('/empresa/usuarios')).status, 403);
    assert.equal((await analista.post('/empresa/usuarios', { nombre: 'X', correo: 'x@ejemplo.test', contrasena: 'clave-sintetica', rol: 'admin' })).status, 403);

    const r = await analista.post('/conciliaciones', cuerpoValido());
    const { id, resultado } = await r.json();
    const cid = resultado.coincidencias[0].id;
    assert.equal((await lector.post(`/conciliaciones/${id}/coincidencias/${cid}/confirmar`)).status, 403);
    const decision = await analista.post(`/conciliaciones/${id}/coincidencias/${cid}/confirmar`);
    assert.equal(decision.status, 200);
    assert.equal((await decision.json()).evento.usuarioId, ids.analistaA);

    // Auditoría: la bitácora guarda quién decidió.
    const detalle = await (await lector.get(`/conciliaciones/${id}`)).json();
    assert.equal(detalle.bitacora[0].usuarioId, ids.analistaA);
    const { rows } = await pool.query('SELECT usuario_id FROM eventos WHERE conciliacion_id = $1', [id]);
    assert.deepEqual(rows, [{ usuario_id: ids.analistaA }]);

    // Administración: requiere token y rol admin; listado sin hashes.
    assert.equal((await cliente(base).get('/empresa/usuarios')).status, 401);
    const usuarios = await (await cliente(base, t.adminA).get('/empresa/usuarios')).json();
    assert.deepEqual(usuarios.map((u: { rol: string }) => u.rol).sort(), ['admin', 'analista', 'lector']);
    assert.ok(usuarios.every((u: Record<string, unknown>) => !('hash_contrasena' in u) && u.empresaId === ids.empresaA));
    const usuariosB = await (await cliente(base, t.adminB).get('/empresa/usuarios')).json();
    assert.equal(usuariosB.length, 1);

    // Validaciones y correos duplicados.
    let rr = await cliente(base, t.adminA).post('/empresa/usuarios', { nombre: 'Otro', correo: 'ANALISTA.a@ejemplo.test', contrasena: 'clave-sintetica', rol: 'lector' });
    assert.equal(rr.status, 409);
    rr = await cliente(base, t.adminA).post('/empresa/usuarios', { nombre: 'Otro', correo: 'no-es-correo', contrasena: 'corta', rol: 'jefe' });
    assert.equal(rr.status, 400);
    assert.equal((await rr.json()).error.detalles.length, 3);
  });

  test('JWT: vencido, alterado, de otro secreto o de usuario desactivado -> 401', async () => {
    const vencido = firmarJwt({ sub: ids.adminA, emp: ids.empresaA, rol: 'admin' }, SECRETO, 60, Date.now() - 3_600_000);
    let r = await cliente(base, vencido).get('/conciliaciones');
    assert.equal(r.status, 401);
    assert.match((await r.json()).error.mensaje, /venció/);
    assert.equal(r.headers.get('www-authenticate'), 'Bearer');

    // Un lector que se cambia el rol a admin en la carga rompe la firma.
    const [e, c, f] = t.lectorA.split('.');
    const cargaAdmin = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(c, 'base64url').toString()), rol: 'admin' })).toString('base64url');
    assert.equal((await cliente(base, `${e}.${cargaAdmin}.${f}`).get('/empresa/usuarios')).status, 401);
    assert.equal((await cliente(base, firmarJwt({ sub: ids.adminA, emp: ids.empresaA, rol: 'admin' }, 'otro-secreto', 60)).get('/conciliaciones')).status, 401);
    // Token bien firmado pero con la empresa de otro: no coincide con el usuario.
    assert.equal((await cliente(base, firmarJwt({ sub: ids.adminA, emp: ids.empresaB, rol: 'admin' }, SECRETO, 60)).get('/conciliaciones')).status, 401);
    // Un token inválido no cae a la demo, ni en rutas que funcionan sin token.
    assert.equal((await cliente(base, 'basura').post('/conciliaciones', cuerpoValido())).status, 401);

    // El rol se relee de la base: desactivar a alguien corta su token al instante.
    const nuevo = await (await cliente(base, t.adminA).post('/empresa/usuarios', { nombre: 'Temporal', correo: 'temporal.a@ejemplo.test', contrasena: 'clave-sintetica', rol: 'lector' })).json();
    const token = (await (await cliente(base).post('/auth/ingreso', { correo: 'temporal.a@ejemplo.test', contrasena: 'clave-sintetica' })).json()).token;
    assert.equal((await cliente(base, token).get('/conciliaciones')).status, 200);
    await pool.query('UPDATE usuarios SET activo = false WHERE id = $1', [nuevo.id]);
    assert.equal((await cliente(base, token).get('/conciliaciones')).status, 401);
    assert.equal((await cliente(base).post('/auth/ingreso', { correo: 'temporal.a@ejemplo.test', contrasena: 'clave-sintetica' })).status, 401);

    // Ingreso con contraseña mala o correo inexistente: mismo 401 genérico.
    for (const datos of [{ correo: 'admin.a@ejemplo.test', contrasena: 'equivocada' }, { correo: 'nadie@ejemplo.test', contrasena: 'equivocada' }]) {
      const x = await cliente(base).post('/auth/ingreso', datos);
      assert.equal(x.status, 401);
      assert.equal((await x.json()).error.mensaje, 'Correo o contraseña incorrectos.');
    }
  });

  test('plantillas por empresa: versiones que no se sobrescriben y se usan al conciliar', async () => {
    const admin = cliente(base, t.adminA);
    let r = await admin.post('/empresa/plantillas', PLANTILLA_PROPIA);
    assert.equal(r.status, 201);
    assert.equal((await r.json()).version, 1);
    r = await admin.post('/empresa/plantillas', { ...PLANTILLA_PROPIA, nombre: 'Banco Ejemplo (v2)', version: 77 });
    const v2 = await r.json();
    assert.equal(v2.version, 2); // la versión la pone el servidor
    assert.equal(v2.contenido.version, 2);

    const versiones = await (await admin.get('/empresa/plantillas/banco-ejemplo-csv/versiones')).json();
    assert.deepEqual(versiones.map((v: { version: number; contenido: { nombre: string } }) => [v.version, v.contenido.nombre]),
      [[2, 'Banco Ejemplo (v2)'], [1, 'Banco Ejemplo: movimientos CSV']]);
    assert.equal(versiones[0].usuarioId, ids.adminA);
    const vigentes = await (await cliente(base, t.lectorA).get('/empresa/plantillas')).json();
    assert.deepEqual(vigentes.map((v: { id: string; version: number }) => [v.id, v.version]), [['banco-ejemplo-csv', 2]]);

    // La base prohíbe reescribir el historial.
    await assert.rejects(pool.query(`UPDATE plantillas_versiones SET contenido = '{}' WHERE plantilla_id = 'banco-ejemplo-csv'`), /historial inmutable/);
    await assert.rejects(pool.query(`DELETE FROM plantillas_versiones WHERE plantilla_id = 'banco-ejemplo-csv'`), /historial inmutable/);

    // Reglas: no se puede tapar una incluida, ni cambiar de lado, ni guardar algo inválido.
    assert.equal((await admin.post('/empresa/plantillas', { ...PLANTILLA_PROPIA, id: 'wompi-transacciones' })).status, 409);
    assert.equal((await admin.post('/empresa/plantillas', { ...PLANTILLA_PROPIA, lado: 'ventas' })).status, 409);
    r = await admin.post('/empresa/plantillas', { ...PLANTILLA_PROPIA, columnas: {} });
    assert.equal(r.status, 400);
    assert.ok((await r.json()).error.detalles.length > 0);

    // B no la ve.
    assert.equal((await cliente(base, t.adminB).get('/empresa/plantillas/banco-ejemplo-csv/versiones')).status, 404);
    assert.deepEqual(await (await cliente(base, t.adminB).get('/empresa/plantillas')).json(), []);

    // A concilia con su plantilla: se detecta sola por encabezados y también se puede nombrar.
    const cuerpo = { ...cuerpoValido(), banco: { nombre: 'extracto-propio.csv', texto: EXTRACTO_PROPIO } };
    r = await cliente(base, t.analistaA).post('/conciliaciones', cuerpo);
    assert.equal(r.status, 201);
    let salida = await r.json();
    assert.equal(salida.ingesta[0].plantillaId, 'banco-ejemplo-csv');
    assert.equal(salida.resultado.resumen.movimientosBanco, 2);
    r = await cliente(base, t.analistaA).post('/conciliaciones', { ...cuerpo, banco: { ...cuerpo.banco, plantillaId: 'banco-ejemplo-csv' } });
    assert.equal(r.status, 201);
    // GET /plantillas con token incluye las propias; sin token, solo las incluidas.
    const conToken = (await (await cliente(base, t.lectorA).get('/plantillas')).json()).map((p: { id: string }) => p.id);
    const sinToken = (await (await cliente(base).get('/plantillas')).json()).map((p: { id: string }) => p.id);
    assert.ok(conToken.includes('banco-ejemplo-csv') && !sinToken.includes('banco-ejemplo-csv'));
    assert.equal(conToken.length, sinToken.length + 1);

    // B (y la demo) no pueden usarla: ni nombrándola ni por detección.
    r = await cliente(base, t.adminB).post('/conciliaciones', { ...cuerpo, banco: { ...cuerpo.banco, plantillaId: 'banco-ejemplo-csv' } });
    assert.equal(r.status, 400);
    r = await cliente(base, t.adminB).post('/conciliaciones', cuerpo);
    assert.equal(r.status, 422);
    salida = await (await cliente(base).post('/conciliaciones', cuerpo));
    assert.equal(salida.status, 422);
  });

  test('perfiles por empresa: versiones y conciliar por id de perfil', async () => {
    const analista = cliente(base, t.analistaA);
    let r = await analista.post('/empresa/perfiles', { ...PERFIL_DEMO, id: 'tienda', nombre: 'Tienda v1', toleranciaFaltantePorcentaje: 0 });
    assert.equal(r.status, 201);
    r = await analista.post('/empresa/perfiles', { ...PERFIL_DEMO, id: 'tienda', nombre: 'Tienda v2' });
    assert.equal((await r.json()).version, 2);
    assert.equal((await analista.post('/empresa/perfiles', { id: 'malo' })).status, 400);

    const { perfil: _sinPerfil, ...sinPerfil } = cuerpoValido();
    r = await analista.post('/conciliaciones', { ...sinPerfil, perfilId: 'tienda' });
    assert.equal(r.status, 201);
    const vigente = await r.json();
    r = await analista.post('/conciliaciones', { ...sinPerfil, perfilId: 'tienda', perfilVersion: 1 });
    const v1 = await r.json();
    // v1 no tolera faltantes: concilia menos que v2.
    assert.ok(vigente.resultado.resumen.totalConciliadoCentavos > v1.resultado.resumen.totalConciliadoCentavos);
    const detalle = await (await analista.get(`/conciliaciones/${vigente.id}`)).json();
    assert.deepEqual(detalle.perfilRef, { id: 'tienda', version: 2 });
    assert.equal(detalle.perfil.nombre, 'Tienda v2');

    // Errores: perfil inexistente, de otra empresa, versión inexistente o perfil y perfilId juntos.
    assert.equal((await analista.post('/conciliaciones', { ...sinPerfil, perfilId: 'no-existe' })).status, 400);
    assert.equal((await cliente(base, t.adminB).post('/conciliaciones', { ...sinPerfil, perfilId: 'tienda' })).status, 400);
    assert.equal((await analista.post('/conciliaciones', { ...sinPerfil, perfilId: 'tienda', perfilVersion: 9 })).status, 400);
    assert.equal((await analista.post('/conciliaciones', { ...cuerpoValido(), perfilId: 'tienda' })).status, 400);
    const versiones = await (await analista.get('/empresa/perfiles/tienda/versiones')).json();
    assert.deepEqual(versiones.map((v: { version: number }) => v.version), [2, 1]);
  });

  test('paginación con cursor: sin repetir ni saltar filas', async () => {
    const registro = await (await cliente(base).post('/auth/registro', {
      empresa: 'Empresa Paginada', nombre: 'Admin P', correo: 'admin.p@ejemplo.test', contrasena: 'clave-sintetica-123',
    })).json();
    const c = cliente(base, registro.token);
    const creadas: string[] = [];
    for (let i = 0; i < 5; i++) creadas.push((await (await c.post('/conciliaciones', cuerpoValido())).json()).id);

    const vistas: string[] = [];
    let cursor: string | null = null;
    let paginas = 0;
    do {
      const r = await c.get(`/conciliaciones?limite=2${cursor ? `&cursor=${cursor}` : ''}`);
      assert.equal(r.status, 200);
      const pagina = await r.json();
      vistas.push(...pagina.map((x: { id: string }) => x.id));
      cursor = r.headers.get('x-cursor-siguiente');
      paginas++;
    } while (cursor && paginas < 10);
    assert.equal(paginas, 3);
    assert.deepEqual([...vistas].sort(), [...creadas].sort());
    assert.deepEqual(vistas, [...creadas].reverse()); // más recientes primero

    // El cursor no depende de los milisegundos: conciliaciones con el mismo 'creada' también se paginan bien.
    await pool.query(`UPDATE conciliaciones SET creada = '2026-10-01T00:00:00Z' WHERE id = ANY($1)`, [creadas]);
    const r1 = await c.get('/conciliaciones?limite=3');
    const primera = (await r1.json()).map((x: { id: string }) => x.id);
    const r2 = await c.get(`/conciliaciones?limite=3&cursor=${r1.headers.get('x-cursor-siguiente')}`);
    const segunda = (await r2.json()).map((x: { id: string }) => x.id);
    assert.deepEqual([...primera, ...segunda].sort(), [...creadas].sort());
    assert.equal(r2.headers.get('x-cursor-siguiente'), null);

    assert.equal((await c.get('/conciliaciones?cursor=basura')).status, 400);
    const malo = Buffer.from(JSON.stringify(['no-es-fecha', 'no-es-uuid'])).toString('base64url');
    assert.equal((await c.get(`/conciliaciones?cursor=${malo}`)).status, 400);
    // Usuarios también pagina.
    const u = await cliente(base, t.adminA).get('/empresa/usuarios?limite=1');
    assert.equal((await u.json()).length, 1);
    assert.ok(u.headers.get('x-cursor-siguiente'));
  });

  test('límite de velocidad en /auth/ingreso', async () => {
    const srv = await levantar({ pool, jwtSecreto: SECRETO, limiteIngreso: { maximo: 3, ventanaMs: 60_000 } });
    try {
      const estados: number[] = [];
      for (let i = 0; i < 5; i++) {
        estados.push((await cliente(srv.base).post('/auth/ingreso', { correo: 'admin.a@ejemplo.test', contrasena: 'equivocada' })).status);
      }
      assert.deepEqual(estados, [401, 401, 401, 429, 429]);
      const r = await cliente(srv.base).post('/auth/ingreso', { correo: 'admin.a@ejemplo.test', contrasena: 'clave-sintetica-123' });
      assert.equal(r.status, 429); // ni con la clave correcta mientras dure la ventana
      assert.ok(Number(r.headers.get('retry-after')) > 0);
    } finally { await cerrar(srv.servidor); }
  });

  test('/metricas por empresa y CORS con Authorization', async () => {
    const m = await (await cliente(base, t.adminA).get('/metricas')).json();
    assert.equal(m.empresa.id, ids.empresaA);
    assert.ok(m.empresa.conciliaciones >= 1);
    assert.deepEqual(Object.keys(m.empresa.trabajos.porEstado).sort(), ['fallido', 'hecho', 'pendiente', 'procesando']);
    assert.ok(m.proceso.peticiones.porRuta['POST /conciliaciones'].conteo >= 1);
    // Las rutas se agrupan por nombre, no por id.
    assert.ok(Object.keys(m.proceso.peticiones.porRuta).every((k) => !/[0-9a-f]{8}-/.test(k)));
    const pre = await fetch(`${base}/conciliaciones`, { method: 'OPTIONS' });
    assert.match(pre.headers.get('access-control-allow-headers') ?? '', /Authorization/);
    assert.match(pre.headers.get('access-control-expose-headers') ?? '', /X-Cursor-Siguiente/);
  });
});
