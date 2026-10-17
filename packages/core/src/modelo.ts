// Modelo común: todo archivo, venga de donde venga, termina como Movimiento.
// El motor de cruce solo conoce este tipo, nunca el formato original.

export type Lado = 'banco' | 'ventas';

export interface Desglose {
  brutoCentavos?: number;
  comisionCentavos?: number;
  ivaComisionCentavos?: number;
  retencionesCentavos?: number;
}

export interface Movimiento {
  id: string;              // único dentro de su lado
  lado: Lado;
  fecha: string;           // ISO aaaa-mm-dd
  montoCentavos: number;   // entero; positivo = entra dinero a la cuenta
  referencia: string;      // normalizada con normalizarReferencia, '' si no hay
  descripcion: string;
  referenciaPago?: string; // reservado para la Referencia de Pago de Bre-B
  desglose?: Desglose;
  plantilla: string;       // id de la plantilla que lo produjo
  plantillaVersion?: number; // versión de esa plantilla, para auditar lecturas antiguas
  linea: number;           // línea del archivo original (1 = primera)
  documento?: DocumentoFiscal; // presente cuando el movimiento viene de una factura electrónica
}

// Datos de una factura electrónica DIAN (UBL 2.1) que sirven para cruzar pago ↔ factura.
export interface DocumentoFiscal {
  tipo: 'factura' | 'notaCredito' | 'notaDebito';
  numero: string;
  cufe: string;
  nitEmisor: string;
  nitAdquirente: string;
  nombreAdquirente?: string;
  fechaVencimiento?: string;
  subtotalCentavos?: number;
  ivaCentavos?: number;
  retencionesCentavos?: number;
}

export class ErrorDeDato extends Error {}

// Convierte un texto de dinero a centavos enteros sin pasar por decimales flotantes.
// "1.234.567,89" con separador ',' -> 123456789. Con decimalesImplicitos=2, "00000012345" -> 12345.
export function aCentavos(texto: string, separadorDecimal: ',' | '.' = ',', decimalesImplicitos?: number): number {
  let limpio = texto.trim().replace(/[$\s]/g, '').replace(/COP/i, '');
  let negativo = false;
  if (/^\(.*\)$/.test(limpio)) { negativo = true; limpio = limpio.slice(1, -1); }
  if (limpio.startsWith('-')) { negativo = true; limpio = limpio.slice(1); }
  else if (limpio.endsWith('-')) { negativo = true; limpio = limpio.slice(0, -1); }
  if (limpio.startsWith('+')) limpio = limpio.slice(1);

  let enteros: string;
  let decimales: string;
  if (decimalesImplicitos !== undefined) {
    if (!/^\d+$/.test(limpio)) throw new ErrorDeDato(`Monto inválido: "${texto}"`);
    const relleno = limpio.padStart(decimalesImplicitos + 1, '0');
    enteros = relleno.slice(0, relleno.length - decimalesImplicitos);
    decimales = relleno.slice(relleno.length - decimalesImplicitos);
  } else {
    const miles = separadorDecimal === ',' ? '.' : ',';
    const partes = limpio.split(miles).join('').split(separadorDecimal);
    if (partes.length > 2) throw new ErrorDeDato(`Monto inválido: "${texto}"`);
    [enteros, decimales = ''] = partes;
  }
  if (!/^\d+$/.test(enteros) || !/^\d*$/.test(decimales)) throw new ErrorDeDato(`Monto inválido: "${texto}"`);
  const centavos = Number(enteros) * 100 + Number((decimales + '00').slice(0, 2));
  if (!Number.isSafeInteger(centavos)) throw new ErrorDeDato(`Monto fuera de rango: "${texto}"`);
  return negativo ? -centavos : centavos;
}

// Referencias comparables: mayúsculas, sin tildes, solo letras y dígitos.
export function normalizarReferencia(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Lee una fecha con un patrón de dd, MM, yyyy (o yy) y la devuelve en ISO.
export function aFechaISO(texto: string, patron: string): string {
  const valor = texto.trim();
  const posicion = (marca: string) => patron.indexOf(marca);
  const tomar = (marca: string) => {
    const inicio = posicion(marca);
    return inicio < 0 ? '' : valor.slice(inicio, inicio + marca.length);
  };
  let anio = tomar('yyyy');
  if (!anio && posicion('yy') >= 0) anio = '20' + tomar('yy');
  const mes = tomar('MM');
  const dia = tomar('dd');
  if (valor.length < patron.length || !/^\d{4}$/.test(anio) || !/^\d{2}$/.test(mes) || !/^\d{2}$/.test(dia)) {
    throw new ErrorDeDato(`Fecha "${texto}" no cumple el formato ${patron}`);
  }
  const fecha = new Date(`${anio}-${mes}-${dia}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime()) || fecha.getUTCDate() !== Number(dia)) {
    throw new ErrorDeDato(`Fecha inexistente: "${texto}"`);
  }
  return `${anio}-${mes}-${dia}`;
}

export function diasEntre(fechaA: string, fechaB: string): number {
  const ms = Date.parse(`${fechaB}T00:00:00Z`) - Date.parse(`${fechaA}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function formatearCOP(centavos: number): string {
  const signo = centavos < 0 ? '-' : '';
  const absoluto = Math.abs(centavos);
  const pesos = Math.trunc(absoluto / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const resto = absoluto % 100;
  return `${signo}$${pesos}${resto ? ',' + String(resto).padStart(2, '0') : ''}`;
}
