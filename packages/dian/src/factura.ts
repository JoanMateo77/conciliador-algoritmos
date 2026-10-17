// Lectura de facturas electrónicas DIAN (UBL 2.1) como movimientos del lado 'ventas'.
// Así una factura B2B se cruza contra el abono del banco igual que una venta de pasarela.
import type { DocumentoFiscal, Movimiento } from '@conciliador/core';
import { aFechaISO, normalizarReferencia } from '@conciliador/core';
import type { ElementoXML } from './xml.ts';
import { analizarXML, atributo, descendientes, ErrorXML, hijo, hijos, ruta, textoDe } from './xml.ts';

export const NS = {
  invoice: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  creditNote: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
  debitNote: 'urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2',
  attached: 'urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
} as const;

// Id de "plantilla" con el que quedan marcados los movimientos que salen de una factura.
export const PLANTILLA_DIAN = 'dian-ubl-2.1';
export const VERSION_LECTOR_DIAN = 1;

// Código del tributo IVA en la tabla 13.2.6.1 del anexo técnico de la DIAN.
const CODIGO_IVA = '01';

const TIPOS: Record<string, { uri: string; tipo: DocumentoFiscal['tipo']; signo: number; nombre: string }> = {
  Invoice: { uri: NS.invoice, tipo: 'factura', signo: 1, nombre: 'Factura' },
  CreditNote: { uri: NS.creditNote, tipo: 'notaCredito', signo: -1, nombre: 'Nota crédito' },
  DebitNote: { uri: NS.debitNote, tipo: 'notaDebito', signo: 1, nombre: 'Nota débito' },
};

const cbc = (e: ElementoXML | undefined, local: string) => hijo(e, NS.cbc, local);
const cac = (e: ElementoXML | undefined, local: string) => hijo(e, NS.cac, local);

// "1234567.895" -> 123456790. Los montos UBL usan punto decimal y pueden traer más de 2
// decimales: se redondea al centavo (mitad hacia arriba) con aritmética de enteros.
export function montoUBL(texto: string): number | null {
  const m = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(texto.trim());
  if (!m) return null;
  const decimales = (m[3] ?? '').padEnd(3, '0');
  let centavos = Number(m[2]) * 100 + Number(decimales.slice(0, 2));
  if (Number(decimales[2]) >= 5) centavos += 1;
  if (!Number.isSafeInteger(centavos)) return null;
  return m[1] === '-' ? -centavos : centavos;
}

// NIT solo con dígitos y sin dígito de verificación (la DIAN lo manda en schemeID).
function nitDe(parte: ElementoXML | undefined): string {
  const party = cac(parte, 'Party');
  const candidatos = [
    cbc(cac(party, 'PartyTaxScheme'), 'CompanyID'),
    cbc(cac(party, 'PartyLegalEntity'), 'CompanyID'),
    cbc(cac(party, 'PartyIdentification'), 'ID'),
  ];
  for (const c of candidatos) {
    const nit = textoDe(c).replace(/[^0-9]/g, '');
    if (nit) return nit;
  }
  return '';
}

function nombreDe(parte: ElementoXML | undefined): string {
  const party = cac(parte, 'Party');
  return textoDe(cbc(cac(party, 'PartyTaxScheme'), 'RegistrationName'))
    || textoDe(cbc(cac(party, 'PartyLegalEntity'), 'RegistrationName'))
    || textoDe(cbc(cac(party, 'PartyName'), 'Name'));
}

// Busca el documento real dentro de un AttachedDocument: la factura viaja como texto
// (normalmente CDATA) en cac:Attachment/cac:ExternalReference/cbc:Description. La respuesta
// de validación de la DIAN viaja igual en ParentDocumentLineReference; se descarta por su raíz.
function desempacar(contenedor: ElementoXML): { raiz: ElementoXML | null; error?: string } {
  const preferido = ruta(contenedor, [[NS.cac, 'Attachment'], [NS.cac, 'ExternalReference'], [NS.cbc, 'Description']]);
  const candidatos = [preferido, ...descendientes(contenedor, NS.cbc, 'Description')];
  let ultimoError: string | undefined;
  for (const c of candidatos) {
    const texto = textoDe(c);
    if (!texto.startsWith('<')) continue;
    try {
      const interno = analizarXML(texto);
      if (TIPOS[interno.local]?.uri === interno.uri) return { raiz: interno };
    } catch (e) {
      ultimoError = e instanceof ErrorXML ? e.message : String(e);
    }
  }
  return {
    raiz: null,
    error: ultimoError
      ? `El AttachedDocument trae un XML interno mal formado: ${ultimoError}`
      : 'El AttachedDocument no trae una factura ni nota (Invoice, CreditNote o DebitNote) en cbc:Description',
  };
}

export function leerFacturaUBL(xml: string): { movimiento: Movimiento | null; errores: string[] } {
  let raiz: ElementoXML;
  try {
    raiz = analizarXML(xml);
  } catch (e) {
    if (e instanceof ErrorXML) return { movimiento: null, errores: [`XML mal formado: ${e.message}`] };
    throw e;
  }

  let envuelta = false;
  if (raiz.local === 'AttachedDocument' && raiz.uri === NS.attached) {
    const { raiz: interno, error } = desempacar(raiz);
    if (!interno) return { movimiento: null, errores: [error as string] };
    raiz = interno;
    envuelta = true;
  }

  const tipo = TIPOS[raiz.local];
  if (!tipo || tipo.uri !== raiz.uri) {
    return {
      movimiento: null,
      errores: [`Documento no reconocido <${raiz.nombre}> (${raiz.uri || 'sin namespace'}): se esperaba Invoice, CreditNote, DebitNote o AttachedDocument de UBL 2.1`],
    };
  }

  const errores: string[] = [];
  const numero = textoDe(cbc(raiz, 'ID'));
  const quien = numero ? `${tipo.nombre} ${numero}: ` : `${tipo.nombre}: `;
  const error = (m: string) => errores.push(quien + m);
  if (!numero) error('falta el número del documento (cbc:ID)');

  // CUFE para facturas, CUDE para notas; ambos son SHA-384 en hexadecimal (96 caracteres).
  const uuid = cbc(raiz, 'UUID');
  const cufe = textoDe(uuid).toLowerCase();
  const nombreCodigo = tipo.tipo === 'factura' ? 'CUFE' : 'CUDE';
  if (!cufe) error(`falta el ${nombreCodigo} (cbc:UUID)`);
  else if (!/^[0-9a-f]{96}$/.test(cufe)) error(`el ${nombreCodigo} "${textoDe(uuid)}" no es un SHA-384 válido (96 caracteres hexadecimales)`);

  const fecha = (local: string, obligatoria: boolean, contenedor: ElementoXML = raiz): string | undefined => {
    const valor = textoDe(cbc(contenedor, local));
    if (!valor) {
      if (obligatoria) error(`falta la fecha cbc:${local}`);
      return undefined;
    }
    try {
      return aFechaISO(valor, 'yyyy-MM-dd');
    } catch {
      error(`fecha cbc:${local} inválida "${valor}" (se espera aaaa-mm-dd)`);
      return undefined;
    }
  };
  const emision = fecha('IssueDate', true);
  // En facturas DIAN el vencimiento va en cbc:DueDate o en cac:PaymentMeans/cbc:PaymentDueDate.
  const vencimiento = fecha('DueDate', false) ?? fecha('PaymentDueDate', false, cac(raiz, 'PaymentMeans'));

  const nitEmisor = nitDe(cac(raiz, 'AccountingSupplierParty'));
  const nitAdquirente = nitDe(cac(raiz, 'AccountingCustomerParty'));
  if (!nitEmisor) error('falta el NIT del emisor (AccountingSupplierParty/.../cbc:CompanyID)');
  if (!nitAdquirente) error('falta el NIT del adquirente (AccountingCustomerParty/.../cbc:CompanyID)');
  const nombreAdquirente = nombreDe(cac(raiz, 'AccountingCustomerParty')) || undefined;

  const moneda = textoDe(cbc(raiz, 'DocumentCurrencyCode'));
  if (moneda && moneda !== 'COP') error(`moneda ${moneda} no soportada (solo COP)`);

  const monto = (e: ElementoXML | undefined, nombre: string): number | undefined => {
    if (!e) return undefined;
    const valor = montoUBL(textoDe(e));
    if (valor === null) { error(`monto ${nombre} inválido "${textoDe(e)}"`); return undefined; }
    const divisa = atributo(e, 'currencyID');
    if (divisa && divisa !== 'COP') { error(`monto ${nombre} en ${divisa}, solo se admite COP`); return undefined; }
    return valor;
  };

  // Las notas débito usan RequestedMonetaryTotal en lugar de LegalMonetaryTotal.
  const totales = cac(raiz, 'LegalMonetaryTotal') ?? cac(raiz, 'RequestedMonetaryTotal');
  const subtotal = monto(cbc(totales, 'LineExtensionAmount'), 'LineExtensionAmount');
  const pagar = monto(cbc(totales, 'PayableAmount'), 'PayableAmount');
  if (!totales || !cbc(totales, 'PayableAmount')) error('falta el total a pagar (LegalMonetaryTotal/cbc:PayableAmount)');

  // Solo los TaxTotal del documento (hijos directos), no los de cada línea, para no contar doble.
  let iva: number | undefined;
  for (const total of hijos(raiz, NS.cac, 'TaxTotal')) {
    for (const sub of hijos(total, NS.cac, 'TaxSubtotal')) {
      const codigo = textoDe(cbc(cac(cac(sub, 'TaxCategory'), 'TaxScheme'), 'ID'));
      if (codigo !== CODIGO_IVA) continue;
      iva = (iva ?? 0) + (monto(cbc(sub, 'TaxAmount'), 'IVA') ?? 0);
    }
  }
  // Retenciones (ReteFuente 06, ReteIVA 05, ReteICA 07): informativas, el comprador las descuenta al pagar.
  let retenciones: number | undefined;
  const detalleRetenciones: string[] = [];
  for (const total of hijos(raiz, NS.cac, 'WithholdingTaxTotal')) {
    const valor = monto(cbc(total, 'TaxAmount'), 'retención') ?? 0;
    retenciones = (retenciones ?? 0) + valor;
    const nombre = textoDe(cbc(cac(cac(cac(total, 'TaxSubtotal'), 'TaxCategory'), 'TaxScheme'), 'Name'));
    if (nombre) detalleRetenciones.push(nombre);
  }

  if (errores.length > 0 || !emision || pagar === undefined) return { movimiento: null, errores };

  const s = tipo.signo;
  const neg = (x: number | undefined) => (x === undefined ? undefined : s * x);
  const documento: DocumentoFiscal = {
    tipo: tipo.tipo, numero, cufe, nitEmisor, nitAdquirente,
    ...(nombreAdquirente !== undefined && { nombreAdquirente }),
    ...(vencimiento !== undefined && { fechaVencimiento: vencimiento }),
    ...(subtotal !== undefined && { subtotalCentavos: neg(subtotal) }),
    ...(iva !== undefined && { ivaCentavos: neg(iva) }),
    ...(retenciones !== undefined && { retencionesCentavos: neg(retenciones) }),
  };

  // Una nota crédito o débito dice a qué factura ajusta: va en la descripción para quien revisa.
  const ajusta = textoDe(cbc(ruta(raiz, [[NS.cac, 'BillingReference'], [NS.cac, 'InvoiceDocumentReference']]), 'ID'));
  const partes = [`${tipo.nombre} ${numero}`];
  if (ajusta) partes.push(`que ajusta ${ajusta}`);
  partes.push(`a ${nombreAdquirente ?? 'NIT ' + nitAdquirente}`);
  if (detalleRetenciones.length) partes.push(`(retenciones: ${detalleRetenciones.join(', ')})`);
  if (envuelta) partes.push('[AttachedDocument]');

  const movimiento: Movimiento = {
    id: numero,
    lado: 'ventas',
    fecha: emision,
    montoCentavos: s * pagar,
    referencia: normalizarReferencia(numero),
    descripcion: partes.join(' '),
    // Con retenciones en la factura, el cruce explica el faltante del pago "según el desglose".
    ...(retenciones ? { desglose: { brutoCentavos: s * pagar, retencionesCentavos: s * retenciones } } : {}),
    plantilla: PLANTILLA_DIAN,
    plantillaVersion: VERSION_LECTOR_DIAN,
    linea: 1,
    documento,
  };
  return { movimiento, errores: [] };
}

// Lee un lote de XML. Un documento malo no detiene a los demás; los repetidos (mismo CUFE
// o mismo número) se descartan con error porque el cruce exige ids únicos por lado.
export function leerFacturas(xmls: string[]): { movimientos: Movimiento[]; errores: { indice: number; mensaje: string }[] } {
  const movimientos: Movimiento[] = [];
  const errores: { indice: number; mensaje: string }[] = [];
  const porCufe = new Map<string, number>();
  const porId = new Map<string, number>();
  xmls.forEach((xml, indice) => {
    const r = leerFacturaUBL(xml);
    for (const mensaje of r.errores) errores.push({ indice, mensaje });
    const m = r.movimiento;
    if (!m || !m.documento) return;
    const previoCufe = porCufe.get(m.documento.cufe);
    if (previoCufe !== undefined) {
      errores.push({ indice, mensaje: `${m.id}: documento repetido (mismo CUFE que el #${previoCufe + 1}), se omite` });
      return;
    }
    const previoId = porId.get(m.id);
    if (previoId !== undefined) {
      errores.push({ indice, mensaje: `${m.id}: el número ya lo usa el documento #${previoId + 1} con otro CUFE, se omite` });
      return;
    }
    porCufe.set(m.documento.cufe, indice);
    porId.set(m.id, indice);
    // En un lote cada XML es un "archivo": linea = posición del documento (1 = primero).
    movimientos.push({ ...m, linea: indice + 1 });
  });
  return { movimientos, errores };
}
