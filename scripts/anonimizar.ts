// Anonimiza un archivo de banco o pasarela para poder donarlo como vector de prueba (fase 8).
//
//   node scripts/anonimizar.ts <entrada> <salida> [--plantilla id] [--clave secreto]
//                              [--desplazar-dias N] [--factor-montos F] [--hoja nombre]
//
// Un .xlsx/.xls se convierte primero a CSV con ';' (@conciliador/excel) y la salida es ese CSV.
//
// Qué hace:
// - Reemplaza nombres, cédulas/NIT, correos, cuentas y referencias por valores sintéticos
//   ESTABLES: con la misma clave, el mismo valor original da siempre el mismo reemplazo, en
//   este archivo y en los demás del mismo comercio (así el banco y las ventas siguen cruzando).
// - Conserva el formato exacto: mismas líneas, columnas, separadores, comillas y longitudes
//   (cada letra se cambia por una letra y cada dígito por un dígito). Las referencias
//   conservan sus prefijos comunes, para que una referencia truncada por el banco siga
//   siendo prefijo de la original.
// - Opcionalmente corre las fechas N días y multiplica los montos por F (mismo formato).
//
// Por qué así: un reemplazo por posición (HMAC de la clave y lo anterior) no se puede
// revertir sin la clave y no necesita guardar una tabla de equivalencias.
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  aCentavos, aFechaISO, detectarSeparador, leerArchivo, normalizarEncabezado, parsearCSV, quitarBOM, RegistroPlantillas,
} from '../packages/core/src/index.ts';
import type { CampoDestino, Mapeo, MapeoDetallado, Plantilla } from '../packages/core/src/index.ts';
import { PLANTILLAS } from '../packages/plantillas/index.ts';
import { leerExcel } from '../packages/excel/src/index.ts';

export interface OpcionesAnonimizar {
  clave: string;
  desplazarDias?: number;   // corre las fechas mapeadas
  factorMontos?: number;    // multiplica los montos mapeados (1 = igual); conserva los porcentajes de comisión
}

export interface ResultadoAnonimizar {
  texto: string;
  celdasCambiadas: number;
  avisos: string[];
}

// Palabras de banca y pasarelas que no identifican a nadie: se conservan en los textos
// libres para que el archivo siga siendo útil (y omitirSi, p. ej. ^SALDO, siga funcionando).
const PALABRAS_LIBRES = new Set(`
  ABONO ABONOS ACH ANTERIOR APPROVED B BANCO BRE CAJERO CARD CARGO CHARGEBACK CHEQUE COBRO COMISION
  COMPRA CONSIGNACION COP CREDITO CUOTA DAVIPLATA DE DEBITO DECLINED DEL DEVOLUCION EFECTIVO EL EN ERROR
  CC CE GMF IVA LA LAS NIT LIQUIDACION LLAVE LOS LOTE MANEJO NEQUI NOMINA OFICINA PAGO PAGOS PAYOUTS PENDING POR PSE
  RECAUDO REF REFUND RETEFUENTE RETEICA RETEIVA RETIRO REVERSO SALDO SETTLEMENT TARJETA TOTAL TRANSFERENCIA
  TRX USD VENTA VOIDED WOMPI X Y
`.trim().split(/\s+/));

// Encabezados que traen datos personales aunque la plantilla no los mapee: todo se reemplaza.
const ENCABEZADO_PERSONAL = /NOMBRE|CLIENTE|TITULAR|PAGADOR|ORDENANTE|BENEFICIARIO|CEDULA|NIT|DOCUMENTO|IDENTIFICACION|CORREO|EMAIL|MAIL|CUENTA|TELEFONO|CELULAR|DIRECCION|REFERENCIA|(^|_)REF|(^|_)ID($|_)/;
// Encabezados de texto libre: se conservan las palabras de banca.
const ENCABEZADO_TEXTO = /DESCRIPCION|CONCEPTO|DETALLE|OBSERVACION|MOTIVO/;
// Marcadores de "sin referencia" de los estándares: cambiarlos rompería la lectura.
const VALORES_ESPECIALES = new Set(['NONREF', 'NOTPROVIDED']);

// Columnas de dinero no mapeadas (saldo, neto, impuestos): se tratan como montos para que no
// se confundan con cédulas y para escalarlas igual que las mapeadas (el saldo sigue cuadrando).
const ENCABEZADO_MONTO = /VALOR|MONTO|AMOUNT|SALDO|IMPORTE|TOTAL|NETO|(^|_)NET($|_)|BRUTO|FEE|COMISION|(^|_)IVA($|_)|IMPUESTO|TAX|RETEN|DEBITO|CREDITO/;
const PARECE_MONTO = /^\s*[-+(]?\s*\$?\s*[\d.,]+\s*\)?-?\s*$/;

// Cómo se trata cada valor: identificador (todo se reemplaza), texto libre (se conservan las
// palabras de PALABRAS_LIBRES y los números cortos), otro (solo correos y números largos).
type Clase = 'identificador' | 'texto' | 'otro';

const CAMPOS_IDENTIFICADOR = new Set<CampoDestino>(['id', 'referencia', 'referenciaPago']);
const CAMPOS_MONTO = new Set<CampoDestino>(['monto', 'bruto', 'comision', 'ivaComision', 'retenciones']);
const MIN_DIGITOS_SENSIBLES = 5; // cédulas, NIT, cuentas, teléfonos; "LOTE 3" o "4X1000" no

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function crearSeudonimizador(clave: string) {
  const memo = new Map<string, string>();
  const desplazamiento = (contexto: string, modulo: number) =>
    createHmac('sha256', clave).update(contexto).digest().readUInt32BE(0) % modulo;

  // Un tramo de dígitos: los ceros a la izquierda se conservan (y no cuentan en el contexto,
  // así 000100245 y 100245 dan el mismo reemplazo) y el primer dígito significativo no se vuelve 0.
  function digitos(tramo: string): string {
    let r = '';
    let significativo = '';
    for (const c of tramo) {
      const d = Number(c);
      if (significativo === '' && d === 0) { r += '0'; continue; }
      const k = desplazamiento('d:' + significativo, 10);
      r += significativo === '' ? String(((d - 1 + k) % 9) + 1) : String((d + k) % 10);
      significativo += c;
    }
    return r;
  }

  // Un tramo de letras: el contexto ignora mayúsculas y tildes ("Pérez" y "PEREZ" coinciden);
  // se conserva si cada letra era mayúscula o minúscula. La Ñ y las tildes salen como letras simples.
  function letras(tramo: string): string {
    const base = tramo.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    let r = '';
    const originales = [...tramo];
    [...base].forEach((c, i) => {
      const k = desplazamiento('l:' + base.slice(0, i), 26);
      const p = LETRAS.indexOf(c);
      const nueva = LETRAS[((p < 0 ? 0 : p) + k) % 26];
      const o = originales[i] ?? c;
      r += o === o.toLowerCase() && o !== o.toUpperCase() ? nueva.toLowerCase() : nueva;
    });
    return r;
  }

  const tramo = (t: string, tipo: 'd' | 'l') => {
    const k = tipo + t;
    let r = memo.get(k);
    if (r === undefined) { r = tipo === 'd' ? digitos(t) : letras(t); memo.set(k, r); }
    return r;
  };

  // Reemplaza tramos de letras y de dígitos; la puntuación y los espacios quedan igual.
  // Las entidades XML (&amp;) no se tocan para no romper el archivo.
  function valor(texto: string, clase: Clase): string {
    if (VALORES_ESPECIALES.has(texto.trim())) return texto;
    if (clase === 'otro') {
      return texto
        .replace(/[\p{L}\d._%+-]+@[\p{L}\d.-]+\.\p{L}+/gu, (correo) => valor(correo, 'identificador'))
        .replace(/\d+/g, (d) => (d.length >= MIN_DIGITOS_SENSIBLES ? tramo(d, 'd') : d));
    }
    return texto.split(/(&[#\w]+;)/).map((parte, i) => (i % 2 === 1 ? parte : parte.replace(/\p{L}+|\d+/gu, (t) => {
      if (/^\d/.test(t)) return clase === 'texto' && t.length < MIN_DIGITOS_SENSIBLES ? t : tramo(t, 'd');
      // Un tramo con una letra no ASCII de más de una unidad (raro) se deja con su largo.
      if (clase === 'texto' && PALABRAS_LIBRES.has(normalizarEncabezado(t))) return t;
      const r = tramo(t, 'l');
      return r.length === t.length ? r : t.replace(/./gu, 'X');
    }))).join('');
  }

  return { valor };
}

// ---------- fechas y montos ----------

function desplazarFecha(texto: string, patron: string, dias: number): string {
  const iso = aFechaISO(texto, patron);
  const d = new Date(Date.parse(`${iso}T00:00:00Z`) + dias * 86_400_000);
  const partes: Record<string, string> = {
    yyyy: String(d.getUTCFullYear()).padStart(4, '0'),
    yy: String(d.getUTCFullYear() % 100).padStart(2, '0'),
    MM: String(d.getUTCMonth() + 1).padStart(2, '0'),
    dd: String(d.getUTCDate()).padStart(2, '0'),
  };
  // Se sobrescriben solo las posiciones del patrón: lo que sigue (hora, zona) queda igual.
  const r = [...texto];
  for (const marca of ['yyyy', 'MM', 'dd']) {
    const i = patron.indexOf(marca);
    if (i >= 0) [...partes[marca]].forEach((c, j) => { r[i + j] = c; });
  }
  if (patron.indexOf('yyyy') < 0 && patron.indexOf('yy') >= 0) {
    const i = patron.indexOf('yy');
    [...partes.yy].forEach((c, j) => { r[i + j] = c; });
  }
  return r.join('');
}

// Multiplica un monto y lo escribe con el mismo estilo que el original (signo, $, miles, decimales).
function escalarMonto(texto: string, m: MapeoDetallado, separadorDecimal: ',' | '.', factor: number): string {
  const centavos = aCentavos(texto, separadorDecimal, m.decimalesImplicitos);
  const nuevo = Math.round(centavos * factor);
  const abs = Math.abs(nuevo);
  if (m.decimalesImplicitos !== undefined) {
    const digitos = String(Math.round(abs / 10 ** (2 - m.decimalesImplicitos)));
    const limpio = texto.trim();
    // Con ceros a la izquierda (ancho fijo) se rellena al mismo largo; si no cabe, quien llama lo nota.
    const largo = /^0\d+$/.test(limpio) ? limpio.length : 0;
    return texto.replace(limpio, (nuevo < 0 ? '-' : '') + digitos.padStart(largo, '0'));
  }
  const miles = separadorDecimal === ',' ? '.' : ',';
  const sinSigno = texto.replace(/[-()+\s$]|COP/gi, '');
  const [, dec = ''] = sinSigno.split(separadorDecimal);
  const conMiles = sinSigno.includes(miles);
  const decimales = sinSigno.includes(separadorDecimal) ? dec.length : 0;
  const enteros = Math.trunc(abs / 100);
  let s = conMiles ? String(enteros).replace(/\B(?=(\d{3})+(?!\d))/g, miles) : String(enteros);
  if (decimales > 0) s += separadorDecimal + String(abs % 100).padStart(2, '0').padEnd(decimales, '0').slice(0, decimales);
  // Prefijos y sufijos del original ($, espacios, paréntesis, signo) se copian.
  const ini = /^[^\d]*/.exec(texto)![0].replace(/-/g, '');
  const fin = /[^\d]*$/.exec(texto)![0].replace(/^[.,]\d*/, '').replace(/-/g, '');
  const negativo = nuevo < 0 && !/^\(.*\)$/.test(texto.trim());
  const signoAlFinal = /-\s*$/.test(texto);
  return ini + (negativo && !signoAlFinal ? '-' : '') + s + (negativo && signoAlFinal ? '-' : '') + fin;
}

// ---------- por tipo de archivo ----------

const comoObjeto = (m: Mapeo): MapeoDetallado => (typeof m === 'string' ? { de: m } : m);

interface Contexto {
  plantilla: Plantilla;
  opciones: OpcionesAnonimizar;
  s: ReturnType<typeof crearSeudonimizador>;
  avisos: Set<string>;
  cambios: number;
}

// Aplica la transformación de un campo a un valor (una celda o una zona de ancho fijo).
function transformar(ctx: Contexto, valor: string, clase: Clase | 'fecha' | 'monto', m?: MapeoDetallado): string {
  const { opciones, plantilla } = ctx;
  let r = valor;
  try {
    if (clase === 'fecha') {
      if (!opciones.desplazarDias) return valor;
      if (m?.regex) {
        const sub = new RegExp(m.regex).exec(valor);
        const fecha = sub ? (sub[1] ?? sub[0]) : '';
        r = fecha ? valor.replace(fecha, desplazarFecha(fecha, plantilla.formatoFecha, opciones.desplazarDias)) : valor;
      } else if (valor.trim() !== '') {
        const recortado = valor.trim();
        r = valor.replace(recortado, desplazarFecha(recortado, plantilla.formatoFecha, opciones.desplazarDias));
      }
    } else if (clase === 'monto') {
      // Una columna "de dinero" con texto adentro se trata como texto libre: no se deja pasar nada.
      if (valor.trim() !== '' && !PARECE_MONTO.test(valor)) return transformar(ctx, valor, 'texto');
      if (opciones.factorMontos === undefined || opciones.factorMontos === 1 || valor.trim() === '' || m?.regex) return valor;
      r = escalarMonto(valor, m ?? {}, plantilla.separadorDecimal ?? ',', opciones.factorMontos);
    } else {
      r = ctx.s.valor(valor, clase);
    }
  } catch (e) {
    // Una fecha o monto que no se entiende (p. ej. una fila de totales) se deja como estaba.
    ctx.avisos.add(`valor sin cambiar en ${clase}: ${e instanceof Error ? e.message : String(e)}`);
    return valor;
  }
  if (r.length !== valor.length && clase !== 'monto') r = valor; // nunca cambiar longitudes de texto
  if (r !== valor) ctx.cambios++;
  return r;
}

function claseDeCampo(campo: CampoDestino): Clase | 'fecha' | 'monto' {
  if (campo === 'fecha') return 'fecha';
  if (CAMPOS_MONTO.has(campo)) return 'monto';
  return CAMPOS_IDENTIFICADOR.has(campo) ? 'identificador' : 'texto';
}

function anonimizarDelimitado(texto: string, ctx: Contexto): string {
  const { plantilla } = ctx;
  const separador = plantilla.separador ?? detectarSeparador(texto);
  const filasEncabezado = plantilla.filasEncabezado ?? 1;
  const { filas } = parsearCSV(texto, separador);
  const encabezado = filasEncabezado > 0 ? filas[filasEncabezado - 1]?.celdas ?? [] : [];

  // Clase de cada columna: la del campo que la usa o, si no se usa, según su encabezado.
  const clases = new Map<number, { clase: Clase | 'fecha' | 'monto'; m?: MapeoDetallado }>();
  const posicion = (nombre: string) => {
    const n = /^#(\d+)$/.exec(nombre.trim());
    return n ? Number(n[1]) - 1 : encabezado.findIndex((e) => normalizarEncabezado(e) === normalizarEncabezado(nombre));
  };
  for (const [campo, mapeo] of Object.entries(plantilla.columnas) as [CampoDestino, Mapeo][]) {
    const m = comoObjeto(mapeo);
    for (const nombre of [...(m.de ? [m.de] : []), ...(m.unir ?? [])]) {
      const i = posicion(nombre);
      if (i < 0) continue;
      const clase = claseDeCampo(campo);
      const previa = clases.get(i)?.clase;
      // Si una columna alimenta dos campos, gana el tratamiento más estricto.
      if (previa === 'identificador') continue;
      clases.set(i, { clase: m.unir && clase === 'identificador' ? 'texto' : clase, m: m.unir ? undefined : m });
    }
  }
  const claseDe = (i: number): { clase: Clase | 'fecha' | 'monto'; m?: MapeoDetallado } => {
    const mapeada = clases.get(i);
    if (mapeada) return mapeada;
    const nombre = normalizarEncabezado(encabezado[i] ?? '');
    if (ENCABEZADO_MONTO.test(nombre)) return { clase: 'monto', m: { decimalesImplicitos: /CENTS|CENTAVOS/.test(nombre) ? 2 : undefined } };
    return { clase: ENCABEZADO_PERSONAL.test(nombre) ? 'identificador' : ENCABEZADO_TEXTO.test(nombre) ? 'texto' : 'otro' };
  };

  // Se reescribe el texto original reemplazando solo el contenido de las celdas: comillas,
  // separadores y saltos de línea quedan exactamente donde estaban.
  const t = quitarBOM(texto);
  const bom = texto.length - t.length > 0 ? texto.slice(0, texto.length - t.length) : '';
  let salida = '';
  let celda = '';
  let col = 0;
  let fila = 0;
  let enComillas = false;
  let celdaConComillas = false;
  let filaConContenido = false; // las líneas en blanco no cuentan como fila (igual que parsearCSV)
  const vaciar = () => {
    if (fila < filasEncabezado) salida += celda;
    else {
      const { clase, m } = claseDe(col);
      const nuevo = transformar(ctx, celda.replace(/""/g, '"'), clase, m);
      salida += celdaConComillas ? nuevo.replace(/"/g, '""') : nuevo;
    }
    celda = '';
  };
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (enComillas) {
      if (c === '"' && t[i + 1] === '"') { celda += '""'; i++; continue; }
      if (c === '"') { enComillas = false; vaciar(); salida += '"'; continue; }
      celda += c;
      continue;
    }
    if (c === '"' && celda === '') { enComillas = true; celdaConComillas = true; filaConContenido = true; salida += '"'; continue; }
    if (c === separador) { vaciar(); salida += c; col++; celdaConComillas = false; filaConContenido = true; continue; }
    if (c === '\n' || c === '\r') {
      vaciar();
      salida += c;
      if (c === '\n') { col = 0; celdaConComillas = false; if (filaConContenido) fila++; filaConContenido = false; }
      continue;
    }
    filaConContenido = true;
    celda += c;
  }
  vaciar();
  return bom + salida;
}

function anonimizarAnchoFijo(texto: string, ctx: Contexto): string {
  const { plantilla } = ctx;
  const detalle = plantilla.registroDetalle;
  const zonas = (Object.entries(plantilla.columnas) as [CampoDestino, Mapeo][])
    .map(([campo, mapeo]) => ({ clase: claseDeCampo(campo), m: comoObjeto(mapeo) }))
    .filter((z) => z.m.inicio !== undefined && z.m.longitud !== undefined);
  let otras = 0;
  const salida = texto.split(/(\r?\n)/).map((l, i) => {
    if (i % 2 === 1 || l.trim() === '') return l;
    const tipo = detalle ? l.slice(detalle.inicio - 1, detalle.inicio - 1 + detalle.longitud) : undefined;
    // Los campos con 'registro' (la fecha del encabezado) se transforman en su propia línea.
    const deLinea = zonas.filter((z) => (detalle && tipo !== detalle.valor ? z.m.registro === tipo : z.m.registro === undefined));
    if (detalle && tipo !== detalle.valor) {
      otras++;
      if (deLinea.length === 0) return l;
    }
    let r = l;
    for (const z of deLinea) {
      const ini = z.m.inicio! - 1;
      const fin = ini + z.m.longitud!;
      const nuevo = transformar(ctx, r.slice(ini, fin), z.clase, z.m);
      if (nuevo.length !== fin - ini) { ctx.avisos.add('un monto escalado no cabía en su posición: se dejó igual'); continue; }
      r = r.slice(0, ini) + nuevo + r.slice(fin);
    }
    return r;
  }).join('');
  if (otras > 0) {
    ctx.avisos.add(`${otras} línea(s) que no son de detalle (encabezados, controles) se copiaron sin cambios: revíselas, pueden traer el NIT o la cuenta de la empresa`);
    if (ctx.opciones.factorMontos !== undefined && ctx.opciones.factorMontos !== 1) {
      ctx.avisos.add('los totales de control de los registros de encabezado y control no se recalculan al escalar montos');
    }
    if (ctx.opciones.desplazarDias) {
      ctx.avisos.add('en los registros de encabezado y control solo se desplazan las fechas que la plantilla mapea');
    }
  }
  return salida;
}

function anonimizarMT940(texto: string, ctx: Contexto): string {
  let etiqueta = '';
  return texto.split(/(\r?\n)/).map((l, i) => {
    if (i % 2 === 1) return l;
    const m = /^:(\d{2}[A-Z]?):(.*)$/.exec(l);
    if (m) {
      etiqueta = m[1];
      const prefijo = `:${m[1]}:`;
      if (etiqueta === '25') return prefijo + transformar(ctx, m[2], 'identificador');
      if (etiqueta === '86') return prefijo + transformar(ctx, m[2], 'texto');
      if (etiqueta === '61') {
        // Se conserva fecha, marca, monto y código; se anonimizan las referencias.
        const p = /^(\d{6}(?:\d{4})?(?:RC|RD|C|D)[A-Z]?\d+,\d*[A-Z][A-Z0-9]{3})(.*)$/.exec(m[2]);
        if (!p) return l;
        const refs = p[2].split('//').map((r) => (/^NONREF$/.test(r) ? r : transformar(ctx, r, 'identificador'))).join('//');
        return prefijo + p[1] + refs;
      }
      return l;
    }
    if (l.startsWith('{') || l.trim() === '-}') return l;
    // Continuación: detalle del :61: o más líneas del :86:.
    return etiqueta === '86' || etiqueta === '61' ? transformar(ctx, l, 'texto') : l;
  }).join('');
}

const ETIQUETAS_ID = 'EndToEndId|TxId|InstrId|MsgId|PmtInfId|AcctSvcrRef|IBAN|Ref|MndtId|ChqNb';
const ETIQUETAS_TEXTO = 'Ustrd|Nm|AddtlNtryInf|AddtlTxInf|AdrLine|StrtNm|TwnNm|BldgNb|PstCd';

function anonimizarCamt053(texto: string, ctx: Contexto): string {
  return texto
    // Identificación de cuentas y personas: <Othr><Id>...</Id>
    .replace(/(<(?:\w+:)?Othr>\s*<(?:\w+:)?Id>)([^<]*)(<)/g, (_t, a: string, v: string, b: string) => a + transformar(ctx, v, 'identificador') + b)
    .replace(new RegExp(`(<(?:\\w+:)?(?:${ETIQUETAS_ID})(?:\\s[^>]*)?>)([^<]*)(<)`, 'g'), (_t, a: string, v: string, b: string) => a + transformar(ctx, v, 'identificador') + b)
    .replace(new RegExp(`(<(?:\\w+:)?(?:${ETIQUETAS_TEXTO})(?:\\s[^>]*)?>)([^<]*)(<)`, 'g'), (_t, a: string, v: string, b: string) => a + transformar(ctx, v, 'texto') + b);
}

export function anonimizar(texto: string, plantilla: Plantilla, opciones: OpcionesAnonimizar): ResultadoAnonimizar {
  if (!opciones.clave) throw new Error('falta la clave');
  const ctx: Contexto = { plantilla, opciones, s: crearSeudonimizador(opciones.clave), avisos: new Set(), cambios: 0 };
  let salida: string;
  switch (plantilla.tipo) {
    case 'delimitado': salida = anonimizarDelimitado(texto, ctx); break;
    case 'anchoFijo': salida = anonimizarAnchoFijo(texto, ctx); break;
    case 'mt940': salida = anonimizarMT940(texto, ctx); break;
    case 'camt053': salida = anonimizarCamt053(texto, ctx); break;
    default: throw new Error(`tipo de plantilla no soportado: ${plantilla.tipo}`);
  }
  if ((plantilla.tipo === 'mt940' || plantilla.tipo === 'camt053') && (opciones.desplazarDias || (opciones.factorMontos ?? 1) !== 1)) {
    ctx.avisos.add(`en ${plantilla.tipo} las fechas y montos no se desplazan (los saldos dejarían de cuadrar)`);
  }

  // Verificación: el archivo anonimizado se lee igual que el original (mismas filas, mismos errores).
  const antes = leerArchivo(texto, plantilla);
  const despues = leerArchivo(salida, plantilla);
  if (antes.movimientos.length !== despues.movimientos.length || antes.errores.length !== despues.errores.length) {
    ctx.avisos.add(`la lectura cambió: ${antes.movimientos.length} -> ${despues.movimientos.length} movimientos, ` +
      `${antes.errores.length} -> ${despues.errores.length} errores; revise omitirSi y las columnas de la plantilla`);
  }
  return { texto: salida, celdasCambiadas: ctx.cambios, avisos: [...ctx.avisos] };
}

// ---------- línea de comandos ----------

function main(argv: string[]): number {
  const posicionales: string[] = [];
  const banderas = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) banderas.set(argv[i].slice(2), argv[++i] ?? '');
    else posicionales.push(argv[i]);
  }
  const [entrada, salida] = posicionales;
  if (!entrada || !salida) {
    console.error('Uso: node scripts/anonimizar.ts <entrada> <salida> [--plantilla id] [--clave secreto] [--desplazar-dias N] [--factor-montos F] [--hoja nombre]');
    return 2;
  }
  const registro = new RegistroPlantillas();
  for (const p of PLANTILLAS) registro.registrar(p);

  let plantilla: Plantilla | undefined;
  const id = banderas.get('plantilla');
  const bytes = readFileSync(entrada);
  const esExcel = /\.xlsx?$/i.test(entrada);
  const textoExcel = esExcel ? leerExcel(bytes, { hoja: banderas.get('hoja') }).texto : '';
  if (id) {
    plantilla = registro.obtener(id);
    if (!plantilla) { console.error(`No existe la plantilla "${id}". Disponibles: ${registro.listar().map((p) => p.id).join(', ')}`); return 2; }
  } else {
    const mejor = registro.detectar(esExcel ? textoExcel : bytes.toString('utf8'))[0];
    if (!mejor || mejor.confianza < 0.5) { console.error('No se reconoció el formato: indique --plantilla id'); return 2; }
    plantilla = mejor.plantilla;
  }
  const codificacion = !esExcel && plantilla.codificacion === 'latin1' ? 'latin1' : 'utf8';

  let clave = banderas.get('clave') ?? process.env.CONCILIADOR_CLAVE_ANONIMIZAR ?? '';
  if (!clave) {
    clave = randomBytes(16).toString('hex');
    console.error(`Clave generada: ${clave}`);
    console.error('Úsela con --clave para anonimizar los demás archivos del mismo comercio con los mismos reemplazos.');
    console.error('No la envíe junto con los archivos: con ella se pueden comprobar valores originales.');
  }
  const opciones: OpcionesAnonimizar = { clave };
  if (banderas.has('desplazar-dias')) opciones.desplazarDias = Number(banderas.get('desplazar-dias'));
  if (banderas.has('factor-montos')) opciones.factorMontos = Number(banderas.get('factor-montos'));
  if (!Number.isInteger(opciones.desplazarDias ?? 0)) { console.error('--desplazar-dias debe ser un entero'); return 2; }
  if (!((opciones.factorMontos ?? 1) > 0)) { console.error('--factor-montos debe ser un número positivo'); return 2; }

  const r = anonimizar(esExcel ? textoExcel : bytes.toString(codificacion), plantilla, opciones);
  if (esExcel) r.avisos.unshift('la entrada era Excel: la salida es CSV con ";" (la primera hoja, o la de --hoja)');
  writeFileSync(salida, r.texto, codificacion);
  console.log(`Plantilla: ${plantilla.id}. Valores reemplazados: ${r.celdasCambiadas}. Salida: ${salida}`);
  for (const a of r.avisos) console.log(`Aviso: ${a}`);
  console.log('Revise el archivo antes de compartirlo: la anonimización es automática y puede dejar pasar algo.');
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
