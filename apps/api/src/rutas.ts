// Enrutador de la API sobre node:http. Cada ruta valida su entrada y responde JSON en español.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { RegistroPlantillas, procesarArchivos, conciliar, validarPerfil, PERFIL_POR_DEFECTO } from '@conciliador/core';
import type { ArchivoEntrada, Perfil, ResultadoIngesta } from '@conciliador/core';
import { PLANTILLAS } from '@conciliador/plantillas';
import { baseDisponible } from './bd.ts';
import { ErrorHttp, LIMITE_CUERPO, leerJson, responder, responderError } from './http.ts';
import { decidir, guardarConciliacion, listarConciliaciones, obtenerConciliacion } from './repositorio.ts';
import type { Accion } from './repositorio.ts';

export interface OpcionesRutas {
  pool: Pool | null;          // null = modo memoria
  corsOrigen?: string;        // '*' o lista separada por comas
  limiteCuerpo?: number;
}

type Manejador = (req: IncomingMessage, res: ServerResponse, parametros: string[]) => Promise<void>;
interface Ruta { metodo: 'GET' | 'POST'; patron: RegExp; manejar: Manejador }

const UUID = '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})';

// El registro se arma una sola vez: registrar valida cada plantilla y falla al arrancar si alguna está mal.
let registro: RegistroPlantillas | undefined;
export function registroPlantillas(): RegistroPlantillas {
  if (!registro) {
    const nuevo = new RegistroPlantillas();
    for (const plantilla of PLANTILLAS) nuevo.registrar(plantilla);
    registro = nuevo;
  }
  return registro;
}

export function crearManejador(opciones: OpcionesRutas) {
  const { pool } = opciones;
  const limite = opciones.limiteCuerpo ?? LIMITE_CUERPO;
  const origenes = (opciones.corsOrigen ?? '*').split(',').map((o) => o.trim()).filter(Boolean);

  const exigirBase = (): Pool => {
    if (!pool) throw new ErrorHttp(503, 'Esta operación necesita base de datos y la API corre en modo memoria (sin DATABASE_URL).');
    return pool;
  };

  const rutas: Ruta[] = [
    {
      metodo: 'GET', patron: /^\/salud$/,
      manejar: async (_req, res) => responder(res, 200, { ok: true, baseDeDatos: await baseDisponible(pool) }),
    },
    {
      metodo: 'GET', patron: /^\/plantillas$/,
      manejar: async (_req, res) => responder(res, 200, registroPlantillas().listar()),
    },
    {
      metodo: 'POST', patron: /^\/conciliaciones$/,
      manejar: async (req, res) => {
        const entrada = validarCuerpoConciliacion(await leerJson(req, limite));
        const preparado = prepararConciliacion(entrada);
        const resultado = conciliar(preparado.banco.movimientos, preparado.ventas.movimientos, preparado.perfil);
        const ingesta = [preparado.banco, preparado.ventas].map((r) => ({ nombre: r.nombre, plantillaId: r.plantillaId, errores: r.errores }));
        if (!pool) {
          responder(res, 200, { id: null, guardada: false, resultado, ingesta });
          return;
        }
        const id = await guardarConciliacion(pool, {
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
      metodo: 'GET', patron: /^\/conciliaciones$/,
      manejar: async (req, res) => {
        const base = exigirBase();
        const url = new URL(req.url ?? '/', 'http://local');
        const texto = url.searchParams.get('limite');
        const limiteFilas = texto === null ? 50 : Number(texto);
        if (!Number.isInteger(limiteFilas) || limiteFilas < 1 || limiteFilas > 200) {
          throw new ErrorHttp(400, 'El parámetro "limite" debe ser un entero entre 1 y 200.');
        }
        responder(res, 200, await listarConciliaciones(base, limiteFilas));
      },
    },
    {
      metodo: 'GET', patron: new RegExp(`^/conciliaciones/${UUID}$`),
      manejar: async (_req, res, [id]) => {
        const conciliacion = await obtenerConciliacion(exigirBase(), id.toLowerCase());
        if (!conciliacion) throw new ErrorHttp(404, 'La conciliación no existe.');
        responder(res, 200, conciliacion);
      },
    },
    {
      metodo: 'POST', patron: new RegExp(`^/conciliaciones/${UUID}/coincidencias/([^/]{1,100})/(confirmar|rechazar)$`),
      manejar: async (req, res, [id, cid, accion]) => {
        const base = exigirBase();
        req.resume(); // no se espera cuerpo; se drena por si el cliente manda uno
        let coincidenciaId: string;
        try { coincidenciaId = decodeURIComponent(cid); } catch { throw new ErrorHttp(400, 'Id de coincidencia mal codificado.'); }
        responder(res, 200, await decidir(base, id.toLowerCase(), coincidenciaId, accion as Accion));
      },
    },
  ];

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    aplicarCors(req, res, origenes);
    try {
      if (req.method === 'OPTIONS') { req.resume(); responder(res, 204, null); return; }
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
      await elegida.r.manejar(req, res, (elegida.m as RegExpExecArray).slice(1));
    } catch (error) {
      if (error instanceof ErrorHttp) {
        responderError(res, error);
      } else {
        // No se filtran detalles internos (SQL, rutas) al cliente; quedan en el log.
        console.error('Error no controlado:', error);
        responderError(res, new ErrorHttp(500, 'Error interno del servidor.'));
      }
    }
  };
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
}

// ---------- Validación de entrada ----------

interface CuerpoConciliacion { banco: ArchivoEntrada; ventas: ArchivoEntrada; perfil: Perfil }

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function validarCuerpoConciliacion(cuerpo: unknown): CuerpoConciliacion {
  if (!esObjeto(cuerpo)) throw new ErrorHttp(400, 'El cuerpo debe ser un objeto con "banco" y "ventas".');
  const errores: string[] = [];
  const banco = validarArchivo(cuerpo.banco, 'banco', errores);
  const ventas = validarArchivo(cuerpo.ventas, 'ventas', errores);
  let perfil: Perfil = PERFIL_POR_DEFECTO;
  if (cuerpo.perfil !== undefined) {
    const revision = validarPerfil(cuerpo.perfil);
    if (revision.ok) perfil = revision.perfil;
    else errores.push(...revision.errores.map((e) => `perfil: ${e}`));
  }
  if (errores.length > 0 || !banco || !ventas) throw new ErrorHttp(400, 'La solicitud tiene datos inválidos.', errores);
  return { banco, ventas, perfil };
}

function validarArchivo(valor: unknown, campo: string, errores: string[]): ArchivoEntrada | null {
  if (!esObjeto(valor)) { errores.push(`"${campo}" es obligatorio y debe ser un objeto { nombre, texto, plantillaId? }.`); return null; }
  const inicial = errores.length;
  if (typeof valor.nombre !== 'string' || valor.nombre.trim() === '' || valor.nombre.length > 255) {
    errores.push(`"${campo}.nombre" debe ser un texto de 1 a 255 caracteres.`);
  }
  if (typeof valor.texto !== 'string' || valor.texto.trim() === '') errores.push(`"${campo}.texto" debe ser un texto no vacío.`);
  if (valor.plantillaId !== undefined) {
    if (typeof valor.plantillaId !== 'string') errores.push(`"${campo}.plantillaId" debe ser texto.`);
    else {
      const plantilla = registroPlantillas().obtener(valor.plantillaId);
      if (!plantilla) errores.push(`"${campo}.plantillaId": la plantilla "${valor.plantillaId}" no existe.`);
      else if (plantilla.lado !== campo) errores.push(`"${campo}.plantillaId": la plantilla "${plantilla.id}" es de lado ${plantilla.lado}.`);
    }
  }
  if (errores.length > inicial) return null;
  return {
    nombre: (valor.nombre as string).trim(),
    texto: valor.texto as string,
    ...(valor.plantillaId !== undefined ? { plantillaId: valor.plantillaId as string } : {}),
  };
}

// Ingesta de ambos archivos (Cola dentro de procesarArchivos) y chequeos de que cada uno sirve para su lado.
function prepararConciliacion(entrada: CuerpoConciliacion): { banco: ResultadoIngesta; ventas: ResultadoIngesta; perfil: Perfil } {
  const reg = registroPlantillas();
  const [banco, ventas] = procesarArchivos([entrada.banco, entrada.ventas], reg);
  const problemas: { archivo: string; mensaje: string; errores?: { linea: number; mensaje: string }[] }[] = [];
  for (const [resultado, lado] of [[banco, 'banco'], [ventas, 'ventas']] as const) {
    if (resultado.plantillaId === null) {
      problemas.push({ archivo: lado, mensaje: `No se reconoció el formato del archivo "${resultado.nombre}". Indique plantillaId.`, errores: resultado.errores });
      continue;
    }
    const plantilla = reg.obtener(resultado.plantillaId);
    if (plantilla && plantilla.lado !== lado) {
      problemas.push({ archivo: lado, mensaje: `El archivo "${resultado.nombre}" parece de ${plantilla.lado} (plantilla ${plantilla.id}), no de ${lado}.` });
    } else if (resultado.movimientos.length === 0) {
      problemas.push({ archivo: lado, mensaje: `El archivo "${resultado.nombre}" no produjo movimientos.`, errores: resultado.errores });
    }
  }
  if (problemas.length > 0) throw new ErrorHttp(422, 'No se pudieron leer los archivos.', problemas);
  return { banco, ventas, perfil: entrada.perfil };
}
