// Verifica que las muestras embebidas (MUESTRAS) no se desincronicen de los archivos
// reales y que cada archivo respete la plantilla con la que se va a leer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PLANTILLAS, MUESTRAS } from './index.ts';

const carpeta = new URL('./muestras/', import.meta.url);
const leer = (nombre: string) => readFileSync(new URL(nombre, carpeta), 'utf8');
const plantilla = (id: string) => PLANTILLAS.find((p) => p.id === id);

test('MUESTRAS es idéntico a los archivos de muestras/', () => {
  for (const m of MUESTRAS) {
    assert.equal(m.texto, leer(m.archivo), `muestras/index.ts desactualizado para ${m.archivo}: copia el archivo en la cadena`);
  }
});

test('cada archivo de muestras/ está en MUESTRAS', () => {
  const archivos = readdirSync(carpeta).filter((f) => /\.(csv|txt|xml)$/.test(f)).sort();
  assert.deepEqual(MUESTRAS.map((m) => m.archivo).sort(), archivos);
});

test('ids únicos y cada muestra apunta a una plantilla existente del mismo lado', () => {
  assert.equal(new Set(MUESTRAS.map((m) => m.id)).size, MUESTRAS.length);
  for (const m of MUESTRAS) {
    const p = plantilla(m.plantillaId);
    assert.ok(p, `no existe la plantilla ${m.plantillaId}`);
    assert.equal(p.lado, m.lado, m.id);
  }
});

test('las plantillas cumplen lo básico del contrato', () => {
  const formatos = readdirSync(new URL('./formatos/', import.meta.url)).filter((f) => f.endsWith('.json'));
  assert.equal(PLANTILLAS.length, formatos.length, 'hay un JSON en formatos/ sin registrar en index.ts');
  assert.equal(new Set(PLANTILLAS.map((p) => p.id)).size, PLANTILLAS.length);
  for (const p of PLANTILLAS) {
    assert.ok(formatos.includes(`${p.id}.json`), `el archivo debe llamarse ${p.id}.json`);
    // Versiones fijadas: un cambio de mapeo sube 'version' (banco-csv-generico: REFERENCIA PAGO).
    assert.equal(p.version, p.id === 'banco-csv-generico' ? 2 : 1, p.id);
    assert.ok(p.nombre && p.descripcion && p.fuente, `${p.id}: falta nombre, descripcion o fuente`);
    assert.ok(p.columnas.fecha && p.columnas.monto, `${p.id}: fecha y monto son obligatorios`);
    for (const o of p.omitirSi ?? []) new RegExp(o.regex); // lanza si la regex es inválida
    for (const m of Object.values(p.columnas)) if (typeof m === 'object' && m.regex) new RegExp(m.regex);
  }
});

test('los encabezados de cada CSV son los que la plantilla detecta y mapea', () => {
  for (const m of MUESTRAS) {
    const p = plantilla(m.plantillaId)!;
    if (p.tipo !== 'delimitado') continue;
    const encabezados = m.texto.split('\n')[0].split(p.separador!);
    // Las columnas opcionales (p. ej. REFERENCIA PAGO de Bre-B) pueden venir de más.
    const opcionales = Object.values(p.columnas).flatMap((x) => (typeof x === 'object' && x.opcional && x.de ? [x.de] : []));
    assert.deepEqual(encabezados.filter((e) => !opcionales.includes(e)), p.detectar!.encabezados, m.id);
    // Toda columna mencionada en la plantilla (salvo las opcionales) debe existir en el archivo.
    const usadas = [...Object.values(p.columnas), ...(p.omitirSi ?? []).map((o) => o.campo)].flatMap((x) =>
      typeof x === 'string' ? [x] : x.opcional ? [] : [...(x.de ? [x.de] : []), ...(x.unir ?? [])]);
    for (const c of usadas) assert.ok(encabezados.includes(c), `${m.id}: falta la columna ${c}`);
  }
});

test('Asobancaria 2001: líneas de 162 caracteres y totales de control correctos', () => {
  const lineas = leer('recaudo-asobancaria.txt').split('\n').filter((l) => l !== '');
  for (const l of lineas) assert.equal(l.length, 162, `línea de ${l.length} caracteres: ${l.slice(0, 2)}`);
  assert.deepEqual(lineas.map((l) => l.slice(0, 2)), ['01', '05', '06', '06', '06', '06', '06', '08', '09']);
  const detalles = lineas.filter((l) => l.startsWith('06'));
  const suma = detalles.reduce((s, l) => s + Number(l.slice(50, 64)), 0);
  const lote = lineas.find((l) => l.startsWith('08'))!;
  const archivo = lineas.find((l) => l.startsWith('09'))!;
  assert.equal(Number(lote.slice(2, 11)), detalles.length);
  assert.equal(Number(lote.slice(11, 29)), suma);
  assert.equal(Number(archivo.slice(2, 11)), detalles.length);
  assert.equal(Number(archivo.slice(11, 29)), suma);
  // La fecha de recaudo del encabezado se repite en la zona reservada de cada detalle.
  const fecha = lineas[0].slice(12, 20);
  for (const d of detalles) assert.equal(d.slice(97, 105), fecha);
});

test('extracto bancario: el saldo de cada fila cuadra con el anterior más el valor', () => {
  const pesos = (t: string) => Number(t.replaceAll('.', '').replace(',', '')); // a centavos
  const filas = leer('extracto-banco.csv').trim().split('\n').slice(1)
    .map((l) => l.match(/("[^"]*"|[^;]*)(;|$)/g)!.map((c) => c.replace(/;$/, '')));
  let saldo = pesos(filas[0][4]);
  for (const f of filas.slice(1, -1)) {
    saldo += pesos(f[3]);
    assert.equal(pesos(f[4]), saldo, f.join(';'));
  }
});
