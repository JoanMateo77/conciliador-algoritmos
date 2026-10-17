// Lógica común a todos los lectores: aplicar los mapeos de la plantilla a una fila,
// convertir montos y fechas, omitirSi, soloEntradas e ids. Delimitado, ancho fijo y
// los lectores propios (MT940, camt.053) solo cambian cómo se extrae cada valor.
import { aCentavos, aFechaISO, normalizarReferencia, ErrorDeDato } from '../modelo.ts';
import type { Movimiento, Desglose } from '../modelo.ts';
import { normalizarEncabezado } from './csv.ts';
import { crearProbador, regexSegura } from '../regexSegura.ts';
import type { CampoDestino, ErrorDeLinea, Mapeo, MapeoDetallado, Plantilla, RegistroLeido, ResultadoLectura } from './tipos.ts';

const CAMPOS_MONTO: Partial<Record<CampoDestino, keyof Desglose>> = {
  bruto: 'brutoCentavos',
  comision: 'comisionCentavos',
  ivaComision: 'ivaComisionCentavos',
  retenciones: 'retencionesCentavos',
};

// Cómo obtener el texto de una columna en la fila actual (delimitado) o de una posición (ancho fijo).
export type Extractor = (mapeo: MapeoDetallado) => string;

export const comoObjeto = (m: Mapeo): MapeoDetallado => (typeof m === 'string' ? { de: m } : m);

// Regex de la plantilla ya compilada y con presupuesto de tiempo (ver regexSegura.ts).
export interface RegexProbada { exec(texto: string): RegExpExecArray | null; test(texto: string): boolean }

export function aplicarRegex(valor: string, m: MapeoDetallado, regex: (fuente: string) => RegexProbada): string {
  if (m.regex === undefined) return valor;
  const r = regex(m.regex).exec(valor);
  if (!r) return '';
  return (r[1] ?? r[0]).trim();
}

export function crearLector(plantilla: Plantilla) {
  const movimientos: Movimiento[] = [];
  const errores: ErrorDeLinea[] = [];
  const ids = new Set<string>();
  const separadorDecimal = plantilla.separadorDecimal ?? ',';

  // Las regex se compilan una vez por archivo, no una por fila. Las plantillas por empresa
  // las escribe el usuario: se revisan contra ReDoS y comparten un presupuesto de tiempo.
  const probar = crearProbador();
  const cache = new Map<string, RegexProbada>();
  const regex = (fuente: string): RegexProbada => {
    let r = cache.get(fuente);
    if (!r) {
      const re = regexSegura(fuente);
      r = { exec: (t) => probar(re, t), test: (t) => probar(re, t) !== null };
      cache.set(fuente, r);
    }
    return r;
  };
  const omitir = (plantilla.omitirSi ?? []).map((o) => ({ campo: o.campo, regex: regex(o.regex) }));
  const columnas = Object.entries(plantilla.columnas) as [CampoDestino, Mapeo][];

  function procesar(linea: number, extraer: Extractor, valorOmitir: (campo: string) => string): void {
    try {
      for (const o of omitir) if (o.regex.test(valorOmitir(o.campo))) return;

      const textos: Partial<Record<CampoDestino, string>> = {};
      const montos: Partial<Record<CampoDestino, number>> = {};
      for (const [campo, mapeo] of columnas) {
        const m = comoObjeto(mapeo);
        const valor = aplicarRegex(extraer(m), m, regex);
        if (campo === 'monto' || campo in CAMPOS_MONTO) {
          if (valor === '') {
            if (campo === 'monto') throw new ErrorDeDato('monto: vacío');
            continue; // un desglose vacío simplemente no viene
          }
          let centavos = conCampo(campo, () => aCentavos(valor, separadorDecimal, m.decimalesImplicitos));
          if (m.signo === 'abs') centavos = Math.abs(centavos);
          else if (m.signo === 'negar') centavos = -centavos;
          montos[campo] = centavos + 0; // + 0 evita -0
        } else {
          textos[campo] = valor;
        }
      }

      const montoCentavos = montos.monto!;
      if (plantilla.soloEntradas && montoCentavos <= 0) return;

      const textoFecha = textos.fecha ?? '';
      if (textoFecha === '') throw new ErrorDeDato('fecha: vacía');
      const fecha = conCampo('fecha', () => aFechaISO(textoFecha, plantilla.formatoFecha));

      const id = textos.id || `${plantilla.id}:${linea}`;
      if (ids.has(id)) throw new ErrorDeDato(`id: "${id}" está repetido en el archivo`);

      const movimiento: Movimiento = {
        id,
        lado: plantilla.lado,
        fecha,
        montoCentavos,
        referencia: normalizarReferencia(textos.referencia ?? ''),
        descripcion: textos.descripcion ?? '',
        plantilla: plantilla.id,
        // Permite saber con qué versión de la plantilla se leyó (auditoría de lecturas antiguas).
        plantillaVersion: plantilla.version,
        linea,
      };
      if (textos.referenciaPago) movimiento.referenciaPago = textos.referenciaPago;
      const desglose: Desglose = {};
      for (const [campo, clave] of Object.entries(CAMPOS_MONTO) as [CampoDestino, keyof Desglose][]) {
        if (montos[campo] !== undefined) desglose[clave] = montos[campo];
      }
      if (Object.keys(desglose).length > 0) movimiento.desglose = desglose;

      ids.add(id);
      movimientos.push(movimiento);
    } catch (e) {
      if (!(e instanceof ErrorDeDato)) throw e; // un error de programación no se disfraza de dato malo
      errores.push({ linea, mensaje: e.message });
    }
  }

  return { movimientos, errores, procesar, regex };
}

// Convierte registros con campos nombrados (de un lector propio) en movimientos, con los
// mismos mapeos que una plantilla delimitada: "FECHA_VALOR", { de, regex }, unir, fijo.
// Un campo que el registro no trae vale '' (en estos formatos casi todo es opcional).
export function leerRegistros(registros: RegistroLeido[], plantilla: Plantilla): ResultadoLectura {
  const lector = crearLector(plantilla);
  for (const r of registros) {
    const campos = new Map<string, string>();
    for (const [k, v] of Object.entries(r.campos)) campos.set(normalizarEncabezado(k), v);
    const valor = (nombre: string) => (campos.get(normalizarEncabezado(nombre)) ?? '').trim();
    const extraer: Extractor = (m) => {
      if (m.fijo !== undefined) return m.fijo;
      if (m.unir) return m.unir.map(valor).filter((v) => v !== '').join(' ');
      return m.de !== undefined ? valor(m.de) : '';
    };
    const valorOmitir = (campo: string) => {
      if (campos.has(normalizarEncabezado(campo))) return valor(campo);
      const m = plantilla.columnas[campo as CampoDestino];
      return m === undefined ? '' : aplicarRegex(extraer(comoObjeto(m)), comoObjeto(m), lector.regex);
    };
    lector.procesar(r.linea, extraer, valorOmitir);
  }
  return { movimientos: lector.movimientos, errores: lector.errores };
}

// Antepone el campo al mensaje para que el usuario sepa qué columna revisar.
function conCampo<T>(campo: string, f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof ErrorDeDato) throw new ErrorDeDato(`${campo}: ${e.message}`);
    throw e;
  }
}
