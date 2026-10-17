import { Cola } from './Cola.ts';

type LadoGrafo = 'banco' | 'ventas';

interface NodoGrafo {
  lado: LadoGrafo;
  adyacentes: Map<string, number>; // id vecino -> peso
}

// Grafo bipartito banco↔ventas con lista de adyacencia: aristas O(1), componentes O(V + E).
// En el conciliador une abonos con ventas candidatas; cada componente es un conflicto a resolver.
export class GrafoBipartito {
  #nodos = new Map<string, NodoGrafo>();
  #aristas = 0;

  // Repetir un nodo con el mismo lado no hace nada; con otro lado es un error.
  agregarNodo(id: string, lado: LadoGrafo): void {
    const existente = this.#nodos.get(id);
    if (existente) {
      if (existente.lado !== lado) throw new Error(`El nodo "${id}" ya existe en el lado ${existente.lado}`);
      return;
    }
    this.#nodos.set(id, { lado, adyacentes: new Map() });
  }

  // Crea los nodos si faltan. Repetir la arista reemplaza el peso.
  agregarArista(idBanco: string, idVenta: string, peso: number): void {
    this.agregarNodo(idBanco, 'banco');
    this.agregarNodo(idVenta, 'ventas');
    const banco = this.#nodos.get(idBanco)!;
    if (!banco.adyacentes.has(idVenta)) this.#aristas++;
    banco.adyacentes.set(idVenta, peso);
    this.#nodos.get(idVenta)!.adyacentes.set(idBanco, peso);
  }

  vecinos(id: string): { id: string; peso: number }[] {
    const n = this.#nodos.get(id);
    if (!n) return [];
    return [...n.adyacentes].map(([vecino, peso]) => ({ id: vecino, peso }));
  }

  quitarNodo(id: string): void {
    const n = this.#nodos.get(id);
    if (!n) return;
    for (const vecino of n.adyacentes.keys()) this.#nodos.get(vecino)!.adyacentes.delete(id);
    this.#aristas -= n.adyacentes.size;
    this.#nodos.delete(id);
  }

  // BFS desde cada nodo no visitado, en orden de inserción: resultado reproducible.
  componentes(): string[][] {
    const visitados = new Set<string>();
    const salida: string[][] = [];
    for (const inicio of this.#nodos.keys()) {
      if (visitados.has(inicio)) continue;
      const componente: string[] = [];
      const cola = new Cola<string>();
      cola.encolar(inicio);
      visitados.add(inicio);
      while (!cola.estaVacia()) {
        const id = cola.desencolar()!;
        componente.push(id);
        for (const vecino of this.#nodos.get(id)!.adyacentes.keys()) {
          if (!visitados.has(vecino)) {
            visitados.add(vecino);
            cola.encolar(vecino);
          }
        }
      }
      salida.push(componente);
    }
    return salida;
  }

  nodos(): { id: string; lado: LadoGrafo }[] {
    return [...this.#nodos].map(([id, n]) => ({ id, lado: n.lado }));
  }

  // Cada arista una sola vez, recorrida desde su lado banco.
  aristas(): { banco: string; venta: string; peso: number }[] {
    const salida: { banco: string; venta: string; peso: number }[] = [];
    for (const [id, n] of this.#nodos) {
      if (n.lado !== 'banco') continue;
      for (const [venta, peso] of n.adyacentes) salida.push({ banco: id, venta, peso });
    }
    return salida;
  }

  get cantidadNodos(): number {
    return this.#nodos.size;
  }

  get cantidadAristas(): number {
    return this.#aristas;
  }
}
