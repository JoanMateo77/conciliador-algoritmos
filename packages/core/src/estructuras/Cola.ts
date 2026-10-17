// Cola FIFO: encolar y desencolar O(1) amortizado. En el conciliador guarda los
// archivos en espera de procesar, en orden de llegada, y sirve al BFS del grafo.
export class Cola<T> {
  #datos: T[] = [];
  #inicio = 0; // posición del frente; evita shift(), que es O(n)

  encolar(x: T): void {
    this.#datos.push(x);
  }

  desencolar(): T | undefined {
    if (this.#inicio >= this.#datos.length) return undefined;
    const x = this.#datos[this.#inicio];
    this.#datos[this.#inicio] = undefined as T; // suelta la referencia para el recolector
    this.#inicio++;
    // Compacta solo cuando la parte muerta domina: el costo se reparte entre muchas operaciones.
    if (this.#inicio >= 32 && this.#inicio * 2 >= this.#datos.length) {
      this.#datos = this.#datos.slice(this.#inicio);
      this.#inicio = 0;
    }
    return x;
  }

  frente(): T | undefined {
    return this.#inicio < this.#datos.length ? this.#datos[this.#inicio] : undefined;
  }

  get tamano(): number {
    return this.#datos.length - this.#inicio;
  }

  estaVacia(): boolean {
    return this.tamano === 0;
  }

  // Copia del frente al final.
  aArreglo(): T[] {
    return this.#datos.slice(this.#inicio);
  }
}
