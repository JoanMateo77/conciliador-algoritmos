// Adaptador de Excel: convierte una hoja de un .xlsx/.xls en texto CSV con ';' listo para
// leerArchivo. Así la misma plantilla delimitada sirve para el CSV y para el Excel del
// mismo banco, y el núcleo sigue sin dependencias (SheetJS vive solo aquí).
import * as XLSX from 'xlsx';
import type { CellObject, WorkSheet } from 'xlsx';

export interface OpcionesExcel {
  hoja?: string;               // por defecto la primera
  separadorDecimal?: ',' | '.'; // cómo escribir los números con decimales; por defecto ',' (como las plantillas)
}

export interface ResultadoExcel {
  hojas: string[];
  texto: string;
}

const SEPARADOR = ';';
const DIA_MS = 86_400_000;
const EPOCA_EXCEL = Date.UTC(1899, 11, 30); // día 0 del sistema 1900 (con el error del 29/02/1900 ya absorbido)

export function leerExcel(datos: ArrayBuffer | Uint8Array, opciones: OpcionesExcel = {}): ResultadoExcel {
  const bytes = datos instanceof Uint8Array ? datos : new Uint8Array(datos);
  // cellNF guarda el formato de número: es lo único que distingue una fecha de un número.
  // Sin cellDates las fechas llegan como número de serie y se convierten sin zona horaria.
  const libro = XLSX.read(bytes, { type: 'array', cellNF: true, cellDates: false, cellText: false });
  const hojas = [...libro.SheetNames];
  if (hojas.length === 0) throw new Error('El libro de Excel no tiene hojas');
  const nombre = opciones.hoja ?? hojas[0];
  const hoja = libro.Sheets[nombre];
  if (!hoja) throw new Error(`La hoja "${nombre}" no existe; hojas disponibles: ${hojas.join(', ')}`);
  return { hojas, texto: hojaACSV(hoja, opciones.separadorDecimal ?? ',', libro.Workbook?.WBProps?.date1904 === true) };
}

function hojaACSV(hoja: WorkSheet, separadorDecimal: ',' | '.', fecha1904: boolean): string {
  const ref = hoja['!ref'];
  if (!ref) return '';
  const rango = XLSX.utils.decode_range(ref);
  const lineas: string[] = [];
  for (let f = rango.s.r; f <= rango.e.r; f++) {
    const celdas: string[] = [];
    for (let c = rango.s.c; c <= rango.e.c; c++) {
      const celda = hoja[XLSX.utils.encode_cell({ r: f, c })] as CellObject | undefined;
      celdas.push(escapar(textoDe(celda, separadorDecimal, fecha1904)));
    }
    // Una fila sin nada (separadores o formato sin valores) no es un movimiento.
    if (celdas.every((x) => x === '')) continue;
    lineas.push(celdas.join(SEPARADOR));
  }
  return lineas.length > 0 ? lineas.join('\n') + '\n' : '';
}

function textoDe(celda: CellObject | undefined, separadorDecimal: ',' | '.', fecha1904: boolean): string {
  if (!celda || celda.v === undefined || celda.v === null) return '';
  switch (celda.t) {
    case 'z': return '';
    case 's': return String(celda.v);
    case 'b': return celda.v ? 'VERDADERO' : 'FALSO';
    case 'e': return celda.w ?? '';
    case 'd': return fechaDeTexto(celda.v instanceof Date ? celda.v.toISOString() : String(celda.v));
    case 'n': {
      const n = celda.v as number;
      if (typeof celda.z === 'string' && XLSX.SSF.is_date(celda.z)) return fechaDeSerie(n, fecha1904);
      return numeroSinExponente(n, separadorDecimal);
    }
    default: return String(celda.v);
  }
}

// Número de serie de Excel -> dd/MM/yyyy, en UTC para que la zona horaria no mueva el día.
function fechaDeSerie(serie: number, fecha1904: boolean): string {
  const dias = Math.floor(serie + 1e-9) + (fecha1904 ? 1462 : 0);
  const d = new Date(EPOCA_EXCEL + dias * DIA_MS);
  return `${dos(d.getUTCDate())}/${dos(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function fechaDeTexto(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

const dos = (n: number) => String(n).padStart(2, '0');

// 1e21 o 1e-7 no los entiende aCentavos. Se redondea a 10 decimales para limpiar el ruido
// binario de fórmulas (0,1 + 0,2) y se escribe en notación decimal, sin separador de miles.
export function numeroSinExponente(n: number, separadorDecimal: ',' | '.' = ','): string {
  if (!Number.isFinite(n)) return '';
  let s: string;
  if (Math.abs(n) >= 1e21) s = BigInt(Math.round(n)).toString();
  else s = n.toFixed(10).replace(/\.?0+$/, '');
  if (s === '-0') s = '0';
  return separadorDecimal === ',' ? s.replace('.', ',') : s;
}

// Comillas solo cuando hace falta, como el parser CSV del núcleo espera.
function escapar(valor: string): string {
  return /[;"\r\n]/.test(valor) || /^\s|\s$/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
}
