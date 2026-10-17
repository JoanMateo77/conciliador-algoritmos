import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import type { Movimiento, Perfil } from '@conciliador/core';
import { conciliar, leerArchivo, PERFIL_POR_DEFECTO } from '@conciliador/core';
import { PLANTILLAS } from '@conciliador/plantillas';
import {
  analizarXML, atributo, descendientes, ErrorXML, hijo, leerFacturas, leerFacturaUBL, montoUBL, MUESTRAS_DIAN,
  FACTURAS_MUESTRA, PAGOS_B2B_MUESTRA, NS, PLANTILLA_DIAN, textoDe,
} from '../src/index.ts';

const carpeta = new URL('../muestras/', import.meta.url);
const leer = (nombre: string) => readFileSync(new URL(nombre, carpeta), 'utf8');

// Factura mínima válida para las pruebas de errores; cada prueba le quita o daña una parte.
const CUFE = 'a'.repeat(96);
function facturaMinima(cambios: { uuid?: string | null; raiz?: string; pagar?: string; extra?: string } = {}): string {
  const raiz = cambios.raiz ?? 'Invoice';
  const uuid = cambios.uuid === null ? '' : `<cbc:UUID schemeName="CUFE-SHA384">${cambios.uuid ?? CUFE}</cbc:UUID>`;
  return `<?xml version="1.0"?>
<${raiz} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${raiz}-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>PRU1</cbc:ID>${uuid}
  <cbc:IssueDate>2026-10-01</cbc:IssueDate>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID schemeID="1">900000001</cbc:CompanyID></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party><cac:PartyLegalEntity><cbc:CompanyID>900.000.002</cbc:CompanyID></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>
  ${cambios.extra ?? ''}
  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="COP">${cambios.pagar ?? '1190.00'}</cbc:PayableAmount></cac:LegalMonetaryTotal>
</${raiz}>`;
}

describe('analizarXML', () => {
  test('namespaces: compara por URI aunque cambie el prefijo o se use namespace por defecto', () => {
    const a = analizarXML('<x:R xmlns:x="urn:r" xmlns:b="urn:b"><b:Hijo b:at="1" at="2">uno</b:Hijo></x:R>');
    const b = analizarXML('<R xmlns="urn:r"><Hijo xmlns="urn:b" at="2">uno</Hijo></R>');
    for (const r of [a, b]) {
      assert.equal(r.uri, 'urn:r');
      assert.equal(r.local, 'R');
      const h = hijo(r, 'urn:b', 'Hijo');
      assert.equal(textoDe(h), 'uno');
      assert.equal(atributo(h, 'at'), '2'); // atributo sin prefijo: sin namespace
    }
    assert.equal(atributo(hijo(a, 'urn:b', 'Hijo'), 'at', 'urn:b'), '1');
  });

  test('entidades predefinidas, numéricas, CDATA y comentarios', () => {
    const r = analizarXML('<?xml version="1.0"?><!-- c --><a t="&quot;x&quot; &amp; &#39;y&#x27;">&lt;b&gt; &amp; &#233;<![CDATA[<no>&amp;]]><!-- fuera --></a>');
    assert.equal(atributo(r, 't'), `"x" & 'y'`);
    assert.equal(r.texto, '<b> & é<no>&amp;');
  });

  test('descendientes en orden de documento', () => {
    const r = analizarXML('<a><b n="1"><b n="2"/></b><c><b n="3"/></c></a>');
    assert.deepEqual(descendientes(r, '', 'b').map((e) => atributo(e, 'n')), ['1', '2', '3']);
  });

  const malos: [string, RegExp][] = [
    ['<a><b></a>', /Se esperaba <\/b> y llegó <\/a>/],
    ['<a>', /<a> sin cerrar/],
    ['<a>&nbsp;</a>', /Entidad desconocida "&nbsp;"/],
    ['<a>x & y</a>', /"&" sin cerrar/],
    ['<p:a/>', /Prefijo de namespace no declarado "p"/],
    ['<a x="1" x="2"/>', /Atributo repetido/],
    ['<a/><b/>', /Solo puede haber un elemento raíz/],
    ['<!DOCTYPE a [<!ENTITY e "x">]><a/>', /DOCTYPE/],
    ['<a><![CDATA[x</a>', /CDATA sin cerrar/],
    ['', /no tiene elemento raíz/],
    ['<a x=1/>', /entre comillas/],
  ];
  for (const [xml, error] of malos) {
    test(`rechaza con mensaje claro: ${JSON.stringify(xml)}`, () => {
      assert.throws(() => analizarXML(xml), (e: unknown) => e instanceof ErrorXML && error.test(e.message) && /línea \d+, columna \d+/.test(e.message));
    });
  }

  test('ubica el error en línea y columna', () => {
    try {
      analizarXML('<a>\n  <b>\n  </c>\n</a>');
      assert.fail('debía fallar');
    } catch (e) {
      assert.ok(e instanceof ErrorXML);
      assert.equal(e.linea, 3);
      assert.equal(e.columna, 3);
    }
  });
});

describe('montoUBL', () => {
  test('punto decimal, sin decimales, más de 2 decimales con redondeo y negativos', () => {
    assert.equal(montoUBL('2975000.00'), 297500000);
    assert.equal(montoUBL('15'), 1500);
    assert.equal(montoUBL('10.5'), 1050);
    assert.equal(montoUBL('0.125'), 13);
    assert.equal(montoUBL('0.124'), 12);
    assert.equal(montoUBL('-238000.00'), -23800000);
    assert.equal(montoUBL('1.234,00'), null);
    assert.equal(montoUBL(''), null);
  });
});

describe('leerFacturaUBL con las muestras', () => {
  const esperado: Record<string, { tipo: string; monto: number; subtotal: number; iva: number; retenciones?: number; nitAdquirente: string; fecha: string; vence?: string }> = {
    'factura-LCE1001.xml': { tipo: 'factura', monto: 297500000, subtotal: 250000000, iva: 47500000, retenciones: 8665000, nitAdquirente: '901223344', fecha: '2026-10-01', vence: '2026-10-31' },
    'attached-LCE1002.xml': { tipo: 'factura', monto: 499800000, subtotal: 420000000, iva: 79800000, retenciones: 16800000, nitAdquirente: '900334455', fecha: '2026-10-05', vence: '2026-11-04' },
    'factura-LCE1003.xml': { tipo: 'factura', monto: 101150000, subtotal: 85000000, iva: 16150000, nitAdquirente: '900556677', fecha: '2026-10-08', vence: '2026-10-23' },
    'factura-LCE1004.xml': { tipo: 'factura', monto: 190400000, subtotal: 160000000, iva: 30400000, retenciones: 5545600, nitAdquirente: '860778899', fecha: '2026-10-09', vence: '2026-11-08' },
    'factura-LCE1005.xml': { tipo: 'factura', monto: 368900000, subtotal: 310000000, iva: 58900000, retenciones: 10744600, nitAdquirente: '901889900', fecha: '2026-10-13', vence: '2026-11-12' },
    'factura-LCE1006.xml': { tipo: 'factura', monto: 142800000, subtotal: 120000000, iva: 22800000, nitAdquirente: '901223344', fecha: '2026-10-15', vence: '2026-11-14' },
    'nota-credito-NCL21.xml': { tipo: 'notaCredito', monto: -23800000, subtotal: -20000000, iva: -3800000, nitAdquirente: '901223344', fecha: '2026-10-20' },
  };

  for (const [archivo, e] of Object.entries(esperado)) {
    test(archivo, () => {
      const { movimiento: m, errores } = leerFacturaUBL(leer(archivo));
      assert.deepEqual(errores, []);
      assert.ok(m && m.documento);
      const numero = archivo.replace(/^.*-(\w+)\.xml$/, '$1');
      assert.equal(m.id, numero);
      assert.equal(m.referencia, numero);
      assert.equal(m.lado, 'ventas');
      assert.equal(m.fecha, e.fecha);
      assert.equal(m.montoCentavos, e.monto);
      assert.equal(m.plantilla, PLANTILLA_DIAN);
      assert.equal(m.plantillaVersion, 1);
      const d = m.documento;
      assert.equal(d.tipo, e.tipo);
      assert.equal(d.numero, numero);
      assert.match(d.cufe, /^[0-9a-f]{96}$/);
      assert.equal(d.nitEmisor, '900456789');
      assert.equal(d.nitAdquirente, e.nitAdquirente);
      assert.equal(d.subtotalCentavos, e.subtotal);
      assert.equal(d.ivaCentavos, e.iva); // solo el TaxTotal del documento, no los de cada línea
      assert.equal(d.retencionesCentavos, e.retenciones);
      assert.equal(d.fechaVencimiento, e.vence);
      if (e.retenciones) assert.deepEqual(m.desglose, { brutoCentavos: e.monto, retencionesCentavos: e.retenciones });
      else assert.equal(m.desglose, undefined);
    });
  }

  test('decodifica entidades en nombres (Hotel Mirador del Valle & Spa) y saca la factura del AttachedDocument', () => {
    const { movimiento } = leerFacturaUBL(leer('attached-LCE1002.xml'));
    assert.equal(movimiento?.documento?.nombreAdquirente, 'Hotel Mirador del Valle & Spa S.A.S.');
    assert.match(movimiento?.descripcion ?? '', /AttachedDocument/);
    // El CUFE del contenedor coincide con el de la factura que lleva adentro.
    const contenedor = analizarXML(leer('attached-LCE1002.xml'));
    const uuids = descendientes(contenedor, NS.cbc, 'UUID').map(textoDe);
    assert.ok(uuids.includes(movimiento?.documento?.cufe ?? ''));
  });

  test('la nota crédito dice qué factura ajusta', () => {
    const { movimiento } = leerFacturaUBL(leer('nota-credito-NCL21.xml'));
    assert.match(movimiento?.descripcion ?? '', /Nota crédito NCL21 que ajusta LCE1006/);
  });
});

describe('leerFacturaUBL: errores claros', () => {
  test('la factura mínima es válida (control)', () => {
    const r = leerFacturaUBL(facturaMinima());
    assert.deepEqual(r.errores, []);
    assert.equal(r.movimiento?.montoCentavos, 119000);
    assert.equal(r.movimiento?.documento?.nitAdquirente, '900000002');
  });

  test('XML mal formado', () => {
    const r = leerFacturaUBL(facturaMinima().replace('</cbc:ID>', '</cbc:Id>'));
    assert.equal(r.movimiento, null);
    assert.equal(r.errores.length, 1);
    assert.match(r.errores[0], /^XML mal formado: Se esperaba <\/cbc:ID> y llegó <\/cbc:Id> \(línea 5, columna \d+\)$/);
  });

  test('sin CUFE', () => {
    const r = leerFacturaUBL(facturaMinima({ uuid: null }));
    assert.equal(r.movimiento, null);
    assert.deepEqual(r.errores, ['Factura PRU1: falta el CUFE (cbc:UUID)']);
  });

  test('CUFE que no es SHA-384', () => {
    const r = leerFacturaUBL(facturaMinima({ uuid: 'abc123' }));
    assert.match(r.errores[0], /CUFE "abc123" no es un SHA-384 válido/);
  });

  test('sin total a pagar y con monto inválido', () => {
    assert.match(leerFacturaUBL(facturaMinima({ pagar: '1.190,00' })).errores.join(), /monto PayableAmount inválido "1.190,00"/);
    const sinTotal = facturaMinima().replace(/<cac:LegalMonetaryTotal>.*<\/cac:LegalMonetaryTotal>/, '');
    assert.deepEqual(leerFacturaUBL(sinTotal).errores, ['Factura PRU1: falta el total a pagar (LegalMonetaryTotal/cbc:PayableAmount)']);
  });

  test('documento que no es UBL de factura', () => {
    const r = leerFacturaUBL('<Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2"/>');
    assert.match(r.errores[0], /Documento no reconocido <Order>/);
  });

  test('AttachedDocument sin factura adentro, o con factura mal formada', () => {
    const vacio = `<AttachedDocument xmlns="${NS.attached}" xmlns:cbc="${NS.cbc}"><cbc:ID>X</cbc:ID></AttachedDocument>`;
    assert.match(leerFacturaUBL(vacio).errores[0], /no trae una factura/);
    const roto = `<AttachedDocument xmlns="${NS.attached}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}"><cac:Attachment><cac:ExternalReference><cbc:Description><![CDATA[<Invoice><cbc:ID>]]></cbc:Description></cac:ExternalReference></cac:Attachment></AttachedDocument>`;
    assert.match(leerFacturaUBL(roto).errores[0], /XML interno mal formado/);
  });

  test('suma retenciones de varios WithholdingTaxTotal y no confunde el IVA con otros tributos', () => {
    const extra = `<cac:TaxTotal><cbc:TaxAmount currencyID="COP">190.00</cbc:TaxAmount>
      <cac:TaxSubtotal><cbc:TaxAmount currencyID="COP">190.00</cbc:TaxAmount><cac:TaxCategory><cac:TaxScheme><cbc:ID>01</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
      <cac:TaxTotal><cbc:TaxAmount currencyID="COP">80.00</cbc:TaxAmount>
      <cac:TaxSubtotal><cbc:TaxAmount currencyID="COP">80.00</cbc:TaxAmount><cac:TaxCategory><cac:TaxScheme><cbc:ID>04</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
      <cac:WithholdingTaxTotal><cbc:TaxAmount currencyID="COP">25.00</cbc:TaxAmount></cac:WithholdingTaxTotal>
      <cac:WithholdingTaxTotal><cbc:TaxAmount currencyID="COP">9.66</cbc:TaxAmount></cac:WithholdingTaxTotal>`;
    const d = leerFacturaUBL(facturaMinima({ extra })).movimiento?.documento;
    assert.equal(d?.ivaCentavos, 19000);
    assert.equal(d?.retencionesCentavos, 3466);
  });
});

describe('leerFacturas', () => {
  test('lee el lote de muestras y sigue aunque un documento falle', () => {
    const r = leerFacturas([...FACTURAS_MUESTRA, '<roto>', facturaMinima({ uuid: null })]);
    assert.equal(r.movimientos.length, 7);
    assert.deepEqual(r.errores.map((e) => e.indice), [7, 8]);
    assert.match(r.errores[0].mensaje, /XML mal formado/);
    assert.match(r.errores[1].mensaje, /falta el CUFE/);
  });

  test('descarta documentos repetidos (mismo CUFE o mismo número)', () => {
    const otraConMismoNumero = facturaMinima({ uuid: 'b'.repeat(96) });
    const r = leerFacturas([facturaMinima(), facturaMinima(), otraConMismoNumero]);
    assert.equal(r.movimientos.length, 1);
    assert.match(r.errores[0].mensaje, /mismo CUFE/);
    assert.match(r.errores[1].mensaje, /otro CUFE/);
  });
});

describe('muestras', () => {
  test('MUESTRAS_DIAN es idéntico a los archivos de muestras/ y no falta ninguno', () => {
    for (const m of MUESTRAS_DIAN) assert.equal(m.texto, leer(m.archivo), `src/muestras.ts desactualizado para ${m.archivo}`);
    const archivos = readdirSync(carpeta).filter((f) => /\.(xml|csv)$/.test(f)).sort();
    assert.deepEqual(MUESTRAS_DIAN.map((m) => m.archivo).sort(), archivos);
  });
});

describe('punta a punta: facturas DIAN + pagos B2B', () => {
  // Pagos B2B: el cliente paga el total menos ReteFuente (2,5 % o 4 % del subtotal) y ReteICA.
  // Frente al total con IVA eso es hasta ~4,2 %, y el pago llega hasta 30 días después.
  const perfil: Perfil = {
    ...PERFIL_POR_DEFECTO,
    id: 'b2b-retenciones',
    nombre: 'Clientes empresariales con retenciones',
    toleranciaFaltantePorcentaje: 0.06,
    ventanaDias: 45,
    diasDespues: 0,
    retenciones: [
      { nombre: 'ReteFuente compras', tasa: 0.025 },
      { nombre: 'ReteFuente servicios', tasa: 0.04 },
      { nombre: 'ReteICA', tasa: 0.00966 },
    ],
  };
  const plantilla = PLANTILLAS.find((p) => p.id === 'banco-csv-generico');
  assert.ok(plantilla);
  const banco = leerArchivo(PAGOS_B2B_MUESTRA, plantilla);
  const facturas = leerFacturas(FACTURAS_MUESTRA);
  const resultado = conciliar(banco.movimientos, facturas.movimientos, perfil);
  const porReferencia = (ref: string) => banco.movimientos.find((m) => m.referencia === ref) as Movimiento;
  const coincidenciaDe = (facturaId: string) => resultado.coincidencias.find((c) => c.ventasIds.includes(facturaId));

  test('el extracto se lee sin errores: 6 abonos (sin saldo, total ni GMF)', () => {
    assert.deepEqual(banco.errores, []);
    assert.deepEqual(facturas.errores, []);
    assert.equal(banco.movimientos.length, 6);
  });

  test('pago por el total: cruce exacto con la factura', () => {
    const c = coincidenciaDe('LCE1003');
    assert.equal(c?.tipo, 'exacta');
    assert.deepEqual(c?.bancoIds, [porReferencia('LCE1003').id]);
    assert.equal(c?.diferenciaCentavos, 0);
  });

  const netos: [string, number][] = [['LCE1001', 8665000], ['LCE1002', 16800000], ['LCE1004', 5545600], ['LCE1005', 10744600]];
  for (const [factura, retenciones] of netos) {
    test(`pago neto de retenciones cruza con ${factura} y la explicación las menciona`, () => {
      const c = coincidenciaDe(factura);
      assert.ok(c, `${factura} no cruzó`);
      assert.equal(c.tipo, 'tolerancia');
      assert.deepEqual(c.ventasIds, [factura]);
      assert.equal(c.diferenciaCentavos, -retenciones);
      assert.match(c.explicacion, /retenciones/i);
      const pago = banco.movimientos.find((m) => m.id === c.bancoIds[0]);
      assert.equal(pago?.montoCentavos, facturas.movimientos.find((f) => f.id === factura)!.montoCentavos - retenciones);
    });
  }

  test('lo pendiente queda sin cruzar: factura LCE1006 sin pagar, su nota crédito y un abono ajeno', () => {
    assert.deepEqual(resultado.sinCruzarVentas.slice().sort(), ['LCE1006', 'NCL21']);
    assert.deepEqual(resultado.sinCruzarBanco, [porReferencia('PED2026301145').id]);
    assert.equal(resultado.coincidencias.length, 5);
  });
});
