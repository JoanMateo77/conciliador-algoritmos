// Montículo mínimo binario: insertar/extraer O(log n), ver O(1). En el conciliador
// sostiene TopK, que guarda los K mejores candidatos de cada movimiento.
export class MinHeap<T> {
  #datos: T[] = [];
  #comparar: (a: T, b: T) => number;

  constructor(comparar: (a: T, b: T) => number) {
    this.#comparar = comparar;
  }

  insertar(x: T): void {
    this.#datos.push(x);
    this.#flotar(this.#datos.length - 1);
  }

  extraer(): T | undefined {
    const d = this.#datos;
    if (d.length === 0) return undefined;
    const minimo = d[0];
    const ultimo = d.pop()!;
    if (d.length > 0) {
      d[0] = ultimo;
      this.#hundir(0);
    }
    return minimo;
  }

  ver(): T | undefined {
    return this.#datos[0];
  }

  get tamano(): number {
    return this.#datos.length;
  }

  // Copia ordenada de menor a mayor; no modifica el montículo.
  aArreglo(): T[] {
    return this.#datos.slice().sort(this.#comparar);
  }

  #flotar(i: number): void {
    const d = this.#datos;
    while (i > 0) {
      const padre = (i - 1) >> 1;
      if (this.#comparar(d[i], d[padre]) >= 0) break;
      [d[i], d[padre]] = [d[padre], d[i]];
      i = padre;
    }
  }

  #hundir(i: number): void {
    const d = this.#datos;
    const n = d.length;
    for (;;) {
      const izq = 2 * i + 1;
      const der = izq + 1;
      let menor = i;
      if (izq < n && this.#comparar(d[izq], d[menor]) < 0) menor = izq;
      if (der < n && this.#comparar(d[der], d[menor]) < 0) menor = der;
      if (menor === i) return;
      [d[i], d[menor]] = [d[menor], d[i]];
      i = menor;
    }
  }
}

interface EntradaTopK<T> {
  x: T;
  puntaje: number;
  orden: number; // desempata: ante igual puntaje gana el que llegó primero (resultado reproducible)
}

// Los k de mayor puntaje en O(n log k) y memoria O(k): la raíz del MinHeap es el peor
// de los k guardados, el único que puede salir. Se usa para los mejores candidatos de un abono.
export class TopK<T> {
  #k: number;
  #puntaje: (x: T) => number;
  #heap: MinHeap<EntradaTopK<T>>;
  #contador = 0;

  constructor(k: number, puntaje: (x: T) => number) {
    this.#k = Math.max(0, Math.floor(k));
    this.#puntaje = puntaje;
    // "Menor" = peor: menos puntaje, o igual puntaje y llegó después.
    this.#heap = new MinHeap((a, b) => a.puntaje - b.puntaje || b.orden - a.orden);
  }

  agregar(x: T): void {
    if (this.#k === 0) return;
    const entrada = { x, puntaje: this.#puntaje(x), orden: this.#contador++ };
    if (this.#heap.tamano < this.#k) {
      this.#heap.insertar(entrada);
    } else if (entrada.puntaje > this.#heap.ver()!.puntaje) {
      this.#heap.extraer();
      this.#heap.insertar(entrada);
    }
  }

  // Mayor puntaje primero; empates en orden de llegada.
  resultado(): T[] {
    return this.#heap.aArreglo().reverse().map((e) => e.x);
  }
}
