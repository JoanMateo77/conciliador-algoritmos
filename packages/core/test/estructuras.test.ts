import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Cola, Pila, ArbolAVL, Trie, MinHeap, TopK, GrafoBipartito } from '../src/estructuras/index.ts';

// Generador congruencial lineal: datos "aleatorios" pero iguales en cada corrida.
function generador(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('Cola', () => {
  test('vacía', () => {
    const c = new Cola<number>();
    assert.equal(c.tamano, 0);
    assert.equal(c.estaVacia(), true);
    assert.equal(c.desencolar(), undefined);
    assert.equal(c.frente(), undefined);
    assert.deepEqual(c.aArreglo(), []);
  });

  test('un elemento', () => {
    const c = new Cola<string>();
    c.encolar('a');
    assert.equal(c.frente(), 'a');
    assert.equal(c.tamano, 1);
    assert.equal(c.desencolar(), 'a');
    assert.equal(c.estaVacia(), true);
  });

  test('muchos elementos mantienen FIFO a través de la compactación', () => {
    const c = new Cola<number>();
    const esperado: number[] = [];
    let siguiente = 0;
    const azar = generador(7);
    for (let i = 0; i < 5000; i++) {
      if (azar() < 0.6) { c.encolar(siguiente); esperado.push(siguiente++); }
      else assert.equal(c.desencolar(), esperado.shift());
      assert.equal(c.tamano, esperado.length);
    }
    assert.deepEqual(c.aArreglo(), esperado);
    while (!c.estaVacia()) assert.equal(c.desencolar(), esperado.shift());
    assert.equal(c.desencolar(), undefined);
  });
});

describe('Pila', () => {
  test('vacía', () => {
    const p = new Pila<number>();
    assert.equal(p.desapilar(), undefined);
    assert.equal(p.cima(), undefined);
    assert.equal(p.estaVacia(), true);
    assert.equal(p.tamano, 0);
  });

  test('un elemento', () => {
    const p = new Pila<number>();
    p.apilar(1);
    assert.equal(p.cima(), 1);
    assert.equal(p.desapilar(), 1);
    assert.equal(p.estaVacia(), true);
  });

  test('muchos elementos en orden LIFO, aArreglo fondo→cima y vaciar', () => {
    const p = new Pila<number>();
    for (let i = 0; i < 100; i++) p.apilar(i);
    assert.equal(p.tamano, 100);
    assert.deepEqual(p.aArreglo().slice(0, 3), [0, 1, 2]);
    assert.equal(p.cima(), 99);
    for (let i = 99; i >= 50; i--) assert.equal(p.desapilar(), i);
    p.vaciar();
    assert.equal(p.tamano, 0);
    assert.equal(p.desapilar(), undefined);
  });
});

describe('ArbolAVL', () => {
  test('vacío', () => {
    const a = new ArbolAVL<string>();
    assert.equal(a.tamano, 0);
    assert.equal(a.altura(), 0);
    assert.deepEqual(a.buscarRango(-Infinity, Infinity), []);
    assert.deepEqual(a.enOrden(), []);
    assert.equal(a.eliminar(5, () => true), false);
  });

  test('un elemento', () => {
    const a = new ArbolAVL<string>();
    a.insertar(100, 'v1');
    assert.equal(a.altura(), 1);
    assert.deepEqual(a.buscarRango(100, 100), ['v1']);
    assert.deepEqual(a.buscarRango(101, 200), []);
    assert.equal(a.eliminar(100, (v) => v === 'v1'), true);
    assert.equal(a.tamano, 0);
    assert.equal(a.altura(), 0);
  });

  test('claves repetidas comparten nodo y se eliminan una por una', () => {
    const a = new ArbolAVL<string>();
    a.insertar(5000, 'a');
    a.insertar(5000, 'b');
    a.insertar(3000, 'c');
    assert.equal(a.tamano, 3);
    assert.equal(a.altura(), 2);
    assert.deepEqual(a.buscarRango(5000, 5000), ['a', 'b']);
    assert.equal(a.eliminar(5000, (v) => v === 'x'), false);
    assert.equal(a.eliminar(5000, (v) => v === 'b'), true);
    assert.deepEqual(a.buscarRango(0, 10000), ['c', 'a']);
    assert.equal(a.tamano, 2);
  });

  test('1000 inserciones ordenadas quedan balanceadas', () => {
    const a = new ArbolAVL<number>();
    const n = 1000;
    for (let i = 0; i < n; i++) a.insertar(i, i);
    assert.equal(a.tamano, n);
    assert.ok(a.altura() <= 1.45 * Math.log2(n + 2), `altura ${a.altura()}`);
    assert.deepEqual(a.enOrden().map((e) => e.clave), Array.from({ length: n }, (_, i) => i));
    // También en orden descendente (ejercita las rotaciones del otro lado).
    const b = new ArbolAVL<number>();
    for (let i = n; i > 0; i--) b.insertar(i, i);
    assert.ok(b.altura() <= 1.45 * Math.log2(n + 2));
  });

  test('buscarRango coincide con fuerza bruta en datos pseudoaleatorios', () => {
    const azar = generador(42);
    const a = new ArbolAVL<{ id: number; monto: number }>();
    const todos: { id: number; monto: number }[] = [];
    for (let i = 0; i < 2000; i++) {
      const v = { id: i, monto: Math.floor(azar() * 500) * 100 }; // centavos, con repetidos
      a.insertar(v.monto, v);
      todos.push(v);
    }
    // Orden esperado: por clave y, dentro de la misma clave, por orden de inserción.
    const ordenados = todos.slice().sort((x, y) => x.monto - y.monto || x.id - y.id);
    for (let q = 0; q < 200; q++) {
      const p1 = Math.floor(azar() * 52000) - 1000;
      const p2 = Math.floor(azar() * 52000) - 1000;
      const [min, max] = [Math.min(p1, p2), Math.max(p1, p2)];
      const esperado = ordenados.filter((v) => v.monto >= min && v.monto <= max);
      assert.deepEqual(a.buscarRango(min, max), esperado);
    }
    assert.deepEqual(a.buscarRango(10, 5), []);
  });

  test('eliminar muchos mantiene orden, tamaño y balance', () => {
    const azar = generador(99);
    const a = new ArbolAVL<number>();
    const vivos = new Map<number, number>(); // id -> clave
    for (let i = 0; i < 1500; i++) {
      const clave = Math.floor(azar() * 300);
      a.insertar(clave, i);
      vivos.set(i, clave);
    }
    for (let i = 0; i < 1500; i += 2) {
      assert.equal(a.eliminar(vivos.get(i)!, (v) => v === i), true);
      vivos.delete(i);
    }
    assert.equal(a.eliminar(0, (v) => v === 0), false); // ya eliminado
    assert.equal(a.tamano, vivos.size);
    const claves = a.enOrden().map((e) => e.clave);
    assert.deepEqual(claves, [...vivos.values()].sort((x, y) => x - y));
    const nodos = new Set(claves).size;
    assert.ok(a.altura() <= 1.45 * Math.log2(nodos + 2));
    for (const id of [...vivos.keys()]) a.eliminar(vivos.get(id)!, (v) => v === id);
    assert.equal(a.tamano, 0);
    assert.equal(a.altura(), 0);
  });
});

describe('Trie', () => {
  test('vacío', () => {
    const t = new Trie<number>();
    assert.equal(t.tamano, 0);
    assert.deepEqual(t.buscar('ABC'), []);
    assert.deepEqual(t.buscarPrefijo('A'), []);
    assert.deepEqual(t.prefijosDe('ABC'), []);
    assert.equal(t.contiene(''), false);
  });

  test('una clave', () => {
    const t = new Trie<string>();
    t.insertar('FECHA', 'p1');
    assert.equal(t.tamano, 1);
    assert.equal(t.contiene('FECHA'), true);
    assert.equal(t.contiene('FECH'), false);
    assert.deepEqual(t.buscar('FECHA'), ['p1']);
    assert.deepEqual(t.buscarPrefijo('FE'), ['p1']);
    assert.deepEqual(t.prefijosDe('FECHAVALOR'), ['p1']);
    assert.deepEqual(t.prefijosDe('FECH'), []);
  });

  test('muchas claves, varios valores por clave y tildes', () => {
    const t = new Trie<string>();
    t.insertar('REF', 'r1');
    t.insertar('REF123', 'r2');
    t.insertar('REF123', 'r3');
    t.insertar('REF9', 'r4');
    t.insertar('OTRA', 'o1');
    t.insertar('DESCRIPCIÓN', 'd1');
    assert.equal(t.tamano, 5);
    assert.deepEqual(t.buscar('REF123'), ['r2', 'r3']);
    assert.deepEqual(t.buscarPrefijo('REF').sort(), ['r1', 'r2', 'r3', 'r4']);
    assert.deepEqual(t.buscarPrefijo(''), ['r1', 'r2', 'r3', 'r4', 'o1', 'd1']);
    assert.deepEqual(t.prefijosDe('REF12345'), ['r1', 'r2', 'r3']);
    assert.deepEqual(t.buscar('DESCRIPCIÓN'), ['d1']);
    assert.equal(t.contiene('DESCRIPCION'), false);
    // buscar devuelve copia: modificarla no altera el trie.
    t.buscar('REF').push('x');
    assert.deepEqual(t.buscar('REF'), ['r1']);
  });

  test('buscarPrefijo coincide con fuerza bruta', () => {
    const azar = generador(5);
    const t = new Trie<string>();
    const claves: string[] = [];
    for (let i = 0; i < 500; i++) {
      let k = '';
      const largo = 1 + Math.floor(azar() * 6);
      for (let j = 0; j < largo; j++) k += 'ABC'[Math.floor(azar() * 3)];
      t.insertar(k, `${k}#${i}`);
      claves.push(`${k}#${i}`);
    }
    for (const p of ['', 'A', 'AB', 'CCA', 'BBBBBB', 'ABCABCA']) {
      const esperado = claves.filter((v) => v.split('#')[0].startsWith(p)).sort();
      assert.deepEqual(t.buscarPrefijo(p).sort(), esperado);
      const pre = claves.filter((v) => p.startsWith(v.split('#')[0])).sort();
      assert.deepEqual(t.prefijosDe(p).sort(), pre);
    }
  });
});

describe('MinHeap', () => {
  test('vacío', () => {
    const h = new MinHeap<number>((a, b) => a - b);
    assert.equal(h.tamano, 0);
    assert.equal(h.extraer(), undefined);
    assert.equal(h.ver(), undefined);
    assert.deepEqual(h.aArreglo(), []);
  });

  test('un elemento', () => {
    const h = new MinHeap<number>((a, b) => a - b);
    h.insertar(7);
    assert.equal(h.ver(), 7);
    assert.equal(h.extraer(), 7);
    assert.equal(h.tamano, 0);
  });

  test('muchos elementos salen ordenados', () => {
    const azar = generador(11);
    const h = new MinHeap<number>((a, b) => a - b);
    const datos = Array.from({ length: 1000 }, () => Math.floor(azar() * 1000));
    for (const x of datos) h.insertar(x);
    const ordenados = datos.slice().sort((a, b) => a - b);
    assert.deepEqual(h.aArreglo(), ordenados);
    assert.equal(h.tamano, 1000); // aArreglo no consume
    const salida: number[] = [];
    while (h.tamano > 0) salida.push(h.extraer()!);
    assert.deepEqual(salida, ordenados);
  });
});

describe('TopK', () => {
  test('vacío y k = 0', () => {
    assert.deepEqual(new TopK<number>(3, (x) => x).resultado(), []);
    const cero = new TopK<number>(0, (x) => x);
    cero.agregar(5);
    assert.deepEqual(cero.resultado(), []);
  });

  test('menos elementos que k', () => {
    const t = new TopK<number>(5, (x) => x);
    t.agregar(2);
    t.agregar(9);
    assert.deepEqual(t.resultado(), [9, 2]);
  });

  test('coincide con ordenar y cortar, con empates en orden de llegada', () => {
    const azar = generador(2024);
    for (const k of [1, 3, 10, 50]) {
      const datos = Array.from({ length: 800 }, (_, id) => ({ id, p: Math.floor(azar() * 100) / 100 }));
      const t = new TopK<{ id: number; p: number }>(k, (x) => x.p);
      for (const d of datos) t.agregar(d);
      const esperado = datos.slice().sort((a, b) => b.p - a.p || a.id - b.id).slice(0, k);
      assert.deepEqual(t.resultado(), esperado);
    }
  });
});

describe('GrafoBipartito', () => {
  test('vacío', () => {
    const g = new GrafoBipartito();
    assert.equal(g.cantidadNodos, 0);
    assert.equal(g.cantidadAristas, 0);
    assert.deepEqual(g.componentes(), []);
    assert.deepEqual(g.vecinos('x'), []);
    assert.deepEqual(g.aristas(), []);
    g.quitarNodo('x'); // no falla
  });

  test('un nodo aislado es su propia componente', () => {
    const g = new GrafoBipartito();
    g.agregarNodo('b1', 'banco');
    g.agregarNodo('b1', 'banco'); // repetido: sin efecto
    assert.equal(g.cantidadNodos, 1);
    assert.deepEqual(g.componentes(), [['b1']]);
    assert.throws(() => g.agregarNodo('b1', 'ventas'));
  });

  test('aristas, vecinos, componentes y quitarNodo', () => {
    const g = new GrafoBipartito();
    g.agregarArista('b1', 'v1', 0.9);
    g.agregarArista('b1', 'v2', 0.7);
    g.agregarArista('b2', 'v2', 0.8);
    g.agregarArista('b3', 'v3', 1);
    g.agregarNodo('v4', 'ventas');
    g.agregarArista('b1', 'v1', 0.95); // repetida: actualiza el peso
    assert.equal(g.cantidadNodos, 7);
    assert.equal(g.cantidadAristas, 4);
    assert.deepEqual(g.vecinos('b1'), [{ id: 'v1', peso: 0.95 }, { id: 'v2', peso: 0.7 }]);
    assert.deepEqual(g.vecinos('v2'), [{ id: 'b1', peso: 0.7 }, { id: 'b2', peso: 0.8 }]);
    assert.deepEqual(g.componentes(), [['b1', 'v1', 'v2', 'b2'], ['b3', 'v3'], ['v4']]);
    assert.deepEqual(g.aristas(), [
      { banco: 'b1', venta: 'v1', peso: 0.95 },
      { banco: 'b1', venta: 'v2', peso: 0.7 },
      { banco: 'b2', venta: 'v2', peso: 0.8 },
      { banco: 'b3', venta: 'v3', peso: 1 },
    ]);
    assert.deepEqual(g.nodos().find((n) => n.id === 'v4'), { id: 'v4', lado: 'ventas' });
    assert.throws(() => g.agregarArista('v1', 'b2', 0.5)); // lados invertidos

    g.quitarNodo('v2'); // parte la primera componente en dos
    assert.equal(g.cantidadAristas, 2);
    assert.deepEqual(g.vecinos('b2'), []);
    assert.deepEqual(g.componentes(), [['b1', 'v1'], ['b2'], ['b3', 'v3'], ['v4']]);
  });

  test('muchos nodos: componentes cubren todo sin repetir', () => {
    const azar = generador(3);
    const g = new GrafoBipartito();
    for (let i = 0; i < 300; i++) g.agregarNodo(`b${i}`, 'banco');
    for (let i = 0; i < 300; i++) g.agregarNodo(`v${i}`, 'ventas');
    for (let i = 0; i < 250; i++) {
      g.agregarArista(`b${Math.floor(azar() * 300)}`, `v${Math.floor(azar() * 300)}`, azar());
    }
    const comps = g.componentes();
    const todos = comps.flat();
    assert.equal(todos.length, 600);
    assert.equal(new Set(todos).size, 600);
    // Ninguna arista cruza componentes.
    const compDe = new Map<string, number>();
    comps.forEach((c, i) => c.forEach((id) => compDe.set(id, i)));
    for (const a of g.aristas()) assert.equal(compDe.get(a.banco), compDe.get(a.venta));
    assert.equal(g.aristas().length, g.cantidadAristas);
  });
});
