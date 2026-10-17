// leerExcel: el mismo extracto en .xlsx debe dar exactamente los mismos movimientos
// que el CSV con la misma plantilla. El .xlsx se genera aquí con SheetJS (sin archivos binarios en el repo).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import type { CellObject, WorkSheet } from 'xlsx';
import { leerExcel, numeroSinExponente } from '../src/index.ts';
import { leerArchivo, parsearCSV, aCentavos, RegistroPlantillas, procesarArchivos } from '../../core/src/index.ts';
import { PLANTILLAS, MUESTRAS } from '../../plantillas/index.ts';

const plantilla = (id: string) => PLANTILLAS.find((p) => p.id === id)!;
const csvExtracto = MUESTRAS.find((m) => m.id === 'extracto-banco')!.texto;

// Fecha dd/MM/yyyy -> número de serie de Excel, en UTC.
const serie = (f: string) => {
  const [d, m, a] = f.split('/').map(Number);
  return (Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
};

function libroDesdeCeldas(hojas: Record<string, (CellObject | null)[][]>): Uint8Array {
  const libro = XLSX.utils.book_new();
  for (const [nombre, filas] of Object.entries(hojas)) {
    const hoja: WorkSheet = {};
    filas.forEach((fila, r) => fila.forEach((celda, c) => {
      if (celda) hoja[XLSX.utils.encode_cell({ r, c })] = celda;
    }));
    const ancho = Math.max(...filas.map((f) => f.length));
    hoja['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length - 1, c: ancho - 1 } });
    XLSX.utils.book_append_sheet(libro, hoja, nombre);
  }
  return new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

// El extracto como lo exportaría un banco a Excel: fechas como fechas y montos como números.
function extractoXlsx(): Uint8Array {
  const { filas } = parsearCSV(csvExtracto, ';');
  const [encabezado, ...datos] = filas.map((f) => f.celdas);
  const celdas: CellObject[][] = [
    encabezado.map((v) => ({ t: 's', v })),
    ...datos.map(([fecha, desc, ref, valor, saldo]) => [
      { t: 'n', v: serie(fecha), z: 'dd/mm/yyyy' } as CellObject,
      { t: 's', v: desc } as CellObject,
      ref === '' ? ({ t: 'z' } as CellObject) : ({ t: 's', v: ref } as CellObject),
      { t: 'n', v: aCentavos(valor) / 100, z: '#,##0.00' } as CellObject,
      { t: 'n', v: aCentavos(saldo) / 100, z: '#,##0.00' } as CellObject,
    ]),
  ];
  return libroDesdeCeldas({ Extracto: celdas, Notas: [[{ t: 's', v: 'hoja de notas' }]] });
}

describe('leerExcel', () => {
  test('el extracto en .xlsx da los mismos movimientos que el CSV', () => {
    const { hojas, texto } = leerExcel(extractoXlsx());
    assert.deepEqual(hojas, ['Extracto', 'Notas']);
    const p = plantilla('banco-csv-generico');
    const desdeCsv = leerArchivo(csvExtracto, p);
    const desdeExcel = leerArchivo(texto, p);
    assert.deepEqual(desdeExcel.errores, []);
    assert.equal(desdeExcel.movimientos.length, 14);
    assert.deepEqual(desdeExcel.movimientos, desdeCsv.movimientos); // ids, líneas y montos idénticos
    // Y se detecta igual que el CSV.
    const r = new RegistroPlantillas();
    for (const x of PLANTILLAS) r.registrar(x);
    assert.equal(procesarArchivos([{ nombre: 'extracto.xlsx', texto }], r)[0].plantillaId, 'banco-csv-generico');
  });

  test('acepta ArrayBuffer y elige la hoja por nombre', () => {
    const bytes = extractoXlsx();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    assert.equal(leerExcel(buffer, { hoja: 'Notas' }).texto, 'hoja de notas\n');
    assert.throws(() => leerExcel(bytes, { hoja: 'Otra' }), /La hoja "Otra" no existe; hojas disponibles: Extracto, Notas/);
  });

  test('fechas, números sin notación científica, celdas vacías, comillas y texto tal cual', () => {
    const bytes = libroDesdeCeldas({
      H: [
        [{ t: 's', v: 'A' }, { t: 's', v: 'B' }, { t: 's', v: 'C' }, { t: 's', v: 'D' }],
        [{ t: 'n', v: serie('29/02/2028') + 0.75, z: 'dd/mm/yyyy hh:mm' }, { t: 'n', v: 1e21 }, { t: 'n', v: 1e-7 }, { t: 's', v: '1.234,56' }],
        [null, { t: 'n', v: 0.1 + 0.2 }, { t: 's', v: 'con ; y "comillas"' }, { t: 'b', v: true }],
        [null, null, null, null],
        [{ t: 'n', v: serie('01/01/1990'), z: 'yyyy-mm-dd' }, { t: 'n', v: -48 }, { t: 'n', v: 123456789012 }, null],
      ],
    });
    assert.equal(leerExcel(bytes).texto, [
      'A;B;C;D',
      '29/02/2028;1000000000000000000000;0,0000001;1.234,56',
      ';0,3;"con ; y ""comillas""";VERDADERO',
      '01/01/1990;-48;123456789012;',
      '',
    ].join('\n'));
    assert.match(leerExcel(bytes, { separadorDecimal: '.' }).texto, /;0\.3;/);
  });

  test('hoja vacía', () => {
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([]), 'Vacia');
    const bytes = new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    assert.deepEqual(leerExcel(bytes), { hojas: ['Vacia'], texto: '' });
  });

  test('numeroSinExponente', () => {
    assert.equal(numeroSinExponente(89776.71), '89776,71');
    assert.equal(numeroSinExponente(-0), '0');
    assert.equal(numeroSinExponente(2.5e-8, '.'), '0.000000025');
    assert.equal(numeroSinExponente(Number.NaN), '');
  });
});

describe('scripts/anonimizar.ts con Excel', () => {
  test('un .xlsx se convierte a CSV, se detecta y se anonimiza con la misma lectura', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anonimizar-xlsx-'));
    try {
      const entrada = join(dir, 'extracto.xlsx');
      const salida = join(dir, 'extracto-anonimo.csv');
      writeFileSync(entrada, extractoXlsx());
      const script = fileURLToPath(new URL('../../../scripts/anonimizar.ts', import.meta.url));
      const r = spawnSync(process.execPath, [script, entrada, salida, '--clave', 'k'], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /Plantilla: banco-csv-generico/);
      assert.match(r.stdout, /la entrada era Excel/);
      const texto = readFileSync(salida, 'utf8');
      assert.ok(!texto.includes('PED-2026-104823'));
      const p = plantilla('banco-csv-generico');
      const original = leerArchivo(csvExtracto, p).movimientos;
      const anonimo = leerArchivo(texto, p);
      assert.deepEqual(anonimo.errores, []);
      assert.deepEqual(anonimo.movimientos.map((m) => [m.fecha, m.montoCentavos]), original.map((m) => [m.fecha, m.montoCentavos]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
