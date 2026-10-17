// Enrutador de la API sobre node:http. Cada ruta declara el rol mínimo; sin token se opera
// en la empresa pública 'demo' (así las rutas del MVP siguen igual). Responde JSON en español.
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import type { Pool } from 'pg';
import { ErrorRegexCostosa, conciliar } from '@conciliador/core';
import type { Perfil } from '@conciliador/core';
import { CONTEXTO_DEMO, LimitadorVelocidad, autenticar, esRol, exigirRol, ipDe } from './auth.ts';
import type { Contexto, Rol } from './auth.ts';
import { baseDisponible } from './bd.ts';
import { prepararConciliacion, registroDeEmpresa, registroPlantillas, validarCuerpoConciliacion } from './conciliacion.ts';
import { hashDeRelleno, verificarContrasena } from './contrasenas.ts';
import {
  buscarParaIngreso, crearUsuario, guardarPerfil, guardarPlantilla, listarUsuarios, listarVersiones, listarVigentes,
  obtenerPerfil, registrarEmpresa,
} from './empresas.ts';
import { ErrorHttp, LIMITE_CUERPO, leerJson, responder, responderError } from './http.ts';
import { firmarJwt } from './jwt.ts';
import { Metricas } from './metricas.ts';
import { leerPaginacion } from './paginacion.ts';
import type { Pagina } from './paginacion.ts';
import { registrar } from './registros.ts';
import { decidir, guardarConciliacion, paginarConciliaciones, obtenerConciliacion } from './repositorio.ts';
import type { Accion } from './repositorio.ts';
import { encolarTrabajo, metricasTrabajos, obtenerTrabajo } from './trabajos.ts';

// Se reexportan para no romper a quien los importaba de aquí (MVP).
export { registroPlantillas, validarCuerpoConciliacion };

export interface OpcionesRutas {
  pool: Pool | null;          // null = modo memoria
  corsOrigen?: string;        // '*' o lista separada por comas
  limiteCuerpo?: number;
  jwtSecreto?: string;        // por defecto JWT_SECRETO
  jwtDuracionSegundos?: number; // por defecto JWT_DURACION_S u 8 horas
  confiarProxy?: boolean;     // tomar la IP de X-Forwarded-For (Render); por defecto CONFIAR_PROXY=1
  limiteIngreso?: { maximo: number; ventanaMs: number }; // intentos por IP en /auth/ingreso y /auth/registro
  maxIntentosTrabajo?: number;
  metricas?: Metricas;
}

type Manejador = (req: IncomingMessage, res: ServerResponse, parametros: string[], ctx: Contexto) => Promise<void>;
interface Ruta {
  metodo: 'GET' | 'POST'; patron: RegExp; nombre: string; manejar: Manejador;
  publica?: boolean;          // no mira el token (salud, ingreso, registro)
  rol?: Rol;                  // rol mínimo; el visitante de la demo cuenta como analista
  requiereToken?: boolean;    // rutas de administración de la empresa: sin demo
}

const UUID = '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})';
const ID = '([^/]{1,300})';
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let secretoEfimero: string | undefined;
function secretoJwt(opciones: OpcionesRutas): string {
  const secreto = opciones.jwtSecreto ?? process.env.JWT_SECRETO;
  if (secreto) return secreto;
  // Sin secreto configurado se usa uno aleatorio por proceso: funciona, pero los tokens mueren al reiniciar.
  if (!secretoEfimero) {
    secretoEfimero = randomBytes(32).toString('base64url');
    if (opciones.pool) registrar('aviso', 'jwt_sin_secreto', { mensaje: 'JWT_SECRETO no está definido; se usa uno temporal.' });
  }
  return secretoEfimero;
}

export function crearManejador(opciones: OpcionesRutas) {
  const { pool } = opciones;
  const limite = opciones.limiteCuerpo ?? LIMITE_CUERPO;
  const origenes = (opciones.corsOrigen ?? '*').split(',').map((o) => o.trim()).filter(Boolean);
  const secreto = secretoJwt(opciones);
  const duracionJwt = opciones.jwtDuracionSegundos ?? Number(process.env.JWT_DURACION_S ?? 8 * 3600);
  const confiarProxy = opciones.confiarProxy ?? process.env.CONFIAR_PROXY === '1';
  const { maximo, ventanaMs } = opciones.limiteIngreso ?? { maximo: 10, ventanaMs: 60_000 };
  const limitador = new LimitadorVelocidad(maximo, ventanaMs);
  const maxIntentos = opciones.maxIntentosTrabajo ?? Number(process.env.TRABAJO_MAX_INTENTOS ?? 3);
  const metricas = opciones.metricas ?? new Metricas();

  const exigirBase = (): Pool => {
    if (!pool) throw new ErrorHttp(503, 'Esta operación necesita base de datos y la API corre en modo memoria (sin DATABASE_URL).');
    return pool;
  };
  const limitar = (req: IncomingMessage, res: ServerResponse, ruta: string) => {
    const espera = limitador.consumir(`${ruta}|${ipDe(req, confiarProxy)}`);
    if (espera !== null) {
      req.resume();
      res.setHeader('Retry-After', String(espera));
      throw new ErrorHttp(429, `Demasiados intentos. Espere ${espera} s e intente de nuevo.`);
    }
  };
  const decodificar = (texto: string) => {
    try { return decodeURIComponent(texto); } catch { throw new ErrorHttp(400, 'Id mal codificado en la ruta.'); }
  };
  const actor = (ctx: Contexto) => ({ empresaId: ctx.empresaId, usuarioId: ctx.usuarioId });

  const rutas: Ruta[] = [
    {
      metodo: 'GET', patron: /^\/salud$/, nombre: 'GET /salud', publica: true,
      manejar: async (_req, res) => responder(res, 200, { ok: true, baseDeDatos: await baseDisponible(pool) }),
    },
    {
      // Con token incluye las plantillas propias de la empresa (versión vigente).
      metodo: 'GET', patron: /^\/plantillas$/, nombre: 'GET /plantillas', rol: 'lector',
      manejar: async (_req, res, _p, ctx) => responder(res, 200, (await registroDeEmpresa(pool, ctx.empresaId)).listar()),
    },
    {
      metodo: 'GET', patron: /^\/metricas$/, nombre: 'GET /metricas', rol: 'lector',
      manejar: async (_req, res, _p, ctx) => {
        let empresa = null;
        if (pool) {
          const [conteo, trabajos] = await Promise.all([
            pool.query('SELECT count(*)::int AS n FROM conciliaciones WHERE empresa_id = $1', [ctx.empresaId]),
            metricasTrabajos(pool, ctx.empresaId),
          ]);
          empresa = { id: ctx.empresaId, conciliaciones: conteo.rows[0].n as number, trabajos };
        }
        responder(res, 200, { proceso: metricas.instantanea(), empresa });
      },
    },

    // ---------- Autenticación ----------
    {
      metodo: 'POST', patron: /^\/auth\/registro$/, nombre: 'POST /auth/registro', publica: true,
      manejar: async (req, res) => {
        limitar(req, res, 'registro');
        const base = exigirBase();
        const datos = validarRegistro(await leerJson(req, limite));
        const { empresa, usuario } = await registrarEmpresa(base, datos);
        registrar('info', 'empresa_registrada', { empresa: empresa.id, usuario: usuario.id });
        responder(res, 201, { token: firmarJwt({ sub: usuario.id, emp: empresa.id, rol: usuario.rol }, secreto, duracionJwt), usuario, empresa });
      },
    },
    {
      metodo: 'POST', patron: /^\/auth\/ingreso$/, nombre: 'POST /auth/ingreso', publica: true,
      manejar: async (req, res) => {
        limitar(req, res, 'ingreso');
        const base = exigirBase();
        const cuerpo = await leerJson(req, 16 * 1024);
        if (!esObjeto(cuerpo) || typeof cuerpo.correo !== 'string' || typeof cuerpo.contrasena !== 'string'
          || cuerpo.correo.length > 254 || cuerpo.contrasena.length > 200) {
          throw new ErrorHttp(400, 'Envíe "correo" y "contrasena".');
        }
        const encontrado = await buscarParaIngreso(base, cuerpo.correo.trim());
        // Siempre se corre scrypt (con un hash de relleno si no hay usuario): el tiempo no delata correos.
        const valida = await verificarContrasena(cuerpo.contrasena, encontrado?.hash ?? await hashDeRelleno());
        if (!encontrado || !valida || !encontrado.usuario.activo) {
          registrar('aviso', 'ingreso_fallido', { ip: ipDe(req, confiarProxy) });
          throw new ErrorHttp(401, 'Correo o contraseña incorrectos.');
        }
        const { usuario } = encontrado;
        const token = firmarJwt({ sub: usuario.id, emp: usuario.empresaId, rol: usuario.rol }, secreto, duracionJwt);
        responder(res, 200, { token, usuario, expira: new Date(Date.now() + duracionJwt * 1000).toISOString() });
      },
    },

    // ---------- Administración de la empresa ----------
    {
      metodo: 'GET', patron: /^\/empresa\/usuarios$/, nombre: 'GET /empresa/usuarios', rol: 'admin', requiereToken: true,
      manejar: async (req, res, _p, ctx) => responderPagina(res, await listarUsuarios(exigirBase(), ctx.empresaId, leerPaginacion(urlDe(req), 2))),
    },
    {
      metodo: 'POST', patron: /^\/empresa\/usuarios$/, nombre: 'POST /empresa/usuarios', rol: 'admin', requiereToken: true,
      manejar: async (req, res, _p, ctx) => {
        const base = exigirBase();
        const datos = validarNuevoUsuario(await leerJson(req, 16 * 1024));
        const usuario = await crearUsuario(base, ctx.empresaId, datos);
        registrar('info', 'usuario_creado', { empresa: ctx.empresaId, usuario: usuario.id, rol: usuario.rol, por: ctx.usuarioId });
        responder(res, 201, usuario);
      },
    },
    ...rutasVersionadas('plantillas'),
    ...rutasVersionadas('perfiles'),

    // ---------- Conciliaciones (MVP) y cola ----------
    {
      metodo: 'POST', patron: /^\/conciliaciones$/, nombre: 'POST /conciliaciones', rol: 'analista',
      manejar: async (req, res, _p, ctx) => {
        const asincrono = ['1', 'true', 'si'].includes(urlDe(req).searchParams.get('asincrono') ?? '');
        if (asincrono) exigirBase(); // antes de leer el cuerpo: sin base no hay cola
        const registro = await registroDeEmpresa(pool, ctx.empresaId);
        const entrada = validarCuerpoConciliacion(await leerJson(req, limite), registro);
        let perfil: Perfil = entrada.perfil;
        let perfilRef: { id: string; version: number } | undefined;
        if (entrada.perfilId !== undefined) {
          const guardado = await obtenerPerfil(exigirBase(), ctx.empresaId, entrada.perfilId, entrada.perfilVersion);
          if (!guardado) {
            throw new ErrorHttp(400, 'La solicitud tiene datos inválidos.',
              [`"perfilId": su empresa no tiene el perfil "${entrada.perfilId}"${entrada.perfilVersion ? ` en la versión ${entrada.perfilVersion}` : ''}.`]);
          }
          perfil = guardado.perfil;
          perfilRef = { id: entrada.perfilId, version: guardado.version };
        }
        // Una regex de usuario puede ser lenta aunque pase la revisión del núcleo (ReDoS):
        // el visitante anónimo de la demo no puede mandarlas; con cuenta sí, acotadas en tiempo.
        if (ctx.anonimo && usaRegex(perfil)) {
          throw new ErrorHttp(403, 'Las reglas con op "regex" necesitan iniciar sesión (Authorization: Bearer <token>).');
        }

        if (asincrono) {
          // Solo se encola: leer, cruzar y guardar lo hace el worker sin bloquear la API.
          const trabajoId = await encolarTrabajo(exigirBase(), {
            empresaId: ctx.empresaId, usuarioId: ctx.usuarioId, maxIntentos,
            carga: { banco: entrada.banco, ventas: entrada.ventas, perfil, ...(perfilRef ? { perfilRef } : {}) },
          });
          registrar('info', 'trabajo_encolado', { trabajo: trabajoId, empresa: ctx.empresaId });
          responder(res, 202, { trabajoId, estado: 'pendiente' }, { Location: `/trabajos/${trabajoId}` });
          return;
        }

        const preparado = prepararConciliacion({ ...entrada, perfil }, registro);
        let resultado: ReturnType<typeof conciliar>;
        try {
          resultado = conciliar(preparado.banco.movimientos, preparado.ventas.movimientos, preparado.perfil);
        } catch (e) {
          // El presupuesto de tiempo de las regex se agotó: es culpa de los datos, no un 500.
          if (e instanceof ErrorRegexCostosa) throw new ErrorHttp(422, e.message);
          throw e;
        }
        const ingesta = [preparado.banco, preparado.ventas].map((r) => ({ nombre: r.nombre, plantillaId: r.plantillaId, errores: r.errores }));
        if (!pool) {
          responder(res, 200, { id: null, guardada: false, resultado, ingesta });
          return;
        }
        const id = await guardarConciliacion(pool, {
          empresaId: ctx.empresaId, usuarioId: ctx.usuarioId, perfilRef,
          archivoBanco: preparado.banco.nombre, archivoVentas: preparado.ventas.nombre,
          plantillaBanco: preparado.banco.plantillaId as string, plantillaVentas: preparado.ventas.plantillaId as string,
          perfil: preparado.perfil,
          banco: preparado.banco.movimientos, ventas: preparado.ventas.movimientos,
          resultado,
        });
        responder(res, 201, { id, guardada: true, resultado, ingesta }, { Location: `/conciliaciones/${id}` });
      },
    },
    {
      // Sigue devolviendo un arreglo (MVP); la página siguiente se pide con la cabecera X-Cursor-Siguiente.
      metodo: 'GET', patron: /^\/conciliaciones$/, nombre: 'GET /conciliaciones', rol: 'lector',
      manejar: async (req, res, _p, ctx) => {
        const base = exigirBase();
        responderPagina(res, await paginarConciliaciones(base, ctx.empresaId, leerPaginacion(urlDe(req), 2)));
      },
    },
    {
      metodo: 'GET', patron: new RegExp(`^/conciliaciones/${UUID}$`), nombre: 'GET /conciliaciones/:id', rol: 'lector',
      manejar: async (_req, res, [id], ctx) => {
        const conciliacion = await obtenerConciliacion(exigirBase(), id.toLowerCase(), ctx.empresaId);
        if (!conciliacion) throw new ErrorHttp(404, 'La conciliación no existe.');
        responder(res, 200, conciliacion);
      },
    },
    {
      metodo: 'POST', patron: new RegExp(`^/conciliaciones/${UUID}/coincidencias/([^/]{1,100})/(confirmar|rechazar)$`),
      nombre: 'POST /conciliaciones/:id/coincidencias/:cid/:accion', rol: 'analista',
      manejar: async (req, res, [id, cid, accion], ctx) => {
        const base = exigirBase();
        req.resume(); // no se espera cuerpo; se drena por si el cliente manda uno
        let coincidenciaId: string;
        try { coincidenciaId = decodeURIComponent(cid); } catch { throw new ErrorHttp(400, 'Id de coincidencia mal codificado.'); }
        responder(res, 200, await decidir(base, id.toLowerCase(), coincidenciaId, accion as Accion, actor(ctx)));
      },
    },
    {
      metodo: 'GET', patron: new RegExp(`^/trabajos/${UUID}$`), nombre: 'GET /trabajos/:id', rol: 'lector',
      manejar: async (_req, res, [id], ctx) => {
        const trabajo = await obtenerTrabajo(exigirBase(), ctx.empresaId, id.toLowerCase());
        if (!trabajo) throw new ErrorHttp(404, 'El trabajo no existe.');
        responder(res, 200, trabajo);
      },
    },
  ];

  // GET/POST /empresa/<tipo> y GET /empresa/<tipo>/:id/versiones.
  function rutasVersionadas(tipo: 'plantillas' | 'perfiles'): Ruta[] {
    const singular = tipo === 'plantillas' ? 'La plantilla' : 'El perfil';
    return [
      {
        metodo: 'GET', patron: new RegExp(`^/empresa/${tipo}$`), nombre: `GET /empresa/${tipo}`, rol: 'lector', requiereToken: true,
        manejar: async (req, res, _p, ctx) => responderPagina(res, await listarVigentes(exigirBase(), tipo, ctx.empresaId, leerPaginacion(urlDe(req), 1))),
      },
      {
        metodo: 'POST', patron: new RegExp(`^/empresa/${tipo}$`), nombre: `POST /empresa/${tipo}`, rol: 'analista', requiereToken: true,
        manejar: async (req, res, _p, ctx) => {
          const base = exigirBase();
          const cuerpo = await leerJson(req, 256 * 1024);
          const guardada = tipo === 'plantillas'
            ? await guardarPlantilla(base, ctx.empresaId, ctx.usuarioId, cuerpo)
            : await guardarPerfil(base, ctx.empresaId, ctx.usuarioId, cuerpo);
          registrar('info', `${tipo}_version`, { empresa: ctx.empresaId, id: guardada.id, version: guardada.version, por: ctx.usuarioId });
          responder(res, 201, guardada, { Location: `/empresa/${tipo}/${encodeURIComponent(guardada.id)}/versiones` });
        },
      },
      {
        metodo: 'GET', patron: new RegExp(`^/empresa/${tipo}/${ID}/versiones$`), nombre: `GET /empresa/${tipo}/:id/versiones`,
        rol: 'lector', requiereToken: true,
        manejar: async (req, res, [id], ctx) => {
          const pagina = await listarVersiones(exigirBase(), tipo, ctx.empresaId, decodificar(id), leerPaginacion(urlDe(req), 1));
          if (!pagina) throw new ErrorHttp(404, `${singular} no existe en su empresa.`);
          responderPagina(res, pagina);
        },
      },
    ];
  }

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const t0 = performance.now();
    aplicarCors(req, res, origenes);
    let nombreRuta = 'otra';
    let ctx: Contexto | null = null;
    try {
      if (req.method === 'OPTIONS') { req.resume(); nombreRuta = 'OPTIONS'; responder(res, 204, null); return; }
      const ruta = (req.url ?? '/').split('?')[0].replace(/\/+$/, '') || '/';
      const candidatas = rutas.map((r) => ({ r, m: r.patron.exec(ruta) })).filter((x) => x.m);
      if (candidatas.length === 0) { req.resume(); throw new ErrorHttp(404, `No existe la ruta ${ruta}.`); }
      const elegida = candidatas.find((x) => x.r.metodo === req.method);
      if (!elegida) {
        req.resume();
        const permitidos = [...new Set(candidatas.map((x) => x.r.metodo))].join(', ');
        res.setHeader('Allow', `${permitidos}, OPTIONS`);
        throw new ErrorHttp(405, `Método ${req.method} no permitido en ${ruta}.`);
      }
      nombreRuta = elegida.r.nombre;
      ctx = elegida.r.publica ? CONTEXTO_DEMO : await autenticar(req, pool, secreto);
      if (elegida.r.rol) exigirRol(ctx, elegida.r.rol, elegida.r.requiereToken);
      await elegida.r.manejar(req, res, (elegida.m as RegExpExecArray).slice(1), ctx);
    } catch (error) {
      if (!req.complete) req.resume(); // se descarta el cuerpo no leído para poder responder
      if (error instanceof ErrorHttp) {
        if (error.estado === 401) res.setHeader('WWW-Authenticate', 'Bearer');
        responderError(res, error);
      } else {
        // No se filtran detalles internos (SQL, rutas) al cliente; quedan en el registro.
        registrar('error', 'error_no_controlado', { ruta: nombreRuta, error });
        responderError(res, new ErrorHttp(500, 'Error interno del servidor.'));
      }
    } finally {
      const ms = performance.now() - t0;
      metricas.registrarPeticion(nombreRuta, res.statusCode, ms);
      registrar('info', 'peticion', {
        metodo: req.method, ruta: nombreRuta, estado: res.statusCode, ms: Math.round(ms * 10) / 10,
        ...(ctx && !ctx.anonimo ? { empresa: ctx.empresaId, usuario: ctx.usuarioId } : {}),
      });
    }
  };
}

const urlDe = (req: IncomingMessage) => new URL(req.url ?? '/', 'http://local');

// Los listados siguen siendo arreglos (compatibles con el MVP); el cursor va en una cabecera.
function responderPagina<T>(res: ServerResponse, pagina: Pagina<T>): void {
  responder(res, 200, pagina.elementos, pagina.siguiente ? { 'X-Cursor-Siguiente': pagina.siguiente } : {});
}

function aplicarCors(req: IncomingMessage, res: ServerResponse, origenes: string[]): void {
  const origen = req.headers.origin;
  if (origenes.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origen && origenes.includes(origen)) {
    res.setHeader('Access-Control-Allow-Origin', origen);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'Location, Retry-After, X-Cursor-Siguiente');
  res.setHeader('Access-Control-Max-Age', '600');
}

// ---------- Validación de entrada ----------

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function texto(valor: unknown, campo: string, errores: string[], min: number, max: number): string {
  if (typeof valor !== 'string' || valor.trim().length < min || valor.length > max) {
    errores.push(`"${campo}" debe ser un texto de ${min} a ${max} caracteres.`);
    return '';
  }
  return valor.trim();
}

export function usaRegex(perfil: Perfil): boolean {
  return (perfil.reglas ?? []).some((r) => [...(r.si.todas ?? []), ...(r.si.alguna ?? [])].some((c) => 'op' in c && c.op === 'regex'));
}

function validarCredenciales(cuerpo: Record<string, unknown>, errores: string[]) {
  const nombre = texto(cuerpo.nombre, 'nombre', errores, 1, 200);
  const correo = texto(cuerpo.correo, 'correo', errores, 3, 254);
  if (correo && !CORREO.test(correo)) errores.push('"correo" no parece un correo válido.');
  // Sin trim: los espacios de la contraseña cuentan.
  const contrasena = typeof cuerpo.contrasena === 'string' ? cuerpo.contrasena : '';
  if (contrasena.length < 8 || contrasena.length > 200) errores.push('"contrasena" debe tener entre 8 y 200 caracteres.');
  return { nombre, correo, contrasena };
}

function validarRegistro(cuerpo: unknown) {
  if (!esObjeto(cuerpo)) throw new ErrorHttp(400, 'El cuerpo debe ser un objeto { empresa, nombre, correo, contrasena }.');
  const errores: string[] = [];
  const empresa = texto(cuerpo.empresa, 'empresa', errores, 1, 200);
  const credenciales = validarCredenciales(cuerpo, errores);
  if (errores.length > 0) throw new ErrorHttp(400, 'La solicitud tiene datos inválidos.', errores);
  return { empresa, ...credenciales };
}

function validarNuevoUsuario(cuerpo: unknown) {
  if (!esObjeto(cuerpo)) throw new ErrorHttp(400, 'El cuerpo debe ser un objeto { nombre, correo, contrasena, rol }.');
  const errores: string[] = [];
  const credenciales = validarCredenciales(cuerpo, errores);
  if (!esRol(cuerpo.rol)) errores.push('"rol" debe ser "admin", "analista" o "lector".');
  if (errores.length > 0) throw new ErrorHttp(400, 'La solicitud tiene datos inválidos.', errores);
  return { ...credenciales, rol: cuerpo.rol as Rol };
}
