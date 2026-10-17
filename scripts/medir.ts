// Mide el tiempo de conciliar con datos sintéticos deterministas (misma semilla, mismos datos).
// Uso: node scripts/medir.ts [--por-dia=60] [tamaños...]   (por defecto 10000 100000)
// Los números van a docs/DOCUMENTO_FINAL.md. Ningún dato es real: todo sale de un generador.
import { performance } from 'node:perf_hooks';
import { conciliar, PERFIL_POR_DEFECTO } from '../packages/core/src/index.ts';
import type { Movimiento } from '../packages/core/src/index.ts';

// mulberry32: PRNG pequeño y reproducible; Math.random no permite fijar semilla.
function generador(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIA_MS = 86_400_000;
const INICIO = Date.parse('2026-01-01T00:00:00Z');
// Densidad de un comercio mediano: unas 60 ventas por día. Con más ventas por día
// las ventanas de fecha se llenan y el pase agrupado se omite por exceso de candidatos.
const argPorDia = process.argv.find((a) => a.startsWith('--por-dia='));
const VENTAS_POR_DIA = argPorDia ? Number(argPorDia.split('=')[1]) : 60;
if (!Number.isInteger(VENTAS_POR_DIA) || VENTAS_POR_DIA < 1) throw new Error('--por-dia debe ser un entero positivo');

const fecha = (dia: number) => new Date(INICIO + dia * DIA_MS).toISOString().slice(0, 10);

function movimiento(lado: 'banco' | 'ventas', id: string, dia: number, monto: number, referencia: string, linea: number): Movimiento {
  return { id, lado, fecha: fecha(dia), montoCentavos: monto, referencia, descripcion: '', plantilla: 'sintetica', linea };
}

// Mezcla aproximada de un mes real de una tienda con pasarela:
// 45 % exactas, 30 % con comisión (1:1 con tolerancia), 15 % de ventas en abonos agrupados, 10 % sin pareja.
export function generar(nVentas: number, semilla = 20261016): { banco: Movimiento[]; ventas: Movimiento[] } {
  const azar = generador(semilla);
  const entero = (min: number, max: number) => min + Math.floor(azar() * (max - min + 1));
  const banco: Movimiento[] = [];
  const ventas: Movimiento[] = [];
  const dias = Math.max(1, Math.ceil(nVentas / VENTAS_POR_DIA));
  let nb = 0;

  while (ventas.length < nVentas) {
    const r = azar();
    const dia = entero(0, dias - 1);
    // Montos en pesos enteros entre $10.000 y $2.000.000, guardados en centavos.
    const monto = entero(10_000, 2_000_000) * 100;
    const ref = `PED${String(ventas.length).padStart(7, '0')}`;
    const v = movimiento('ventas', `v${ventas.length + 1}`, dia, monto, ref, ventas.length + 2);
    if (r < 0.45) {
      ventas.push(v);
      banco.push(movimiento('banco', `b${++nb}`, dia + entero(0, 1), monto, ref, nb + 1));
    } else if (r < 0.75) {
      ventas.push(v);
      // Comisión entre 2,5 % y 4,5 %; el banco trunca la referencia.
      const neto = Math.round(monto * (1 - (2.5 + azar() * 2) / 100));
      banco.push(movimiento('banco', `b${++nb}`, dia + entero(1, 3), neto, ref.slice(0, 8), nb + 1));
    } else if (r < 0.9) {
      // Abono que agrupa 2 a 4 ventas del mismo día, sin referencia útil.
      const k = entero(2, 4);
      let suma = 0;
      for (let x = 0; x < k && ventas.length < nVentas; x++) {
        const m = entero(10_000, 400_000) * 100;
        suma += m;
        ventas.push(movimiento('ventas', `v${ventas.length + 1}`, dia, m, '', ventas.length + 2));
      }
      banco.push(movimiento('banco', `b${++nb}`, dia + 1, Math.round(suma * 0.97), `LOTE${nb}`, nb + 1));
    } else if (r < 0.95) {
      ventas.push(v); // venta que aún no llega al banco
    } else {
      banco.push(movimiento('banco', `b${++nb}`, dia, monto, `TRF${nb}`, nb + 1)); // abono sin venta
    }
  }
  // Ordenados por fecha, como llegan en un extracto real.
  const porFecha = (a: Movimiento, b: Movimiento) => a.fecha.localeCompare(b.fecha) || a.linea - b.linea;
  return { banco: banco.sort(porFecha), ventas: ventas.sort(porFecha) };
}

function medir(n: number, repeticiones: number) {
  const { banco, ventas } = generar(n);
  const tiempos: number[] = [];
  let resultado = conciliar(banco, ventas, PERFIL_POR_DEFECTO); // calentamiento del JIT
  for (let i = 0; i < repeticiones; i++) {
    const t0 = performance.now();
    resultado = conciliar(banco, ventas, PERFIL_POR_DEFECTO);
    tiempos.push(performance.now() - t0);
  }
  tiempos.sort((a, b) => a - b);
  const r = resultado.resumen;
  const conciliadas = r.movimientosBanco - r.sinCruzarBanco;
  return {
    ventas: ventas.length,
    banco: banco.length,
    medianaMs: Math.round(tiempos[tiempos.length >> 1]),
    minMs: Math.round(tiempos[0]),
    automaticas: r.automaticas,
    sugeridas: r.sugeridas,
    pctBancoConciliado: Math.round((conciliadas / r.movimientosBanco) * 1000) / 10,
    pases: resultado.pases.map((p) => `${p.nombre.split(' ')[0]}${p.nombre.includes('omitida') ? ' omitida' : ''}=${p.coincidencias}`).join(', '),
    aristasGrafo: resultado.grafo.aristas.length,
  };
}

const tamanos = process.argv.slice(2).filter((a) => !a.startsWith('--')).map(Number).filter((x) => Number.isInteger(x) && x > 0);
const lista = tamanos.length > 0 ? tamanos : [10_000, 100_000];
console.log(`Node ${process.version} · ${process.platform}/${process.arch} · perfil "${PERFIL_POR_DEFECTO.id}" · ${VENTAS_POR_DIA} ventas por día`);
console.log('| Ventas | Abonos banco | Mediana (ms) | Mínimo (ms) | Automáticas | Sugeridas | Banco conciliado | Pases | Aristas grafo |');
console.log('|---:|---:|---:|---:|---:|---:|---:|---|---:|');
for (const n of lista) {
  const m = medir(n, n >= 100_000 ? 3 : 5);
  console.log(`| ${m.ventas} | ${m.banco} | ${m.medianaMs} | ${m.minMs} | ${m.automaticas} | ${m.sugeridas} | ${m.pctBancoConciliado} % | ${m.pases} | ${m.aristasGrafo} |`);
}
