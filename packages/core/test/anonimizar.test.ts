// scripts/anonimizar.ts: formato idéntico, reemplazo estable y nada sensible en la salida.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anonimizar, crearSeudonimizador } from '../../../scripts/anonimizar.ts';
import { leerArchivo, parsearCSV, conciliar, diasEntre } from '../src/index.ts';
import type { Plantilla } from '../src/index.ts';
import { PLANTILLAS, MUESTRAS } from '../../plantillas/index.ts';

const plantilla = (id: string) => PLANTILLAS.find((p) => p.id === id)!;
const muestra = (id: string) => MUESTRAS.find((m) => m.id === id)!;
const CLAVE = 'clave-de-prueba';
const anon = (id: string, extra = {}) => anonimizar(muestra(id).texto, plantilla(muestra(id).plantillaId), { clave: CLAVE, ...extra });

describe('anonimizar: formato idéntico', () => {
  test('cada muestra conserva líneas, longitudes y columnas, y se lee igual', () => {
    for (const m of MUESTRAS) {
      const p = plantilla(m.plantillaId);
      const r = anon(m.id);
      assert.notEqual(r.texto, m.texto, `${m.id}: no cambió nada`);
      const antes = m.texto.split('\n');
      const despues = r.texto.split('\n');
      assert.equal(despues.length, antes.length, m.id);
      antes.forEach((l, i) => assert.equal(despues[i].length, l.length, `${m.id} línea ${i + 1}`));
      if (p.tipo === 'delimitado') {
        const a = parsearCSV(m.texto, p.separador!).filas;
        const d = parsearCSV(r.texto, p.separador!).filas;
        assert.deepEqual(d[0].celdas, a[0].celdas, `${m.id}: encabezado`);
        a.forEach((f, i) => assert.deepEqual(d[i].celdas.map((c) => c.length), f.celdas.map((c) => c.length), `${m.id} fila ${i + 1}`));
      }
      // Misma lectura: mismos montos, fechas, líneas y errores; distinta referencia.
      const la = leerArchivo(m.texto, p);
      const ld = leerArchivo(r.texto, p);
      assert.deepEqual(ld.errores, la.errores, m.id);
      assert.deepEqual(ld.movimientos.map((x) => [x.linea, x.fecha, x.montoCentavos]), la.movimientos.map((x) => [x.linea, x.fecha, x.montoCentavos]), m.id);
      assert.deepEqual(ld.movimientos.map((x) => x.referencia.length), la.movimientos.map((x) => x.referencia.length), m.id);
      assert.deepEqual(r.avisos.filter((a) => a.startsWith('la lectura cambió')), [], m.id);
    }
  });

  test('Asobancaria: solo cambian las zonas mapeadas del detalle; encabezados y controles quedan iguales', () => {
    const original = muestra('recaudo-asobancaria').texto.split('\n');
    const r = anon('recaudo-asobancaria');
    const salida = r.texto.split('\n');
    original.forEach((l, i) => {
      if (!l.startsWith('06')) return assert.equal(salida[i], l);
      assert.equal(salida[i].slice(0, 2), '06');
      assert.equal(salida[i].slice(50, 64), l.slice(50, 64)); // valor
      assert.equal(salida[i].slice(97, 105), l.slice(97, 105)); // fecha
      assert.notEqual(salida[i].slice(2, 50), l.slice(2, 50)); // referencia
      assert.equal(salida[i].slice(2, 44), l.slice(2, 44)); // los ceros de relleno se conservan
    });
    assert.ok(r.avisos.some((a) => a.includes('no son de detalle')));
  });
});

describe('anonimizar: reemplazo estable', () => {
  test('misma clave, mismo resultado; otra clave, otro resultado', () => {
    assert.equal(anon('ventas-wompi').texto, anon('ventas-wompi').texto);
    const otra = anonimizar(muestra('ventas-wompi').texto, plantilla('wompi-transacciones'), { clave: 'otra' });
    assert.notEqual(otra.texto, anon('ventas-wompi').texto);
  });

  test('el mismo valor da el mismo reemplazo en archivos distintos y el prefijo truncado se conserva', () => {
    const s = crearSeudonimizador(CLAVE);
    const completa = s.valor('PED-2026-109377', 'identificador');
    const truncada = s.valor('PED-2026-109', 'identificador');
    assert.ok(completa.startsWith(truncada), `${truncada} no es prefijo de ${completa}`);
    assert.equal(s.valor('000100245', 'identificador').slice(3), s.valor('100245', 'identificador'));
    assert.equal(crearSeudonimizador(CLAVE).valor('Pérez', 'identificador'), s.valor('Pérez', 'identificador'));
    assert.match(s.valor('Pérez', 'identificador'), /^[A-Z][a-z]{4}$/);
  });

  test('el par extracto + Wompi anonimizado concilia igual que el original', () => {
    const leer = (id: string, texto: string) => leerArchivo(texto, plantilla(muestra(id).plantillaId)).movimientos;
    const resumen = (banco: string, ventas: string) => {
      const b = leer('extracto-banco', banco);
      const v = leer('ventas-wompi', ventas);
      const r = conciliar(b, v);
      const linea = new Map([...b, ...v].map((m) => [m.id, m.linea]));
      return r.coincidencias.map((c) => [c.tipo, c.estado, c.diferenciaCentavos, c.bancoIds.map((x) => linea.get(x)), c.ventasIds.map((x) => linea.get(x))]);
    };
    const original = resumen(muestra('extracto-banco').texto, muestra('ventas-wompi').texto);
    const anonimizado = resumen(anon('extracto-banco').texto, anon('ventas-wompi').texto);
    assert.equal(original.length, 13);
    assert.deepEqual(anonimizado, original);
  });
});

describe('anonimizar: no quedan valores sensibles', () => {
  const plantillaClientes: Plantilla = {
    id: 'clientes', nombre: 'Clientes', version: 1, lado: 'banco', tipo: 'delimitado', separador: ';',
    separadorDecimal: ',', formatoFecha: 'dd/MM/yyyy',
    columnas: { fecha: 'FECHA', monto: 'VALOR', referencia: 'REFERENCIA', descripcion: 'DESCRIPCION' },
  };
  // Datos inventados con forma de datos reales.
  const sensibles = ['Juan', 'Pérez', 'GOMEZ', 'Restrepo', 'María', 'Alejandra', '1098765432', '900123456', '4567',
    'juan.perez@correo-ficticio.test', 'correo', 'ficticio', '0012345678901', '3001234567', 'FAC-55821', 'Calle'];
  const texto = [
    'FECHA;DESCRIPCION;REFERENCIA;VALOR;NOMBRE CLIENTE;CEDULA;CORREO;CUENTA;TELEFONO;DIRECCION;NOTAS',
    '01/10/2026;TRANSFERENCIA DE Juan Pérez GOMEZ CC 1098765432;FAC-55821;1.500,00;Juan Pérez GOMEZ;1098765432;juan.perez@correo-ficticio.test;0012345678901;3001234567;Calle 5 # 4567;NIT 900123456-1',
    '02/10/2026;ABONO PSE María Alejandra Restrepo;FAC-55821-2;2.000,00;"Restrepo, María Alejandra";900123456;"m.restrepo@correo-ficticio.test";0012345678901;3001234567;"Calle 5; apto 4567";escribir a juan.perez@correo-ficticio.test',
    '',
  ].join('\n');

  test('nombres, cédulas, NIT, correos, cuentas, teléfonos y referencias desaparecen', () => {
    const r = anonimizar(texto, plantillaClientes, { clave: CLAVE });
    const cuerpo = r.texto.split('\n').slice(1).join('\n').toLowerCase(); // el encabezado (CORREO...) se conserva
    for (const v of sensibles) assert.ok(!cuerpo.includes(v.toLowerCase()), `quedó "${v}" en:\n${r.texto}`);
    // Lo que no identifica a nadie se conserva.
    assert.match(r.texto, /;TRANSFERENCIA DE [A-Z][a-z]{3} /);
    assert.match(r.texto, /;ABONO PSE /);
    assert.equal(r.texto.split('\n')[0], texto.split('\n')[0]);
    assert.deepEqual(parsearCSV(r.texto, ';').filas.map((f) => f.celdas.map((c) => c.length)),
      parsearCSV(texto, ';').filas.map((f) => f.celdas.map((c) => c.length)));
    // La misma persona en dos columnas y dos filas da el mismo seudónimo.
    const filas = parsearCSV(r.texto, ';').filas;
    assert.equal(filas[1].celdas[5], filas[1].celdas[5]);
    assert.ok(filas[1].celdas[1].includes(filas[1].celdas[4]), 'nombre en descripción y en NOMBRE CLIENTE');
    assert.equal(filas[2].celdas[5], filas[1].celdas[10].slice(4, 13)); // NIT en CEDULA y en NOTAS
  });

  test('Wompi: ids, referencias y correos originales no aparecen', () => {
    const original = leerArchivo(muestra('ventas-wompi').texto, plantilla('wompi-transacciones')).movimientos;
    const r = anon('ventas-wompi');
    for (const m of original) {
      assert.ok(!r.texto.includes(m.id), m.id);
      assert.ok(!r.texto.includes(muestra('ventas-wompi').texto.split('\n')[m.linea - 1].split(',')[2]), `referencia de la línea ${m.linea}`);
    }
    assert.ok(!/cliente\d+@ejemplo\.test/.test(r.texto));
  });

  test('MT940 y camt.053: referencias, cuenta y textos libres', () => {
    const mt = anon('extracto-banco-mt940').texto;
    const camt = anon('extracto-banco-camt053').texto;
    for (const t of [mt, camt]) {
      assert.ok(!t.includes('PED-2026-104823'));
      assert.ok(!t.includes('000123456789'));
      assert.ok(t.includes('ABONO PSE WOMPI'));
    }
    assert.match(mt, /^:61:2610011001C89500,00NTRF[A-Z]{3}-\d{4}-\d{6}\/\/[A-Z]\d{10}$/m);
  });
});

describe('anonimizar: desplazar fechas y escalar montos', () => {
  test('fechas +3 días y montos x1,1 en el mismo formato', () => {
    for (const id of ['extracto-banco', 'ventas-wompi', 'liquidacion-mercadopago', 'recaudo-asobancaria']) {
      const p = plantilla(muestra(id).plantillaId);
      const a = leerArchivo(muestra(id).texto, p).movimientos;
      const r = anon(id, { desplazarDias: 3, factorMontos: 1.1 });
      const d = leerArchivo(r.texto, p);
      assert.deepEqual(d.errores, [], id);
      assert.equal(d.movimientos.length, a.length, id);
      d.movimientos.forEach((m, i) => {
        assert.equal(diasEntre(a[i].fecha, m.fecha), 3, id);
        assert.equal(m.montoCentavos, Math.round(a[i].montoCentavos * 1.1), id);
      });
    }
  });

  test('el saldo del extracto sigue cuadrando al escalar (columna de dinero no mapeada)', () => {
    const r = anon('extracto-banco', { factorMontos: 2 });
    const filas = parsearCSV(r.texto, ';').filas.slice(1, -1);
    assert.equal(filas[0].celdas[4], '4.700.000,00');
    assert.equal(filas[1].celdas[4], '4.879.000,00');
    assert.equal(filas[1].celdas[3], '179.000,00');
  });
});

describe('anonimizar: línea de comandos', () => {
  test('detecta la plantilla, escribe la salida y respeta la clave', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anonimizar-'));
    try {
      const entrada = join(dir, 'extracto.csv');
      writeFileSync(entrada, muestra('extracto-banco').texto);
      const script = fileURLToPath(new URL('../../../scripts/anonimizar.ts', import.meta.url));
      const correr = (salida: string, ...extra: string[]) =>
        spawnSync(process.execPath, [script, entrada, join(dir, salida), ...extra], { encoding: 'utf8' });
      const r1 = correr('a.csv', '--clave', CLAVE);
      assert.equal(r1.status, 0, r1.stderr);
      assert.match(r1.stdout, /Plantilla: banco-csv-generico/);
      assert.equal(readFileSync(join(dir, 'a.csv'), 'utf8'), anon('extracto-banco').texto);
      const r2 = correr('b.csv');
      assert.equal(r2.status, 0, r2.stderr);
      assert.match(r2.stderr, /Clave generada: [0-9a-f]{32}/);
      const r3 = correr('c.csv', '--plantilla', 'no-existe');
      assert.equal(r3.status, 2);
      const r4 = spawnSync(process.execPath, [script], { encoding: 'utf8' });
      assert.equal(r4.status, 2);
      assert.match(r4.stderr, /Uso:/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
