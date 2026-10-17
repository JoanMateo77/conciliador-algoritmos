// Lector MT940 (extracto SWIFT). El archivo es una secuencia de campos ":NN:" y cada
// movimiento es un :61: seguido opcionalmente de su :86:. El lector separa cada
// movimiento en campos con nombre y la plantilla los mapea igual que a columnas:
//   FECHA (valor, o asiento si no hay), FECHA_VALOR, FECHA_ASIENTO (aaaa-mm-dd),
//   MARCA (C, D, RC, RD), MONTO (con signo y coma decimal), CODIGO (p. ej. NTRF),
//   REF_CLIENTE, REF_BANCO, DETALLE, REFERENCIA, DESCRIPCION (el :86:),
//   CUENTA (:25:), EXTRACTO (:20:), NUMERO_EXTRACTO (:28C:), MONEDA.
// Además verifica que saldo inicial + movimientos = saldo final (:60F: / :62F:).
import { aCentavos, aFechaISO, ErrorDeDato, formatearCOP } from '../modelo.ts';
import { quitarBOM } from './csv.ts';
import { leerRegistros } from './procesar.ts';
import type { ErrorDeLinea, LectorFormato, Plantilla, RegistroLeido, ResultadoLectura } from './tipos.ts';

interface Campo { etiqueta: string; lineas: string[]; linea: number }

// Ancho máximo de una línea SWIFT: si una línea del :86: lo llena, el banco cortó la
// palabra y la siguiente se pega sin espacio; si es más corta, el corte fue entre palabras.
const ANCHO_LINEA = 65;

// :61: = fecha valor AAMMDD, [fecha asiento MMDD], marca, [código de fondos], monto,
// tipo de transacción (1 letra + 3), referencia del cliente [//referencia del banco].
const RE_61 = /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?(\d+,\d*)([A-Z][A-Z0-9]{3})(.*)$/;
// :60F: / :62F: = marca C/D, fecha AAMMDD, moneda, monto.
const RE_SALDO = /^(C|D)(\d{6})([A-Z]{3})(\d+,\d*)$/;

function separarCampos(texto: string): Campo[] {
  const campos: Campo[] = [];
  quitarBOM(texto).split(/\r?\n/).forEach((l, i) => {
    const m = /^:(\d{2}[A-Z]?):(.*)$/.exec(l);
    if (m) { campos.push({ etiqueta: m[1], lineas: [m[2]], linea: i + 1 }); return; }
    // Sobre SWIFT ({1:...}{4:) y cierre (-}) no son datos.
    if (l.startsWith('{') || l.trim() === '-}' || l.trim() === '-' || l.trim() === '') return;
    campos.at(-1)?.lineas.push(l); // continuación del campo anterior
  });
  return campos;
}

function unirLineas(lineas: string[]): string {
  let r = '';
  for (const [i, l] of lineas.entries()) {
    if (i === 0) r = l;
    else r += (lineas[i - 1].length >= ANCHO_LINEA ? '' : ' ') + l;
  }
  return r.replace(/\s+/g, ' ').trim();
}

// MMDD con el año de la fecha valor; corrige el cruce de año (valor 31/12, asiento 02/01).
function fechaAsiento(mmdd: string, valorISO: string): string {
  let anio = Number(valorISO.slice(0, 4));
  const mesValor = Number(valorISO.slice(5, 7));
  const mes = Number(mmdd.slice(0, 2));
  if (mesValor === 12 && mes === 1) anio++;
  else if (mesValor === 1 && mes === 12) anio--;
  return aFechaISO(`${anio}${mmdd}`, 'yyyyMMdd');
}

const referenciaReal = (r: string) => (/^NONREF$/i.test(r.trim()) ? '' : r.trim());

// Si el :61: no trae referencia, se busca en el :86: (/EREF/x, /REF/x o "REF: x").
function referenciaDe86(texto: string): string {
  const m = /\/(?:EREF|REF)\/([^/\s]+)|\bREF[:.]?\s+([A-Z0-9][A-Z0-9-]*)/i.exec(texto);
  return m ? (m[1] ?? m[2]) : '';
}

export function registrosMT940(texto: string): { registros: RegistroLeido[]; errores: ErrorDeLinea[] } {
  const registros: RegistroLeido[] = [];
  const errores: ErrorDeLinea[] = [];
  let extracto = '';
  let cuenta = '';
  let numero = '';
  let moneda = '';
  let saldo: number | undefined; // saldo inicial + movimientos leídos, en centavos
  let pendiente: RegistroLeido | undefined;

  const cerrarPendiente = () => {
    if (pendiente) {
      const c = pendiente.campos;
      if (c.REFERENCIA === '') c.REFERENCIA = referenciaDe86(c.DESCRIPCION);
      registros.push(pendiente);
    }
    pendiente = undefined;
  };

  for (const campo of separarCampos(texto)) {
    const valor = campo.lineas[0].trim();
    try {
      switch (campo.etiqueta) {
        case '20':
          cerrarPendiente();
          extracto = valor; cuenta = ''; numero = ''; moneda = ''; saldo = undefined;
          break;
        case '25': cuenta = valor; break;
        case '28C': case '28': numero = valor; break;
        case '60F': case '60M': {
          cerrarPendiente();
          const m = RE_SALDO.exec(valor);
          if (!m) throw new ErrorDeDato(`saldo inicial :${campo.etiqueta}: mal formado: "${valor}"`);
          moneda = m[3];
          saldo = (m[1] === 'D' ? -1 : 1) * aCentavos(m[4], ',');
          break;
        }
        case '61': {
          cerrarPendiente();
          const m = RE_61.exec(valor);
          if (!m) throw new ErrorDeDato(`movimiento :61: mal formado: "${valor}"`);
          const [, aammdd, mmdd, marca, , monto, codigo, resto] = m;
          const fechaValor = aFechaISO(aammdd, 'yyMMdd');
          const asiento = mmdd ? fechaAsiento(mmdd, fechaValor) : '';
          // RC (reverso de crédito) saca dinero; RD (reverso de débito) lo devuelve.
          const negativo = marca === 'D' || marca === 'RC';
          const centavos = aCentavos(monto, ',');
          if (saldo !== undefined) saldo += negativo ? -centavos : centavos;
          const [refCliente, refBanco = ''] = resto.split('//');
          const detalle = campo.lineas.slice(1).join(' ').trim();
          pendiente = {
            linea: campo.linea,
            campos: {
              FECHA: fechaValor || asiento,
              FECHA_VALOR: fechaValor,
              FECHA_ASIENTO: asiento,
              MARCA: marca,
              MONTO: (negativo ? '-' : '') + monto,
              CODIGO: codigo,
              REF_CLIENTE: refCliente.trim(),
              REF_BANCO: refBanco.trim(),
              DETALLE: detalle,
              REFERENCIA: referenciaReal(refCliente),
              DESCRIPCION: '',
              CUENTA: cuenta,
              EXTRACTO: extracto,
              NUMERO_EXTRACTO: numero,
              MONEDA: moneda,
            },
          };
          break;
        }
        case '86':
          // Solo describe el :61: inmediatamente anterior; un :86: suelto (información del extracto) se ignora.
          if (pendiente && pendiente.campos.DESCRIPCION === '') pendiente.campos.DESCRIPCION = unirLineas(campo.lineas);
          break;
        case '62F': case '62M': {
          cerrarPendiente();
          const m = RE_SALDO.exec(valor);
          if (!m) throw new ErrorDeDato(`saldo final :${campo.etiqueta}: mal formado: "${valor}"`);
          const final = (m[1] === 'D' ? -1 : 1) * aCentavos(m[4], ',');
          if (saldo !== undefined && saldo !== final) {
            throw new ErrorDeDato(`el saldo final (${formatearCOP(final)}) no cuadra con saldo inicial + movimientos (${formatearCOP(saldo)}): puede faltar un movimiento`);
          }
          saldo = final; // un :62M: intermedio sigue en el :60M: siguiente
          break;
        }
        default:
          cerrarPendiente();
      }
    } catch (e) {
      if (!(e instanceof ErrorDeDato)) throw e;
      // Con un :61: ilegible el saldo ya no se puede verificar: se evita un segundo error engañoso.
      if (campo.etiqueta === '61') saldo = undefined;
      errores.push({ linea: campo.linea, mensaje: e.message });
    }
  }
  cerrarPendiente();
  return { registros, errores };
}

export function leerMT940(texto: string, plantilla: Plantilla): ResultadoLectura {
  const { registros, errores } = registrosMT940(texto);
  if (registros.length === 0 && errores.length === 0) {
    return { movimientos: [], errores: [{ linea: 0, mensaje: 'el archivo no tiene movimientos :61: de MT940' }] };
  }
  const r = leerRegistros(registros, plantilla);
  return { movimientos: r.movimientos, errores: [...errores, ...r.errores].sort((a, b) => a.linea - b.linea) };
}

// Un MT940 se reconoce por traer :20: y :61: al inicio de línea.
export function detectarMT940(texto: string): number {
  const tiene20 = /^:20:/m.test(texto);
  const tiene61 = /^:61:/m.test(texto);
  return tiene20 && tiene61 ? 1 : tiene20 && /^:60[FM]:/m.test(texto) ? 0.6 : 0;
}

export const LECTOR_MT940: LectorFormato = { tipo: 'mt940', leer: leerMT940, detectar: detectarMT940 };
