// Lector genérico: convierte el texto de un archivo en Movimientos siguiendo una
// plantilla. Una línea mala va a errores con su número y el resto sigue.
// 'delimitado' y 'anchoFijo' se leen aquí; los demás tipos van al lector registrado.
import { detectarSeparador, normalizarEncabezado, parsearCSV, quitarBOM } from './csv.ts';
import { obtenerLector } from './lectores.ts';
import { aplicarRegex, comoObjeto, crearLector } from './procesar.ts';
import type { Extractor } from './procesar.ts';
import type { CampoDestino, Mapeo, Plantilla, ResultadoLectura } from './tipos.ts';

export function leerArchivo(texto: string, plantilla: Plantilla): ResultadoLectura {
  if (plantilla.tipo === 'anchoFijo') return leerAnchoFijo(texto, plantilla);
  if (plantilla.tipo === 'delimitado') return leerDelimitado(texto, plantilla);
  const lector = obtenerLector(plantilla.tipo);
  if (!lector) {
    return { movimientos: [], errores: [{ linea: 0, mensaje: `no hay un lector registrado para el tipo "${plantilla.tipo}"` }] };
  }
  const r = lector.leer(texto, plantilla);
  // Un lector de terceros podría olvidarlo: la versión se fija aquí para todos.
  for (const m of r.movimientos) m.plantillaVersion = plantilla.version;
  return r;
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
      // Una columna opcional (p. ej. REFERENCIA PAGO de Bre-B) puede no venir en archivos antiguos.
      if (o.fijo !== undefined || o.opcional) continue;
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
