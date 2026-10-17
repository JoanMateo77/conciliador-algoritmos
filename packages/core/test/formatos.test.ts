// Fase 9: lectores registrables (MT940, camt.053), versión de plantilla en cada
// movimiento y columna opcional REFERENCIA PAGO (Bre-B).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  leerArchivo, validarPlantilla, RegistroPlantillas, registrarLector, obtenerLector, leerRegistros,
  registrosMT940, registrosCamt053, procesarArchivos, conciliar,
} from '../src/index.ts';
import type { Movimiento, Plantilla, LectorFormato } from '../src/index.ts';
import { analizarXML as parsearXML, atributoXML, buscarTodos, ErrorXML, textoEn } from '../src/plantillas/xml.ts';
import { PLANTILLAS, MUESTRAS } from '../../plantillas/index.ts';

const plantilla = (id: string) => PLANTILLAS.find((p) => p.id === id)!;
const muestra = (id: string) => MUESTRAS.find((m) => m.id === id)!;
const leerMuestra = (id: string) => {
  const m = muestra(id);
  return leerArchivo(m.texto, plantilla(m.plantillaId));
};
// Lo que importa para conciliar, sin id ni línea (que dependen del formato).
const esencia = (ms: Movimiento[]) => ms.map((m) => [m.fecha, m.montoCentavos, m.referencia, m.descripcion]);

function registroCompleto(): RegistroPlantillas {
  const r = new RegistroPlantillas();
  for (const p of PLANTILLAS) r.registrar(p);
  return r;
}

const MT940 = plantilla('mt940-generico');
const CAMT = plantilla('camt053-generico');

describe('plantillaVersion', () => {
  test('todo movimiento leído lleva la versión de su plantilla, en todos los tipos', () => {
    for (const m of MUESTRAS) {
      const p = plantilla(m.plantillaId);
      const r = leerArchivo(m.texto, { ...p, version: 7 });
      assert.ok(r.movimientos.length > 0, m.id);
      assert.ok(r.movimientos.every((x) => x.plantillaVersion === 7), m.id);
    }
  });
});

describe('MT940', () => {
  test('la muestra da los mismos abonos que extracto-banco.csv', () => {
    const csv = leerMuestra('extracto-banco');
    const mt = leerMuestra('extracto-banco-mt940');
    assert.deepEqual(mt.errores, []);
    assert.equal(mt.movimientos.length, 14);
    assert.deepEqual(esencia(mt.movimientos), esencia(csv.movimientos));
    // :86: en dos líneas cortas se une con espacio.
    assert.ok(mt.movimientos.some((x) => x.descripcion === 'LIQUIDACION WOMPI; LOTE 3 TRX'));
    assert.ok(mt.movimientos.every((x) => x.plantilla === 'mt940-generico' && x.id === `mt940-generico:${x.linea}`));
  });

  test('campos del :61:: fechas, marcas, código, referencias y detalle', () => {
    const texto = [
      '{1:F01BANCOXXXAXXX0000000000}{2:I940BANCOXXXXXXXN}{4:',
      ':20:PRUEBA',
      ':25:CUENTA-1',
      ':28C:5/1',
      ':60F:C261230COP1000,00',
      ':61:2612310102C100,50NTRFREF-1//BANCO-1',
      'DETALLE ADICIONAL',
      ':86:PRIMERA',
      ':61:261231RC0,50NMSCNONREF',
      ':86:REVERSO REF: ABC-9',
      ':61:261231D10,NCHGNONREF',
      ':61:261231RD10,NCHGX',
      ':62F:C261231COP1100,00',
      '-}',
    ].join('\n');
    const { registros, errores } = registrosMT940(texto);
    assert.deepEqual(errores, []);
    assert.equal(registros.length, 4);
    const [a, b, c, d] = registros.map((r) => r.campos);
    assert.equal(registros[0].linea, 6);
    assert.equal(a.FECHA_VALOR, '2026-12-31');
    assert.equal(a.FECHA_ASIENTO, '2027-01-02'); // asiento en enero del año siguiente
    assert.equal(a.MARCA, 'C');
    assert.equal(a.MONTO, '100,50');
    assert.equal(a.CODIGO, 'NTRF');
    assert.equal(a.REF_CLIENTE, 'REF-1');
    assert.equal(a.REF_BANCO, 'BANCO-1');
    assert.equal(a.DETALLE, 'DETALLE ADICIONAL');
    assert.equal(a.CUENTA, 'CUENTA-1');
    assert.equal(a.EXTRACTO, 'PRUEBA');
    assert.equal(a.NUMERO_EXTRACTO, '5/1');
    assert.equal(a.MONEDA, 'COP');
    assert.equal(b.MARCA, 'RC');
    assert.equal(b.MONTO, '-0,50'); // reverso de crédito saca dinero
    assert.equal(b.REFERENCIA, 'ABC-9'); // NONREF: la referencia sale del :86:
    assert.equal(b.FECHA_ASIENTO, '');
    assert.equal(c.MONTO, '-10,'); // "10," es válido en SWIFT: sin decimales
    assert.equal(c.DESCRIPCION, '');
    assert.equal(d.MONTO, '10,'); // reverso de débito devuelve dinero

    const r = leerArchivo(texto, { ...MT940, soloEntradas: false });
    assert.deepEqual(r.errores, []);
    assert.deepEqual(r.movimientos.map((x) => x.montoCentavos), [10_050, -50, -1000, 1000]);
    assert.deepEqual(r.movimientos.map((x) => x.referencia), ['REF1', 'ABC9', '', 'X']);
  });

  test(':86: de varias líneas: corte a 65 caracteres se pega, corte corto lleva espacio', () => {
    const larga = 'A'.repeat(60) + 'TRANS';
    assert.equal(larga.length, 65);
    const texto = `:20:X\n:61:261001C1,00NTRFR1\n:86:${larga}\nFERENCIA\n:61:261001C2,00NTRFR2\n:86:UNO\nDOS\n  TRES\n`;
    const { registros } = registrosMT940(texto);
    assert.equal(registros[0].campos.DESCRIPCION, 'A'.repeat(60) + 'TRANSFERENCIA');
    assert.equal(registros[1].campos.DESCRIPCION, 'UNO DOS TRES');
  });

  test('errores: :61: mal formado, fecha inexistente y saldo que no cuadra', () => {
    const texto = [
      ':20:X',
      ':60F:C261001COP100,00',
      ':61:261001C50,00NTRFBIEN',
      ':61:261001C,50NTRFMAL',
      ':61:261301C1,00NTRFFECHA',
      ':62F:C261001COP150,00',
      ':20:Y',
      ':60F:C261002COP0,00',
      ':61:261002C10,00NTRFOTRO',
      ':62F:C261002COP99,00',
    ].join('\n');
    const r = leerArchivo(texto, MT940);
    assert.deepEqual(r.movimientos.map((x) => x.referencia), ['BIEN', 'OTRO']);
    assert.deepEqual(r.errores.map((e) => e.linea), [4, 5, 10]);
    assert.match(r.errores[0].mensaje, /mal formado/);
    assert.match(r.errores[1].mensaje, /Fecha/);
    assert.match(r.errores[2].mensaje, /no cuadra/);
  });

  test('un archivo sin :61: es un error del archivo completo', () => {
    const r = leerArchivo(':20:X\n:60F:C261001COP1,00\n:62F:C261001COP1,00\n', MT940);
    assert.deepEqual(r.movimientos, []);
    assert.equal(r.errores[0].linea, 0);
  });
});

describe('camt.053', () => {
  test('la muestra da los mismos abonos que extracto-banco.csv', () => {
    const csv = leerMuestra('extracto-banco');
    const camt = leerMuestra('extracto-banco-camt053');
    assert.deepEqual(camt.errores, []);
    assert.deepEqual(esencia(camt.movimientos), esencia(csv.movimientos));
  });

  const doc = (entradas: string, saldos = '') => `<?xml version="1.0"?>
<!-- comentario -->
<c:Document xmlns:c="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
 <c:BkToCstmrStmt><c:Stmt><c:Id>E1</c:Id>
  <c:Acct><c:Id><c:IBAN>CO00TEST</c:IBAN></c:Id></c:Acct>${saldos}
${entradas}
 </c:Stmt></c:BkToCstmrStmt>
</c:Document>`;
  const ntry = (cuerpo: string) => `  <c:Ntry>${cuerpo}</c:Ntry>`;

  test('campos: prefijos, reverso, estado, DtTm, NOTPROVIDED, entidades y CDATA', () => {
    const texto = doc([
      ntry(`<c:Amt Ccy="COP">1500.25</c:Amt><c:CdtDbtInd>CRDT</c:CdtDbtInd><c:Sts><c:Cd>BOOK</c:Cd></c:Sts>
        <c:BookgDt><c:DtTm>2026-10-01T23:10:00-05:00</c:DtTm></c:BookgDt><c:AcctSvcrRef>B1</c:AcctSvcrRef>
        <c:NtryDtls><c:TxDtls><c:Refs><c:EndToEndId>NOTPROVIDED</c:EndToEndId></c:Refs>
          <c:RmtInf><c:Ustrd>PAGO &amp; ABONO</c:Ustrd><c:Ustrd><![CDATA[<FACT 1>]]></c:Ustrd>
          <c:Strd><c:CdtrRefInf><c:Ref>RF-77</c:Ref></c:CdtrRefInf></c:Strd></c:RmtInf>
          <c:RltdPties><c:Dbtr><c:Pty><c:Nm>Cliente Ficticio</c:Nm></c:Pty></c:Dbtr></c:RltdPties></c:TxDtls></c:NtryDtls>`),
      ntry(`<c:Amt Ccy="COP">20.00</c:Amt><c:CdtDbtInd>CRDT</c:CdtDbtInd><c:RvslInd>true</c:RvslInd><c:Sts>BOOK</c:Sts>
        <c:ValDt><c:Dt>2026-10-02</c:Dt></c:ValDt><c:AddtlNtryInf>REVERSO</c:AddtlNtryInf>`),
      ntry(`<c:Amt Ccy="COP">5.00</c:Amt><c:CdtDbtInd>CRDT</c:CdtDbtInd><c:Sts>PDNG</c:Sts>
        <c:ValDt><c:Dt>2026-10-03</c:Dt></c:ValDt>`),
    ].join('\n'));
    const { registros, errores } = registrosCamt053(texto);
    assert.deepEqual(errores, []);
    const [a, b, c] = registros.map((r) => r.campos);
    assert.equal(a.FECHA, '2026-10-01');
    assert.equal(a.REFERENCIA, 'RF-77'); // sin EndToEndId útil, la referencia estructurada
    assert.equal(a.END_TO_END, '');
    assert.equal(a.DESCRIPCION, 'PAGO & ABONO <FACT 1>');
    assert.equal(a.ORDENANTE, 'Cliente Ficticio');
    assert.equal(a.CUENTA, 'CO00TEST');
    assert.equal(a.MONEDA, 'COP');
    assert.equal(b.MONTO, '-20.00'); // CRDT reversado
    assert.equal(b.DESCRIPCION, 'REVERSO');
    assert.equal(c.ESTADO, 'PDNG');

    const r = leerArchivo(texto, { ...CAMT, soloEntradas: false });
    assert.deepEqual(r.errores, []);
    // El pendiente se omite por la plantilla (omitirSi ESTADO).
    assert.deepEqual(r.movimientos.map((x) => x.montoCentavos), [150_025, -2000]);
    assert.equal(r.movimientos[0].linea, 6);
  });

  test('errores: XML mal formado con línea, Ntry sin Amt, saldo que no cuadra', () => {
    const roto = leerArchivo('<Document>\n<BkToCstmrStmt>\n<Stmt></Ntry>\n</Document>', CAMT);
    assert.deepEqual(roto.movimientos, []);
    assert.equal(roto.errores[0].linea, 3);
    assert.match(roto.errores[0].mensaje, /XML inválido/);

    const saldos = `
  <c:Bal><c:Tp><c:CdOrPrtry><c:Cd>OPBD</c:Cd></c:CdOrPrtry></c:Tp><c:Amt>10.00</c:Amt><c:CdtDbtInd>CRDT</c:CdtDbtInd></c:Bal>
  <c:Bal><c:Tp><c:CdOrPrtry><c:Cd>CLBD</c:Cd></c:CdOrPrtry></c:Tp><c:Amt>50.00</c:Amt><c:CdtDbtInd>CRDT</c:CdtDbtInd></c:Bal>`;
    const texto = doc([
      ntry('<c:Amt>30.00</c:Amt><c:CdtDbtInd>CRDT</c:CdtDbtInd><c:BookgDt><c:Dt>2026-10-01</c:Dt></c:BookgDt>'),
      ntry('<c:CdtDbtInd>CRDT</c:CdtDbtInd>'),
    ].join('\n'), saldos);
    const r = leerArchivo(texto, CAMT);
    assert.equal(r.movimientos.length, 1);
    assert.deepEqual(r.errores.map((e) => e.mensaje), ['Ntry sin Amt']); // con un Ntry ilegible no se acusa el saldo

    const sinError = leerArchivo(texto.replace(/\n {2}<c:Ntry><c:CdtDbtInd>CRDT<\/c:CdtDbtInd><\/c:Ntry>/, ''), CAMT);
    assert.equal(sinError.errores.length, 1);
    assert.match(sinError.errores[0].mensaje, /no cuadra/);
  });

  test('un XML que no es camt.053', () => {
    const r = leerArchivo('<Invoice><ID>1</ID></Invoice>', CAMT);
    assert.match(r.errores[0].mensaje, /no es un camt\.053/);
  });
});

describe('parser XML', () => {
  test('atributos con comillas simples, autocierre y entidades numéricas', () => {
    const raiz = parsearXML(`<?xml version="1.0"?>\n<a k='v &#65;&#x42;'><b/><b>t</b><c>&amp;x</c></a>`);
    assert.equal(atributoXML(raiz, 'k'), 'v AB');
    assert.equal(buscarTodos(raiz, 'b').length, 2);
    assert.equal(textoEn(raiz, 'c'), '&x');
    assert.equal(raiz.linea, 2);
  });

  test('la misma política que @conciliador/dian: DOCTYPE y entidades desconocidas se rechazan', () => {
    // Antes el lector camt.053 saltaba el DOCTYPE; ahora comparte el parser de la DIAN.
    assert.throws(() => parsearXML(`<!DOCTYPE a [<!ENTITY x "y">]>\n<a/>`), (e: unknown) => e instanceof ErrorXML && /DOCTYPE/.test(e.message));
    assert.throws(() => parsearXML('<a>&desconocida;</a>'), /Entidad desconocida/);
    const r = leerArchivo(`<!DOCTYPE Document [<!ENTITY x "y">]><Document/>`, CAMT);
    assert.equal(r.movimientos.length, 0);
    assert.match(r.errores[0].mensaje, /XML inválido: DOCTYPE/);
  });

  test('errores', () => {
    assert.throws(() => parsearXML('<a><b></a>'), /se esperaba <\/b>/i);
    assert.throws(() => parsearXML('<a>'), /sin cerrar/);
    assert.throws(() => parsearXML('<a/><b/>'), /un elemento raíz/);
    assert.throws(() => parsearXML('texto'), /fuera del elemento raíz/);
    assert.throws(() => parsearXML(''), /no tiene elemento raíz/);
  });
});

describe('detección y procesarArchivos', () => {
  test('MT940 y camt.053 se detectan por contenido con confianza 1', () => {
    const r = registroCompleto();
    assert.equal(r.detectar(muestra('extracto-banco-mt940').texto)[0].plantilla.id, 'mt940-generico');
    assert.equal(r.detectar(muestra('extracto-banco-camt053').texto)[0].plantilla.id, 'camt053-generico');
    // Ni el CSV dispara los lectores propios ni al revés.
    assert.ok(r.detectar(muestra('extracto-banco').texto).every((d) => d.plantilla.tipo === 'delimitado'));
  });

  test('mismo cruce con el extracto en CSV, MT940 o camt.053', () => {
    const r = registroCompleto();
    const ventas = procesarArchivos([{ nombre: 'v', texto: muestra('ventas-wompi').texto }], r)[0].movimientos;
    const resumen = (id: string) => {
      const [b] = procesarArchivos([{ nombre: id, texto: muestra(id).texto }], r);
      assert.deepEqual(b.errores, []);
      const porId = new Map(b.movimientos.map((m) => [m.id, m]));
      const res = conciliar(b.movimientos, ventas);
      return {
        coincidencias: res.coincidencias.map((c) => [c.tipo, c.estado, c.diferenciaCentavos, c.ventasIds.join('+'),
          c.bancoIds.map((x) => porId.get(x)!.montoCentavos).join('+')]),
        sinCruzarVentas: res.sinCruzarVentas,
        sinCruzarBanco: res.sinCruzarBanco.map((x) => porId.get(x)!.montoCentavos),
      };
    };
    const csv = resumen('extracto-banco');
    assert.equal(csv.coincidencias.length, 13);
    assert.deepEqual(resumen('extracto-banco-mt940'), csv);
    assert.deepEqual(resumen('extracto-banco-camt053'), csv);
  });
});

describe('registrarLector', () => {
  // Un formato inventado: una línea por movimiento "fecha|monto|ref".
  const lectorTubos: LectorFormato = {
    tipo: 'tubos-prueba',
    leer: (texto, p) => leerRegistros(texto.split('\n').filter((l) => l !== '').map((l, i) => {
      const [F, M, R] = l.split('|');
      return { linea: i + 1, campos: { F, M, R } };
    }), p),
    detectar: (texto) => (texto.startsWith('TUBOS') ? 1 : 0),
  };
  const pTubos = {
    id: 'tubos', nombre: 'Tubos', version: 3, lado: 'banco', tipo: 'tubos-prueba', formatoFecha: 'yyyy-MM-dd',
    separadorDecimal: '.', columnas: { fecha: 'F', monto: 'M', referencia: 'R' },
  } as unknown as Plantilla;

  test('un tipo sin lector no valida ni se lee', () => {
    const v = validarPlantilla({ ...pTubos, tipo: 'otro-tipo-inexistente' });
    assert.equal(v.ok, false);
    const r = leerArchivo('x', { ...pTubos, tipo: 'otro-tipo-inexistente' } as unknown as Plantilla);
    assert.match(r.errores[0].mensaje, /no hay un lector registrado/);
  });

  test('registrar un lector habilita el tipo en validar, leer y detectar', () => {
    registrarLector(lectorTubos);
    assert.equal(obtenerLector('tubos-prueba'), lectorTubos);
    assert.equal(validarPlantilla(pTubos).ok, true);
    const r = leerArchivo('TUBOS|0|CAB\n2026-10-01|10.50|A-1\n2026-10-02|x|A-2', pTubos);
    assert.deepEqual(r.movimientos.map((m) => [m.linea, m.montoCentavos, m.referencia, m.plantillaVersion]),
      [[2, 1050, 'A1', 3]]);
    assert.deepEqual(r.errores.map((e) => e.linea), [1, 3]); // fecha "TUBOS" y monto "x"
    const reg = registroCompleto();
    reg.registrar(pTubos);
    assert.equal(reg.detectar('TUBOS|0|CAB')[0].plantilla.id, 'tubos');
  });

  test('no se pueden reemplazar los tipos declarativos ni registrar lectores inválidos', () => {
    assert.throws(() => registrarLector({ ...lectorTubos, tipo: 'delimitado' }), /declarativo/);
    assert.throws(() => registrarLector({ tipo: '', leer: lectorTubos.leer }), /tipo/);
    assert.throws(() => registrarLector({ tipo: 'x' } as unknown as LectorFormato), /leer/);
  });
});

describe('validarPlantilla: campos nuevos', () => {
  test('mt940 no admite separador ni filasEncabezado; hoja y opcional se validan', () => {
    const r = validarPlantilla({ ...MT940, separador: ';', filasEncabezado: 1, hoja: '',
      columnas: { ...MT940.columnas, referenciaPago: { de: 'X', opcional: 'si' } } });
    assert.equal(r.ok, false);
    if (r.ok) return;
    const rutas = r.errores.map((e) => e.split(':')[0]);
    for (const ruta of ['separador', 'filasEncabezado', 'hoja', 'columnas.referenciaPago.opcional']) {
      assert.ok(rutas.includes(ruta), `falta ${ruta}: ${r.errores.join('\n')}`);
    }
    assert.equal(validarPlantilla({ ...plantilla('banco-csv-generico'), hoja: 'Movimientos' }).ok, true);
  });
});

describe('Bre-B: REFERENCIA PAGO opcional en banco-csv-generico', () => {
  test('la muestra Bre-B llena referenciaPago y el extracto sin la columna sigue igual', () => {
    const r = leerMuestra('extracto-banco-breb');
    assert.deepEqual(r.errores, []);
    assert.deepEqual(r.movimientos.map((m) => [m.montoCentavos, m.referencia, m.referenciaPago]), [
      [8_950_000, 'PED2026104823', undefined],
      [24_500_000, '', 'PED-2026-117350'],
      [6_230_000, '', 'PED-2026-121904'],
      [41_000_000, '', 'PED-2026-133018'],
    ]);
    const viejo = leerMuestra('extracto-banco');
    assert.deepEqual(viejo.errores, []);
    assert.ok(viejo.movimientos.every((m) => !('referenciaPago' in m)));
  });

  test('el mapeo cambió, así que la plantilla subió a la versión 2 y sus movimientos lo dicen', () => {
    // CONTRIBUTING: un cambio de formato sube 'version'; así se audita con qué mapeo se leyó.
    assert.equal(plantilla('banco-csv-generico').version, 2);
    for (const id of ['extracto-banco', 'extracto-banco-breb']) {
      assert.ok(leerMuestra(id).movimientos.every((m) => m.plantillaVersion === 2), id);
    }
  });

  test('una columna obligatoria que falta sigue siendo error; la opcional no', () => {
    const p = plantilla('banco-csv-generico');
    const r = leerArchivo('FECHA;DESCRIPCION;REFERENCIA;SALDO\n01/10/2026;X;Y;1,00', p);
    assert.equal(r.movimientos.length, 0);
    assert.ok(r.errores.some((e) => e.mensaje.includes('"VALOR"')));
    assert.ok(!r.errores.some((e) => e.mensaje.includes('REFERENCIA PAGO')));
  });
});
