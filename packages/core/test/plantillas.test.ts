import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validarPlantilla, leerArchivo, parsearCSV, detectarSeparador, normalizarEncabezado, RegistroPlantillas,
} from '../src/plantillas/index.ts';
import type { Plantilla } from '../src/plantillas/index.ts';
import { procesarArchivos } from '../src/ingesta.ts';
import { PLANTILLAS, MUESTRAS } from '../../plantillas/index.ts';

const plantilla = (id: string) => PLANTILLAS.find((p) => p.id === id)!;
const muestra = (id: string) => MUESTRAS.find((m) => m.id === id)!;
const suma = (xs: { montoCentavos: number }[]) => xs.reduce((s, x) => s + x.montoCentavos, 0);

function registroCompleto(): RegistroPlantillas {
  const r = new RegistroPlantillas();
  for (const p of PLANTILLAS) r.registrar(p);
  return r;
}

// Plantilla mínima para los casos de borde.
const base = (): Plantilla => ({
  id: 'prueba', nombre: 'Prueba', version: 1, lado: 'banco', tipo: 'delimitado',
  separador: ',', separadorDecimal: '.', formatoFecha: 'yyyy-MM-dd',
  columnas: { fecha: 'FECHA', monto: 'VALOR', referencia: 'REF', descripcion: 'DESC' },
});

describe('csv', () => {
  test('comillas, comillas escapadas, separador y salto de línea dentro de comillas', () => {
    const texto = 'a,b,c\r\n"x,1","dijo ""hola""",z\r\n"línea\nsiguiente",,fin\r\n';
    const { filas, errores } = parsearCSV(texto, ',');
    assert.deepEqual(errores, []);
    assert.deepEqual(filas.map((f) => f.celdas), [
      ['a', 'b', 'c'],
      ['x,1', 'dijo "hola"', 'z'],
      ['línea\nsiguiente', '', 'fin'],
    ]);
    assert.deepEqual(filas.map((f) => f.linea), [1, 2, 3]);
  });

  test('BOM, líneas en blanco y última línea sin salto', () => {
    const { filas } = parsearCSV('﻿a;b\n\n1;2', ';');
    assert.deepEqual(filas.map((f) => [f.linea, f.celdas]), [[1, ['a', 'b']], [3, ['1', '2']]]);
  });

  test('comilla sin cerrar se reporta con su línea', () => {
    const { errores } = parsearCSV('a,b\n"abierta,2\n3,4\n', ',');
    assert.equal(errores.length, 1);
    assert.equal(errores[0].linea, 2);
  });

  test('detecta el separador entre , ; tab |', () => {
    assert.equal(detectarSeparador('a;b;c\n1;"2;x";3'), ';');
    assert.equal(detectarSeparador('a\tb\tc\n1\t2\t3'), '\t');
    assert.equal(detectarSeparador('a|b|c\n1|2|3'), '|');
    assert.equal(detectarSeparador('a,b,c\n"1;2",2,3'), ',');
    assert.equal(detectarSeparador('FECHA;DESC\n01/10/2026;"PAGO, OFICINA"'), ';');
  });

  test('normalizarEncabezado ignora tildes, mayúsculas y espacios', () => {
    assert.equal(normalizarEncabezado(' Descripción '), 'DESCRIPCION');
  });
});

describe('validarPlantilla', () => {
  test('las plantillas incluidas son válidas', () => {
    for (const p of PLANTILLAS) {
      const r = validarPlantilla(p);
      assert.ok(r.ok, `${p.id}: ${r.ok ? '' : r.errores.join('; ')}`);
    }
  });

  test('errores claros con la ruta del campo', () => {
    const p: Record<string, unknown> = { ...base(), columnas: { fecha: 'FECHA' } };
    delete p.nombre;
    p.separdor = ';';
    const r = validarPlantilla(p);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.ok(r.errores.includes('columnas.monto: falta'), r.errores.join('\n'));
    assert.ok(r.errores.includes('nombre: falta'));
    assert.ok(r.errores.includes('separdor: campo desconocido'));
  });

  test('tipos y valores inválidos', () => {
    const r = validarPlantilla({
      ...base(), version: 0, lado: 'caja', tipo: 'excel', separadorDecimal: ';', formatoFecha: 'fecha',
      omitirSi: [{ campo: 'X', regex: '(' }],
      columnas: { fecha: 'FECHA', monto: { de: 'VALOR', signo: 'doble', regex: '[' }, saldo: 'SALDO' },
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    const rutas = r.errores.map((e) => e.split(':')[0]);
    for (const ruta of ['version', 'lado', 'tipo', 'separadorDecimal', 'formatoFecha', 'omitirSi[0].regex',
      'columnas.monto.signo', 'columnas.monto.regex', 'columnas.saldo']) {
      assert.ok(rutas.includes(ruta), `falta error en ${ruta}: ${r.errores.join('\n')}`);
    }
  });

  test('ancho fijo exige inicio y longitud', () => {
    const r = validarPlantilla({
      ...base(), tipo: 'anchoFijo', separador: undefined,
      columnas: { fecha: { inicio: 1, longitud: 8 }, monto: 'VALOR' },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.errores.some((e) => e.startsWith('columnas.monto:')), r.errores.join('\n'));
  });

  test('no es un objeto', () => {
    assert.deepEqual(validarPlantilla(null), { ok: false, errores: ['plantilla: debe ser un objeto JSON'] });
  });
});

describe('leerArchivo con las muestras incluidas', () => {
  test('cada muestra se lee sin errores con su plantilla', () => {
    for (const m of MUESTRAS) {
      const r = leerArchivo(m.texto, plantilla(m.plantillaId));
      assert.deepEqual(r.errores, [], m.id);
      assert.ok(r.movimientos.length > 0, m.id);
      for (const mov of r.movimientos) {
        assert.equal(mov.lado, m.lado);
        assert.equal(mov.plantilla, m.plantillaId);
        assert.ok(Number.isSafeInteger(mov.montoCentavos) && mov.montoCentavos > 0);
        assert.match(mov.fecha, /^\d{4}-\d{2}-\d{2}$/);
      }
      assert.equal(new Set(r.movimientos.map((x) => x.id)).size, r.movimientos.length, `${m.id}: ids repetidos`);
    }
  });

  test('extracto bancario: 14 abonos, omite saldo, total y débito; comillas con ;', () => {
    const { movimientos } = leerArchivo(muestra('extracto-banco').texto, plantilla('banco-csv-generico'));
    assert.equal(movimientos.length, 14);
    assert.deepEqual(movimientos.map((x) => x.linea), [3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17]);
    assert.equal(movimientos[0].id, 'banco-csv-generico:3');
    const b10 = movimientos.find((x) => x.linea === 10)!;
    assert.equal(b10.descripcion, 'LIQUIDACION WOMPI; LOTE 3 TRX');
    assert.equal(b10.montoCentavos, 15_103_211);
    assert.equal(movimientos.find((x) => x.linea === 16)!.referencia, 'PED2026109');
    assert.equal(movimientos.find((x) => x.linea === 13)!.referencia, '');
    assert.equal(suma(movimientos), 296_983_283);
  });

  test('Wompi: 21 aprobadas, monto en centavos, fecha de created_at, descripción unida', () => {
    const { movimientos } = leerArchivo(muestra('ventas-wompi').texto, plantilla('wompi-transacciones'));
    assert.equal(movimientos.length, 21);
    const refs = movimientos.map((x) => x.referencia);
    for (const r of ['PED2026115090', 'PED2026139921', 'PED2026176613', 'PED2026188740']) assert.ok(!refs.includes(r), r);
    assert.deepEqual(movimientos[0], {
      id: '99999-1790846062-10000', lado: 'ventas', fecha: '2026-10-01', montoCentavos: 8_950_000,
      referencia: 'PED2026104823', descripcion: 'PSE cliente01@ejemplo.test', plantilla: 'wompi-transacciones', plantillaVersion: 1, linea: 2,
    });
    assert.equal(suma(movimientos), 336_360_000);
  });

  test('Asobancaria: solo registros 06, referencia sin ceros, decimales implícitos', () => {
    const { movimientos } = leerArchivo(muestra('recaudo-asobancaria').texto, plantilla('asobancaria-2001'));
    assert.deepEqual(movimientos.map((x) => x.linea), [3, 4, 5, 6, 7]);
    assert.deepEqual(movimientos.map((x) => x.referencia), ['100245', '100251', '100263', '100270', '100288']);
    assert.deepEqual(movimientos.map((x) => x.id), [3, 4, 5, 6, 7].map((n) => `asobancaria-2001:${n}`));
    assert.ok(movimientos.every((x) => x.fecha === '2026-10-14'));
    assert.equal(movimientos[0].montoCentavos, 12_500_000);
    assert.equal(suma(movimientos), 82_170_000);
  });

  test('Asobancaria: la fecha sale del registro 01 aunque los detalles dejen en blanco la zona reservada', () => {
    const lineas = muestra('recaudo-asobancaria').texto.split('\n');
    assert.ok(lineas.filter((l) => l.startsWith('06')).every((l) => l.slice(97, 105).trim() === ''));
    const conOtraFecha = lineas.map((l) => (l.startsWith('01') ? l.slice(0, 12) + '20261020' + l.slice(20) : l)).join('\n');
    const { movimientos, errores } = leerArchivo(conOtraFecha, plantilla('asobancaria-2001'));
    assert.deepEqual(errores, []);
    assert.ok(movimientos.every((x) => x.fecha === '2026-10-20'));
  });

  test('ancho fijo: registro toma el campo de la última línea de ese tipo', () => {
    const p = validarPlantilla({
      id: 'lotes', nombre: 'Lotes', version: 1, lado: 'banco', tipo: 'anchoFijo', formatoFecha: 'yyyyMMdd',
      registroDetalle: { inicio: 1, longitud: 1, valor: 'D' },
      columnas: { fecha: { registro: 'H', inicio: 2, longitud: 8 }, monto: { inicio: 2, longitud: 5 } },
    });
    assert.ok(p.ok);
    const texto = ['H20261001', 'D00100', 'H20261002', 'D00200', 'D00300'].join('\n');
    const { movimientos } = leerArchivo(texto, p.plantilla);
    assert.deepEqual(movimientos.map((m) => m.fecha), ['2026-10-01', '2026-10-02', '2026-10-02']);
  });

  test('ancho fijo: un detalle antes de su registro de encabezado da error en esa línea', () => {
    const p = validarPlantilla({
      id: 'lotes', nombre: 'Lotes', version: 1, lado: 'banco', tipo: 'anchoFijo', formatoFecha: 'yyyyMMdd',
      registroDetalle: { inicio: 1, longitud: 1, valor: 'D' },
      columnas: { fecha: { registro: 'H', inicio: 2, longitud: 8 }, monto: { inicio: 2, longitud: 5 } },
    });
    assert.ok(p.ok);
    const { movimientos, errores } = leerArchivo(['D00100', 'H20261001', 'D00200'].join('\n'), p.plantilla);
    assert.equal(movimientos.length, 1);
    assert.deepEqual(errores.map((e) => e.linea), [1]);
  });

  test('registro solo aplica a ancho fijo con registroDetalle', () => {
    const delimitado = validarPlantilla({
      id: 'x', nombre: 'X', version: 1, lado: 'banco', tipo: 'delimitado', formatoFecha: 'yyyy-MM-dd',
      columnas: { fecha: { de: 'Fecha', registro: 'H' }, monto: 'Monto' },
    });
    assert.ok(!delimitado.ok && delimitado.errores.some((e) => e.includes('columnas.fecha.registro')));
    const sinDetalle = validarPlantilla({
      id: 'x', nombre: 'X', version: 1, lado: 'banco', tipo: 'anchoFijo', formatoFecha: 'yyyyMMdd',
      columnas: { fecha: { registro: 'H', inicio: 2, longitud: 8 }, monto: { inicio: 2, longitud: 5 } },
    });
    assert.ok(!sinDetalle.ok && sinDetalle.errores.some((e) => e.includes('registroDetalle')));
  });

  test('ERP: 6 ventas, cliente con coma entre comillas', () => {
    const { movimientos } = leerArchivo(muestra('ventas-erp').texto, plantilla('ventas-csv-generico'));
    assert.equal(movimientos.length, 6);
    assert.equal(movimientos.find((x) => x.id === 'V-2103')!.descripcion, 'Cliente Ejemplo 03, Sucursal Norte');
    assert.equal(suma(movimientos), 92_150_000);
  });

  test('Mercado Pago: 6 SETTLEMENT con desglose positivo que cuadra con el neto', () => {
    const { movimientos } = leerArchivo(muestra('liquidacion-mercadopago').texto, plantilla('mercadopago-liquidacion'));
    assert.equal(movimientos.length, 6);
    assert.ok(movimientos.every((x) => x.descripcion === 'SETTLEMENT'));
    assert.deepEqual(movimientos[0].desglose, { brutoCentavos: 15_000_000, comisionCentavos: 682_465, retencionesCentavos: 225_000 });
    const d = movimientos[0].desglose!;
    assert.equal(d.brutoCentavos! - d.comisionCentavos! - d.retencionesCentavos!, 14_092_535);
  });
});

describe('leerArchivo: casos de borde', () => {
  test('una línea mala no detiene el archivo y se reporta con su número', () => {
    const texto = [
      'FECHA,VALOR,REF,DESC',
      '2026-10-01,100.50,A1,ok',
      '2026-02-30,200.00,A2,fecha inexistente',
      '01/10/2026,200.00,A3,formato de fecha distinto',
      '2026-10-02,doce mil,A4,monto inválido',
      '2026-10-03,,A5,monto vacío',
      '2026-10-04,"1,234.56",A6,"con coma, entre comillas"',
    ].join('\n');
    const r = leerArchivo(texto, base());
    assert.deepEqual(r.movimientos.map((x) => [x.linea, x.montoCentavos]), [[2, 10_050], [7, 123_456]]);
    assert.deepEqual(r.errores.map((e) => e.linea), [3, 4, 5, 6]);
    assert.match(r.errores[0].mensaje, /^fecha: /);
    assert.match(r.errores[2].mensaje, /^monto: Monto inválido/);
    assert.equal(r.errores[3].mensaje, 'monto: vacío');
    assert.equal(r.movimientos[1].descripcion, 'con coma, entre comillas');
  });

  test('columna que no existe es un error de plantilla en la línea del encabezado', () => {
    const r = leerArchivo('FECHA,MONTO\n2026-10-01,10', base());
    assert.equal(r.movimientos.length, 0);
    assert.ok(r.errores.some((e) => e.linea === 1 && e.mensaje.includes('"VALOR"')));
  });

  test('índices #n, fijo, signo y separador detectado', () => {
    const p: Plantilla = {
      ...base(), separador: undefined, separadorDecimal: ',', formatoFecha: 'dd/MM/yyyy', filasEncabezado: 0,
      columnas: { fecha: '#1', monto: { de: '#2', signo: 'negar' }, descripcion: { fijo: 'CARGO' }, comision: { de: '#3', signo: 'abs' } },
    };
    const r = leerArchivo('01/10/2026;-1.500,00;-30,00\n02/10/2026;20,00;', p);
    assert.deepEqual(r.errores, []);
    assert.deepEqual(r.movimientos.map((x) => [x.fecha, x.montoCentavos, x.descripcion, x.desglose]), [
      ['2026-10-01', 150_000, 'CARGO', { comisionCentavos: 3000 }],
      ['2026-10-02', -2000, 'CARGO', undefined],
    ]);
  });

  test('ids repetidos van a errores', () => {
    const p: Plantilla = { ...base(), columnas: { ...base().columnas, id: 'REF' } };
    const r = leerArchivo('FECHA,VALOR,REF,DESC\n2026-10-01,1,X,a\n2026-10-02,2,X,b', p);
    assert.equal(r.movimientos.length, 1);
    assert.deepEqual(r.errores.map((e) => e.linea), [3]);
  });

  test('ancho fijo con CRLF, registroDetalle y monto inválido', () => {
    const p: Plantilla = {
      id: 'fijo', nombre: 'Fijo', version: 1, lado: 'banco', tipo: 'anchoFijo', formatoFecha: 'yyyyMMdd',
      registroDetalle: { inicio: 1, longitud: 1, valor: 'D' },
      columnas: { fecha: { inicio: 2, longitud: 8 }, monto: { inicio: 10, longitud: 6, decimalesImplicitos: 2 } },
    };
    const r = leerArchivo('H cabecera\r\nD20261001001234\r\nD2026100100A234\r\nT fin\r\n', p);
    assert.deepEqual(r.movimientos.map((x) => [x.id, x.montoCentavos]), [['fijo:2', 1234]]);
    assert.deepEqual(r.errores.map((e) => e.linea), [3]);
  });
});

describe('RegistroPlantillas', () => {
  test('la detección elige la plantilla correcta para cada muestra', () => {
    const r = registroCompleto();
    for (const m of MUESTRAS) {
      const d = r.detectar(m.texto);
      assert.equal(d[0]?.plantilla.id, m.plantillaId, m.id);
      assert.equal(d[0].confianza, 1, m.id);
      for (let i = 1; i < d.length; i++) assert.ok(d[i].confianza < 1, `${m.id}: empate con ${d[i].plantilla.id}`);
    }
  });

  test('confianza parcial y archivo desconocido', () => {
    const r = registroCompleto();
    const d = r.detectar('fecha;descripcion;valor\n01/10/2026;x;1,00');
    assert.equal(d[0].plantilla.id, 'banco-csv-generico');
    assert.equal(d[0].confianza, 3 / 5);
    assert.deepEqual(r.detectar('nada que ver\n1 2 3'), []);
    assert.deepEqual(r.detectar(''), []);
  });

  test('registrar lanza con la lista de errores; obtener y listar', () => {
    const r = registroCompleto();
    assert.throws(() => r.registrar({ ...base(), columnas: { fecha: 'F' } }), /columnas\.monto: falta/);
    assert.equal(r.listar().length, PLANTILLAS.length);
    assert.equal(r.obtener('asobancaria-2001')?.tipo, 'anchoFijo');
    assert.equal(r.obtener('no-existe'), undefined);
  });

  test('reemplazar una plantilla reindexa la detección', () => {
    const r = new RegistroPlantillas();
    r.registrar({ ...base(), detectar: { encabezados: ['FECHA', 'VALOR'] } });
    r.registrar({ ...base(), version: 2, detectar: { encabezados: ['DIA', 'IMPORTE'] } });
    assert.equal(r.listar().length, 1);
    assert.deepEqual(r.detectar('FECHA,VALOR'), []);
    assert.equal(r.detectar('DIA,IMPORTE')[0].plantilla.version, 2);
  });
});

describe('procesarArchivos', () => {
  test('procesa en orden de llegada, detecta y no se frena con un archivo desconocido', () => {
    const r = registroCompleto();
    const resultado = procesarArchivos([
      { nombre: 'extracto.csv', texto: muestra('extracto-banco').texto },
      { nombre: 'raro.txt', texto: 'esto no es un formato conocido' },
      { nombre: 'erp.csv', texto: muestra('ventas-erp').texto, plantillaId: 'ventas-csv-generico' },
      { nombre: 'otro.csv', texto: 'a,b', plantillaId: 'no-existe' },
      { nombre: 'recaudo.txt', texto: muestra('recaudo-asobancaria').texto },
    ], r);
    assert.deepEqual(resultado.map((x) => [x.nombre, x.plantillaId, x.movimientos.length]), [
      ['extracto.csv', 'banco-csv-generico', 14],
      ['raro.txt', null, 0],
      ['erp.csv', 'ventas-csv-generico', 6],
      ['otro.csv', null, 0],
      ['recaudo.txt', 'asobancaria-2001', 5],
    ]);
    assert.equal(resultado[1].errores.length, 1);
    assert.equal(resultado[1].errores[0].linea, 0);
    assert.match(resultado[3].errores[0].mensaje, /no-existe/);
  });

  test('todas las muestras por detección automática', () => {
    const r = registroCompleto();
    const resultado = procesarArchivos(MUESTRAS.map((m) => ({ nombre: m.archivo, texto: m.texto })), r);
    assert.deepEqual(resultado.map((x) => x.plantillaId), MUESTRAS.map((m) => m.plantillaId));
    assert.ok(resultado.every((x) => x.errores.length === 0));
  });
});
