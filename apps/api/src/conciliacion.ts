// Validar y preparar una conciliación. Lo comparten la ruta síncrona y el worker de la cola.
import type { Pool } from 'pg';
import { RegistroPlantillas, procesarArchivos, validarPerfil, PERFIL_POR_DEFECTO } from '@conciliador/core';
import type { ArchivoEntrada, Perfil, Plantilla, ResultadoIngesta } from '@conciliador/core';
import { PLANTILLAS } from '@conciliador/plantillas';
import { EMPRESA_DEMO_ID } from './auth.ts';
import { ErrorHttp } from './http.ts';

// El registro de las incluidas se arma una sola vez: falla al arrancar si alguna plantilla está mal.
let registro: RegistroPlantillas | undefined;
export function registroPlantillas(): RegistroPlantillas {
  if (!registro) {
    const nuevo = new RegistroPlantillas();
    for (const plantilla of PLANTILLAS) nuevo.registrar(plantilla);
    registro = nuevo;
  }
  return registro;
}

export const esPlantillaIncluida = (id: string) => PLANTILLAS.some((p) => p.id === id);

// Registro de una empresa = incluidas + versión vigente de sus plantillas propias.
// Se guarda en memoria y se rearma solo cuando cambia la "firma" (ids y versiones vigentes).
const cache = new Map<string, { firma: string; registro: RegistroPlantillas }>();
const MAX_CACHE = 500;

export async function registroDeEmpresa(pool: Pool | null, empresaId: string): Promise<RegistroPlantillas> {
  if (!pool || empresaId === EMPRESA_DEMO_ID) return registroPlantillas();
  const { rows } = await pool.query(
    `SELECT coalesce(string_agg(id || ':' || version_actual, ',' ORDER BY id), '') AS firma
     FROM plantillas_empresa WHERE empresa_id = $1`, [empresaId]);
  const firma = rows[0].firma as string;
  if (firma === '') return registroPlantillas();
  const guardado = cache.get(empresaId);
  if (guardado && guardado.firma === firma) return guardado.registro;

  const { rows: propias } = await pool.query(
    `SELECT v.contenido FROM plantillas_empresa p
     JOIN plantillas_versiones v ON v.empresa_id = p.empresa_id AND v.plantilla_id = p.id AND v.version = p.version_actual
     WHERE p.empresa_id = $1 ORDER BY p.id`, [empresaId]);
  const nuevo = new RegistroPlantillas();
  for (const p of PLANTILLAS) nuevo.registrar(p);
  for (const f of propias) nuevo.registrar(f.contenido as Plantilla);
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(empresaId, { firma, registro: nuevo });
  return nuevo;
}

// ---------- Validación de entrada ----------

export interface CuerpoConciliacion {
  banco: ArchivoEntrada; ventas: ArchivoEntrada; perfil: Perfil;
  perfilId?: string; perfilVersion?: number;   // perfil guardado de la empresa (se resuelve después)
}

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function validarCuerpoConciliacion(cuerpo: unknown, reg: RegistroPlantillas = registroPlantillas()): CuerpoConciliacion {
  if (!esObjeto(cuerpo)) throw new ErrorHttp(400, 'El cuerpo debe ser un objeto con "banco" y "ventas".');
  const errores: string[] = [];
  const banco = validarArchivo(cuerpo.banco, 'banco', errores, reg);
  const ventas = validarArchivo(cuerpo.ventas, 'ventas', errores, reg);
  let perfil: Perfil = PERFIL_POR_DEFECTO;
  if (cuerpo.perfil !== undefined) {
    const revision = validarPerfil(cuerpo.perfil);
    if (revision.ok) perfil = revision.perfil;
    else errores.push(...revision.errores.map((e) => `perfil: ${e}`));
  }
  const extra: Pick<CuerpoConciliacion, 'perfilId' | 'perfilVersion'> = {};
  if (cuerpo.perfilId !== undefined) {
    if (typeof cuerpo.perfilId !== 'string' || cuerpo.perfilId.trim() === '' || cuerpo.perfilId.length > 100) {
      errores.push('"perfilId" debe ser un texto de 1 a 100 caracteres.');
    } else if (cuerpo.perfil !== undefined) {
      errores.push('Envíe "perfil" o "perfilId", no ambos.');
    } else extra.perfilId = cuerpo.perfilId;
  }
  if (cuerpo.perfilVersion !== undefined) {
    if (!Number.isInteger(cuerpo.perfilVersion) || (cuerpo.perfilVersion as number) < 1) errores.push('"perfilVersion" debe ser un entero mayor o igual a 1.');
    else if (cuerpo.perfilId === undefined) errores.push('"perfilVersion" solo tiene sentido con "perfilId".');
    else extra.perfilVersion = cuerpo.perfilVersion as number;
  }
  if (errores.length > 0 || !banco || !ventas) throw new ErrorHttp(400, 'La solicitud tiene datos inválidos.', errores);
  return { banco, ventas, perfil, ...extra };
}

function validarArchivo(valor: unknown, campo: string, errores: string[], reg: RegistroPlantillas): ArchivoEntrada | null {
  if (!esObjeto(valor)) { errores.push(`"${campo}" es obligatorio y debe ser un objeto { nombre, texto, plantillaId? }.`); return null; }
  const inicial = errores.length;
  if (typeof valor.nombre !== 'string' || valor.nombre.trim() === '' || valor.nombre.length > 255) {
    errores.push(`"${campo}.nombre" debe ser un texto de 1 a 255 caracteres.`);
  }
  if (typeof valor.texto !== 'string' || valor.texto.trim() === '') errores.push(`"${campo}.texto" debe ser un texto no vacío.`);
  if (valor.plantillaId !== undefined) {
    if (typeof valor.plantillaId !== 'string') errores.push(`"${campo}.plantillaId" debe ser texto.`);
    else {
      const plantilla = reg.obtener(valor.plantillaId);
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

export interface Preparado { banco: ResultadoIngesta; ventas: ResultadoIngesta; perfil: Perfil }

// Ingesta de ambos archivos (Cola dentro de procesarArchivos) y chequeos de que cada uno sirve para su lado.
export function prepararConciliacion(entrada: { banco: ArchivoEntrada; ventas: ArchivoEntrada; perfil: Perfil },
  reg: RegistroPlantillas = registroPlantillas()): Preparado {
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
