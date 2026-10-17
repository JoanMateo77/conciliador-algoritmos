// Lector camt.053 (extracto ISO 20022 en XML). Cada <Ntry> es un movimiento. El lector
// lo separa en campos con nombre y la plantilla los mapea igual que a columnas:
//   FECHA (valor, o asiento si no hay), FECHA_VALOR, FECHA_ASIENTO (aaaa-mm-dd),
//   MARCA (CRDT, DBIT), REVERSO (true/false), MONTO (con signo, punto decimal), MONEDA,
//   ESTADO (BOOK, PDNG, INFO), REFERENCIA (EndToEndId o referencia estructurada),
//   END_TO_END, REF_BANCO (AcctSvcrRef), DESCRIPCION (RmtInf/Ustrd unidos o AddtlNtryInf),
//   ORDENANTE, CODIGO (BkTxCd), CUENTA, EXTRACTO.
// Además verifica saldo de apertura (OPBD) + movimientos = saldo de cierre (CLBD).
import { aCentavos, ErrorDeDato, formatearCOP } from '../modelo.ts';
import { leerRegistros } from './procesar.ts';
import type { ErrorDeLinea, LectorFormato, Plantilla, RegistroLeido, ResultadoLectura } from './tipos.ts';
import { analizarXML, atributoXML, buscar, buscarTodos, ErrorXML, textoEn } from './xml.ts';
import type { ElementoXML } from './xml.ts';

const NS_CAMT053 = 'urn:iso:std:iso:20022:tech:xsd:camt.053';

// <Dt>2026-10-01</Dt> o <DtTm>2026-10-01T09:00:00-05:00</DtTm>: interesa el día.
function fechaDe(nodo: ElementoXML | undefined): string {
  const t = textoEn(nodo, 'Dt') || textoEn(nodo, 'DtTm');
  if (t === '') return '';
  if (!/^\d{4}-\d{2}-\d{2}/.test(t)) throw new ErrorDeDato(`fecha inválida: "${t}"`);
  return t.slice(0, 10);
}

const sinNotProvided = (r: string) => (/^NOTPROVIDED$/i.test(r) ? '' : r);

// Saldo con signo en centavos; el tipo va en Tp/CdOrPrtry/Cd (OPBD, CLBD...).
function saldoDe(stmt: ElementoXML, codigo: string): number | undefined {
  const bal = buscarTodos(stmt, 'Bal').find((b) => textoEn(b, 'Tp/CdOrPrtry/Cd') === codigo);
  if (!bal) return undefined;
  const centavos = aCentavos(textoEn(bal, 'Amt'), '.');
  return textoEn(bal, 'CdtDbtInd') === 'DBIT' ? -centavos : centavos;
}

function registroDeEntrada(ntry: ElementoXML, cuenta: string, extracto: string): RegistroLeido {
  const monto = textoEn(ntry, 'Amt');
  if (monto === '') throw new ErrorDeDato('Ntry sin Amt');
  const marca = textoEn(ntry, 'CdtDbtInd');
  if (marca !== 'CRDT' && marca !== 'DBIT') throw new ErrorDeDato(`CdtDbtInd debe ser CRDT o DBIT, llegó "${marca}"`);
  const reverso = textoEn(ntry, 'RvslInd') === 'true';
  // Un reverso invierte el sentido: un CRDT reversado saca dinero.
  const negativo = (marca === 'DBIT') !== reverso;
  const asiento = fechaDe(buscar(ntry, 'BookgDt'));
  const valor = fechaDe(buscar(ntry, 'ValDt'));

  const transacciones = buscarTodos(ntry, 'NtryDtls/TxDtls');
  const tx = transacciones[0];
  const endToEnd = sinNotProvided(textoEn(tx, 'Refs/EndToEndId'));
  const refEstructurada = textoEn(tx, 'RmtInf/Strd/CdtrRefInf/Ref');
  const ustrd = transacciones.flatMap((t) => buscarTodos(t, 'RmtInf/Ustrd')).map((n) => n.texto.trim()).filter((t) => t !== '');
  const estado = textoEn(ntry, 'Sts/Cd') || textoEn(ntry, 'Sts');

  return {
    linea: ntry.linea,
    campos: {
      FECHA: valor || asiento,
      FECHA_VALOR: valor,
      FECHA_ASIENTO: asiento,
      MARCA: marca,
      REVERSO: String(reverso),
      MONTO: (negativo ? '-' : '') + monto,
      MONEDA: atributoXML(buscar(ntry, 'Amt'), 'Ccy') ?? '',
      ESTADO: estado,
      REFERENCIA: endToEnd || refEstructurada,
      END_TO_END: endToEnd,
      REF_BANCO: textoEn(ntry, 'AcctSvcrRef') || textoEn(tx, 'Refs/AcctSvcrRef'),
      DESCRIPCION: (ustrd.join(' ') || textoEn(ntry, 'AddtlNtryInf') || textoEn(tx, 'AddtlTxInf')).replace(/\s+/g, ' '),
      ORDENANTE: textoEn(tx, 'RltdPties/Dbtr/Nm') || textoEn(tx, 'RltdPties/Dbtr/Pty/Nm'),
      CODIGO: textoEn(ntry, 'BkTxCd/Prtry/Cd') || textoEn(ntry, 'BkTxCd/Domn/Fmly/SubFmlyCd'),
      CUENTA: cuenta,
      EXTRACTO: extracto,
    },
  };
}

export function registrosCamt053(texto: string): { registros: RegistroLeido[]; errores: ErrorDeLinea[] } {
  const registros: RegistroLeido[] = [];
  const errores: ErrorDeLinea[] = [];
  let raiz: ElementoXML;
  try {
    raiz = analizarXML(texto);
  } catch (e) {
    if (e instanceof ErrorXML) return { registros, errores: [{ linea: e.linea, mensaje: `XML inválido: ${e.message}` }] };
    throw e;
  }
  const extractos = buscarTodos(raiz, 'BkToCstmrStmt/Stmt');
  if (extractos.length === 0) {
    return { registros, errores: [{ linea: raiz.linea, mensaje: 'no es un camt.053: falta Document/BkToCstmrStmt/Stmt' }] };
  }

  for (const stmt of extractos) {
    const cuenta = textoEn(stmt, 'Acct/Id/IBAN') || textoEn(stmt, 'Acct/Id/Othr/Id');
    const extracto = textoEn(stmt, 'Id');
    let suma = 0;
    let sumaValida = true;
    for (const ntry of buscarTodos(stmt, 'Ntry')) {
      try {
        const r = registroDeEntrada(ntry, cuenta, extracto);
        // Solo los asentados mueven el saldo; los pendientes (PDNG) e informativos no.
        if (r.campos.ESTADO === '' || r.campos.ESTADO === 'BOOK') suma += aCentavos(r.campos.MONTO, '.');
        registros.push(r);
      } catch (e) {
        if (!(e instanceof ErrorDeDato)) throw e;
        sumaValida = false;
        errores.push({ linea: ntry.linea, mensaje: e.message });
      }
    }
    try {
      const apertura = saldoDe(stmt, 'OPBD');
      const cierre = saldoDe(stmt, 'CLBD');
      if (sumaValida && apertura !== undefined && cierre !== undefined && apertura + suma !== cierre) {
        errores.push({
          linea: stmt.linea,
          mensaje: `el saldo de cierre (${formatearCOP(cierre)}) no cuadra con apertura + movimientos (${formatearCOP(apertura + suma)}): puede faltar un movimiento`,
        });
      }
    } catch (e) {
      if (!(e instanceof ErrorDeDato)) throw e;
      errores.push({ linea: stmt.linea, mensaje: `saldo: ${e.message}` });
    }
  }
  return { registros, errores };
}

export function leerCamt053(texto: string, plantilla: Plantilla): ResultadoLectura {
  const { registros, errores } = registrosCamt053(texto);
  const r = leerRegistros(registros, plantilla);
  return { movimientos: r.movimientos, errores: [...errores, ...r.errores].sort((a, b) => a.linea - b.linea) };
}

// El espacio de nombres camt.053 es inequívoco; sin él, la estructura sola da una pista.
export function detectarCamt053(texto: string): number {
  if (texto.includes(NS_CAMT053)) return 1;
  return /<(\w+:)?BkToCstmrStmt[\s>]/.test(texto) ? 0.6 : 0;
}

export const LECTOR_CAMT053: LectorFormato = { tipo: 'camt053', leer: leerCamt053, detectar: detectarCamt053 };
