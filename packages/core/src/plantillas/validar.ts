// Validador a mano (sin librerías): las plantillas llegan como JSON de usuarios o del
// asistente del panel, así que cada error dice la ruta del campo para poder corregirlo.
import { tiposRegistrados } from './lectores.ts';
import { revisarRegex } from '../regexSegura.ts';
import { CAMPOS_DESTINO } from './tipos.ts';
import type { Plantilla, ResultadoValidacion } from './tipos.ts';

const CLAVES_PLANTILLA = new Set([
  'id', 'nombre', 'version', 'lado', 'descripcion', 'fuente', 'tipo', 'codificacion', 'separador',
  'separadorDecimal', 'formatoFecha', 'filasEncabezado', 'registroDetalle', 'omitirSi',
  'soloEntradas', 'detectar', 'columnas', 'hoja',
]);
const CLAVES_MAPEO = new Set(['de', 'inicio', 'longitud', 'unir', 'regex', 'decimalesImplicitos', 'signo', 'fijo', 'opcional']);
const CAMPOS = new Set<string>(CAMPOS_DESTINO);
const SEPARADORES = new Set([',', ';', '\t', '|']);

type Objeto = Record<string, unknown>;

const esObjeto = (x: unknown): x is Objeto => typeof x === 'object' && x !== null && !Array.isArray(x);
const esTexto = (x: unknown): x is string => typeof x === 'string' && x.trim() !== '';
const esEntero = (x: unknown, min: number): x is number => Number.isInteger(x) && (x as number) >= min;


export function validarPlantilla(p: unknown): ResultadoValidacion {
  const errores: string[] = [];
  const error = (ruta: string, mensaje: string) => errores.push(`${ruta}: ${mensaje}`);

  if (!esObjeto(p)) return { ok: false, errores: ['plantilla: debe ser un objeto JSON'] };

  // Claves desconocidas suelen ser errores de digitación ("separdor"): mejor avisar que ignorar.
  for (const k of Object.keys(p)) if (!CLAVES_PLANTILLA.has(k)) error(k, 'campo desconocido');

  if (p.id === undefined) error('id', 'falta');
  else if (!esTexto(p.id)) error('id', 'debe ser un texto no vacío');
  if (p.nombre === undefined) error('nombre', 'falta');
  else if (!esTexto(p.nombre)) error('nombre', 'debe ser un texto no vacío');
  if (p.version === undefined) error('version', 'falta');
  else if (!esEntero(p.version, 1)) error('version', 'debe ser un entero mayor o igual a 1');
  if (p.lado === undefined) error('lado', 'falta');
  else if (p.lado !== 'banco' && p.lado !== 'ventas') error('lado', 'debe ser "banco" o "ventas"');
  if (p.descripcion !== undefined && typeof p.descripcion !== 'string') error('descripcion', 'debe ser texto');
  if (p.fuente !== undefined && typeof p.fuente !== 'string') error('fuente', 'debe ser texto');

  // Además de los declarativos, vale cualquier tipo con lector registrado (mt940, camt053...).
  const tipos = tiposRegistrados();
  const tipo = p.tipo;
  if (tipo === undefined) error('tipo', 'falta');
  else if (typeof tipo !== 'string' || !tipos.includes(tipo)) error('tipo', `debe ser uno de: ${tipos.map((t) => `"${t}"`).join(', ')}`);
  // Los lectores propios entregan campos con nombre: se mapean como columnas de un delimitado.
  const conLector = typeof tipo === 'string' && tipo !== 'delimitado' && tipo !== 'anchoFijo' && tipos.includes(tipo);
  const modoMapeo = conLector ? 'delimitado' : tipo;
  if (p.hoja !== undefined && !esTexto(p.hoja)) error('hoja', 'debe ser un texto no vacío');

  if (p.codificacion !== undefined && p.codificacion !== 'utf-8' && p.codificacion !== 'latin1') {
    error('codificacion', 'debe ser "utf-8" o "latin1"');
  }
  if (p.separador !== undefined) {
    if (typeof p.separador !== 'string' || !SEPARADORES.has(p.separador)) error('separador', 'debe ser uno de , ; | o tabulador');
    if (tipo === 'anchoFijo') error('separador', 'no aplica a plantillas de ancho fijo');
    if (conLector) error('separador', `no aplica a plantillas de tipo "${tipo}"`);
  }
  if (p.separadorDecimal !== undefined && p.separadorDecimal !== ',' && p.separadorDecimal !== '.') {
    error('separadorDecimal', 'debe ser "," o "."');
  }

  if (p.formatoFecha === undefined) error('formatoFecha', 'falta');
  else if (typeof p.formatoFecha !== 'string') error('formatoFecha', 'debe ser texto');
  else if (!p.formatoFecha.includes('dd') || !p.formatoFecha.includes('MM') || !p.formatoFecha.includes('yy')) {
    error('formatoFecha', 'debe contener dd, MM y yyyy (o yy), ej. "dd/MM/yyyy"');
  }

  if (p.filasEncabezado !== undefined) {
    if (!esEntero(p.filasEncabezado, 0)) error('filasEncabezado', 'debe ser un entero mayor o igual a 0');
    if (tipo === 'anchoFijo') error('filasEncabezado', 'no aplica a plantillas de ancho fijo');
    if (conLector) error('filasEncabezado', `no aplica a plantillas de tipo "${tipo}"`);
  }

  if (p.registroDetalle !== undefined) {
    const r = p.registroDetalle;
    if (tipo !== undefined && tipo !== 'anchoFijo') error('registroDetalle', 'solo aplica a plantillas de ancho fijo');
    if (!esObjeto(r)) error('registroDetalle', 'debe ser un objeto { inicio, longitud, valor }');
    else {
      if (!esEntero(r.inicio, 1)) error('registroDetalle.inicio', r.inicio === undefined ? 'falta' : 'debe ser un entero mayor o igual a 1');
      if (!esEntero(r.longitud, 1)) error('registroDetalle.longitud', r.longitud === undefined ? 'falta' : 'debe ser un entero mayor o igual a 1');
      if (typeof r.valor !== 'string' || r.valor === '') error('registroDetalle.valor', r.valor === undefined ? 'falta' : 'debe ser un texto no vacío');
      else if (esEntero(r.longitud, 1) && r.valor.length !== r.longitud) error('registroDetalle.valor', `debe tener ${r.longitud} caracteres (la longitud)`);
    }
  }

  const columnas = esObjeto(p.columnas) ? p.columnas : undefined;

  if (p.omitirSi !== undefined) {
    if (!Array.isArray(p.omitirSi)) error('omitirSi', 'debe ser una lista de { campo, regex }');
    else p.omitirSi.forEach((o, i) => {
      const ruta = `omitirSi[${i}]`;
      if (!esObjeto(o)) { error(ruta, 'debe ser un objeto { campo, regex }'); return; }
      if (!esTexto(o.campo)) error(`${ruta}.campo`, o.campo === undefined ? 'falta' : 'debe ser un texto no vacío');
      // En ancho fijo no hay nombres de columna: el campo tiene que ser uno de los mapeados.
      else if (tipo === 'anchoFijo' && columnas && !(o.campo in columnas)) {
        error(`${ruta}.campo`, `en ancho fijo debe ser un campo de columnas ("${o.campo}" no está)`);
      }
      if (typeof o.regex !== 'string') error(`${ruta}.regex`, o.regex === undefined ? 'falta' : 'debe ser texto');
      else { const problema = revisarRegex(o.regex); if (problema) error(`${ruta}.regex`, `${problema}: ${o.regex.slice(0, 60)}`); }
    });
  }

  if (p.soloEntradas !== undefined && typeof p.soloEntradas !== 'boolean') error('soloEntradas', 'debe ser true o false');

  if (p.detectar !== undefined) {
    const d = p.detectar;
    if (!esObjeto(d)) error('detectar', 'debe ser un objeto { encabezados?, prefijoLinea? }');
    else {
      for (const k of Object.keys(d)) if (k !== 'encabezados' && k !== 'prefijoLinea') error(`detectar.${k}`, 'campo desconocido');
      if (d.encabezados !== undefined) {
        if (!Array.isArray(d.encabezados) || d.encabezados.length === 0) error('detectar.encabezados', 'debe ser una lista no vacía de textos');
        else d.encabezados.forEach((e, i) => { if (!esTexto(e)) error(`detectar.encabezados[${i}]`, 'debe ser un texto no vacío'); });
      }
      if (d.prefijoLinea !== undefined && (typeof d.prefijoLinea !== 'string' || d.prefijoLinea === '')) {
        error('detectar.prefijoLinea', 'debe ser un texto no vacío');
      }
    }
  }

  if (p.columnas === undefined) error('columnas', 'falta');
  else if (!columnas) error('columnas', 'debe ser un objeto { campo: mapeo }');
  else {
    for (const [campo, mapeo] of Object.entries(columnas)) {
      if (!CAMPOS.has(campo)) error(`columnas.${campo}`, `campo desconocido; válidos: ${CAMPOS_DESTINO.join(', ')}`);
      else validarMapeo(`columnas.${campo}`, mapeo, modoMapeo, error);
    }
    if (columnas.fecha === undefined) error('columnas.fecha', 'falta');
    if (columnas.monto === undefined) error('columnas.monto', 'falta');
  }

  return errores.length > 0 ? { ok: false, errores } : { ok: true, plantilla: p as unknown as Plantilla };
}

function validarMapeo(ruta: string, m: unknown, tipo: unknown, error: (ruta: string, mensaje: string) => void): void {
  if (typeof m === 'string') {
    if (m.trim() === '') error(ruta, 'el nombre de columna no puede estar vacío');
    else if (tipo === 'anchoFijo') error(ruta, 'en ancho fijo debe ser un objeto { inicio, longitud }');
    else if (m.startsWith('#') && !/^#[1-9]\d*$/.test(m)) error(ruta, `índice de columna inválido "${m}" (use #1, #2...)`);
    return;
  }
  if (!esObjeto(m)) { error(ruta, 'debe ser un nombre de columna o un objeto'); return; }

  for (const k of Object.keys(m)) if (!CLAVES_MAPEO.has(k)) error(`${ruta}.${k}`, 'campo desconocido');

  if (m.de !== undefined) {
    if (!esTexto(m.de)) error(`${ruta}.de`, 'debe ser un texto no vacío');
    else if (m.de.startsWith('#') && !/^#[1-9]\d*$/.test(m.de)) error(`${ruta}.de`, `índice de columna inválido "${m.de}" (use #1, #2...)`);
    if (tipo === 'anchoFijo') error(`${ruta}.de`, 'no aplica a ancho fijo; use inicio y longitud');
  }
  if (m.unir !== undefined) {
    if (!Array.isArray(m.unir) || m.unir.length === 0 || !m.unir.every(esTexto)) error(`${ruta}.unir`, 'debe ser una lista no vacía de nombres de columna');
    if (tipo === 'anchoFijo') error(`${ruta}.unir`, 'no aplica a ancho fijo');
  }
  if (m.inicio !== undefined && !esEntero(m.inicio, 1)) error(`${ruta}.inicio`, 'debe ser un entero mayor o igual a 1');
  if (m.longitud !== undefined && !esEntero(m.longitud, 1)) error(`${ruta}.longitud`, 'debe ser un entero mayor o igual a 1');
  if (m.fijo !== undefined && typeof m.fijo !== 'string') error(`${ruta}.fijo`, 'debe ser texto');
  if (m.regex !== undefined) {
    if (typeof m.regex !== 'string') error(`${ruta}.regex`, 'debe ser texto');
    else { const problema = revisarRegex(m.regex); if (problema) error(`${ruta}.regex`, `${problema}: ${m.regex.slice(0, 60)}`); }
  }
  if (m.decimalesImplicitos !== undefined && (!esEntero(m.decimalesImplicitos, 0) || m.decimalesImplicitos > 6)) {
    error(`${ruta}.decimalesImplicitos`, 'debe ser un entero entre 0 y 6');
  }
  if (m.signo !== undefined && m.signo !== 'negar' && m.signo !== 'abs') error(`${ruta}.signo`, 'debe ser "negar" o "abs"');
  if (m.opcional !== undefined) {
    if (typeof m.opcional !== 'boolean') error(`${ruta}.opcional`, 'debe ser true o false');
    if (tipo === 'anchoFijo') error(`${ruta}.opcional`, 'no aplica a ancho fijo');
  }

  // Cada mapeo necesita de dónde sacar el valor.
  if (m.fijo === undefined) {
    if (tipo === 'anchoFijo' && (m.inicio === undefined || m.longitud === undefined)) error(ruta, 'ancho fijo necesita inicio y longitud (o fijo)');
    if (tipo === 'delimitado' && m.de === undefined && m.unir === undefined) error(ruta, 'falta de, unir o fijo');
  }
  if (tipo === 'delimitado' && (m.inicio !== undefined || m.longitud !== undefined)) error(ruta, 'inicio y longitud solo aplican a ancho fijo');
  if (m.de !== undefined && m.unir !== undefined) error(ruta, 'use de o unir, no ambos');
}
