// Lector genérico: convierte el texto de un archivo en Movimientos siguiendo una
// plantilla. Una línea mala va a errores con su número y el resto sigue.
import { aCentavos, aFechaISO, normalizarReferencia, ErrorDeDato } from '../modelo.ts';
import type { Movimiento, Desglose } from '../modelo.ts';
import { detectarSeparador, normalizarEncabezado, parsearCSV, quitarBOM } from './csv.ts';
import type { CampoDestino, ErrorDeLinea, Mapeo, MapeoDetallado, Plantilla, ResultadoLectura } from './tipos.ts';

const CAMPOS_MONTO: Partial<Record<CampoDestino, keyof Desglose>> = {
  bruto: 'brutoCentavos',
  comision: 'comisionCentavos',
  ivaComision: 'ivaComisionCentavos',
  retenciones: 'retencionesCentavos',
};

// Cómo obtener el texto de una columna en la fila actual (delimitado) o de una posición (ancho fijo).
type Extractor = (mapeo: MapeoDetallado) => string;

const comoObjeto = (m: Mapeo): MapeoDetallado => (typeof m === 'string' ? { de: m } : m);

export function leerArchivo(texto: string, plantilla: Plantilla): ResultadoLectura {
  return plantilla.tipo === 'anchoFijo' ? leerAnchoFijo(texto, plantilla) : leerDelimitado(texto, plantilla);
}

function leerDelimitado(texto: string, plantilla: Plantilla): ResultadoLectura {
  const separador = plantilla.separador ?? detectarSeparador(texto);
  const { filas, errores } = parsearCSV(texto, separador);
  const filasEncabezado = plantilla.filasEncabezado ?? 1;
  const encabezado = filasEncabezado > 0 ? filas[filasEncabezado - 1] : undefined;
  const lineaEncabezado = encabezado?.linea ?? 1;

  // Índice nombre normalizado -> posición; con la primera aparición si se repite.
  const indice = new Map<string, number>();
  encabezado?.celdas.forEach((c, i) => {
    const k = normalizarEncabezado(c);
    if (!indice.has(k)) indice.set(k, i);
  });
  const posicionDe = (nombre: string): number => {
    const n = /^#(\d+)$/.exec(nombre.trim());
    if (n) return Number(n[1]) - 1; // "#1" = primera columna
    return indice.get(normalizarEncabezado(nombre)) ?? -1;
  };

  // Una columna que no existe afectaría a todas las filas: es un error de plantilla, se avisa una vez.
  const faltantes: string[] = [];
  const revisar = (ruta: string, nombre: string) => {
    if (posicionDe(nombre) < 0) faltantes.push(`${ruta}: la columna "${nombre}" no está en el encabezado`);
  };
  if (filasEncabezado > 0 && encabezado === undefined) {
    return { movimientos: [], errores: [...errores, { linea: 0, mensaje: 'el archivo está vacío o no tiene encabezado' }] };
  }
  if (filasEncabezado > 0) {
    for (const [campo, m] of Object.entries(plantilla.columnas) as [CampoDestino, Mapeo][]) {
      const o = comoObjeto(m);
      if (o.fijo !== undefined) continue;
      if (o.de !== undefined) revisar(`columnas.${campo}`, o.de);
      for (const u of o.unir ?? []) revisar(`columnas.${campo}`, u);
    }
    (plantilla.omitirSi ?? []).forEach((o, i) => {
      if (posicionDe(o.campo) < 0 && !(o.campo in plantilla.columnas)) {
        faltantes.push(`omitirSi[${i}].campo: la columna "${o.campo}" no está en el encabezado`);
      }
    });
  }
  if (faltantes.length > 0) {
    return { movimientos: [], errores: [...errores, ...faltantes.map((mensaje) => ({ linea: lineaEncabezado, mensaje }))] };
  }

  const lector = crearLector(plantilla);
  for (const fila of filas.slice(filasEncabezado)) {
    const celda = (nombre: string) => (fila.celdas[posicionDe(nombre)] ?? '').trim();
    const extraer: Extractor = (m) => {
      if (m.fijo !== undefined) return m.fijo;
      if (m.unir) return m.unir.map(celda).filter((v) => v !== '').join(' ');
      return m.de !== undefined ? celda(m.de) : '';
    };
    // omitirSi mira la columna original; si no existe, el valor del campo mapeado con ese nombre.
    const valorOmitir = (campo: string) => {
      if (posicionDe(campo) >= 0) return celda(campo);
      const m = plantilla.columnas[campo as CampoDestino];
      return m === undefined ? '' : aplicarRegex(extraer(comoObjeto(m)), comoObjeto(m), lector.regex);
    };
    lector.procesar(fila.linea, extraer, valorOmitir);
  }
  return { movimientos: lector.movimientos, errores: [...errores, ...lector.errores].sort((a, b) => a.linea - b.linea) };
}

function leerAnchoFijo(texto: string, plantilla: Plantilla): ResultadoLectura {
  const lineas = quitarBOM(texto).split(/\r?\n/);
  const lector = crearLector(plantilla);
  const detalle = plantilla.registroDetalle;
  lineas.forEach((l, i) => {
    if (l.trim() === '') return;
    // Solo las líneas del tipo de registro de detalle; encabezados y controles se saltan.
    if (detalle && l.slice(detalle.inicio - 1, detalle.inicio - 1 + detalle.longitud) !== detalle.valor) return;
    const extraer: Extractor = (m) => {
      if (m.fijo !== undefined) return m.fijo;
      if (m.inicio === undefined || m.longitud === undefined) return '';
      return l.slice(m.inicio - 1, m.inicio - 1 + m.longitud).trim();
    };
    const valorOmitir = (campo: string) => {
      const m = plantilla.columnas[campo as CampoDestino];
      return m === undefined ? '' : aplicarRegex(extraer(comoObjeto(m)), comoObjeto(m), lector.regex);
    };
    lector.procesar(i + 1, extraer, valorOmitir);
  });
  return { movimientos: lector.movimientos, errores: lector.errores };
}

function aplicarRegex(valor: string, m: MapeoDetallado, regex: (fuente: string) => RegExp): string {
  if (m.regex === undefined) return valor;
  const r = regex(m.regex).exec(valor);
  if (!r) return '';
  return (r[1] ?? r[0]).trim();
}

// Lógica común a los dos tipos: mapeos, conversión, omitirSi, soloEntradas, ids.
function crearLector(plantilla: Plantilla) {
  const movimientos: Movimiento[] = [];
  const errores: ErrorDeLinea[] = [];
  const ids = new Set<string>();
  const separadorDecimal = plantilla.separadorDecimal ?? ',';

  // Las regex se compilan una vez por archivo, no una por fila.
  const cache = new Map<string, RegExp>();
  const regex = (fuente: string): RegExp => {
    let r = cache.get(fuente);
    if (!r) { r = new RegExp(fuente); cache.set(fuente, r); }
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

// Antepone el campo al mensaje para que el usuario sepa qué columna revisar.
function conCampo<T>(campo: string, f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof ErrorDeDato) throw new ErrorDeDato(`${campo}: ${e.message}`);
    throw e;
  }
}
