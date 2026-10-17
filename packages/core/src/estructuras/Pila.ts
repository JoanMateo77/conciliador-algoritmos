// Pila LIFO: apilar y desapilar O(1). En el conciliador son las pilas de
// deshacer y rehacer de la sesión de revisión.
export class Pila<T> {
  #datos: T[] = [];

  apilar(x: T): void {
    this.#datos.push(x);
  }

  desapilar(): T | undefined {
    return this.#datos.pop();
  }

  cima(): T | undefined {
    return this.#datos.length > 0 ? this.#datos[this.#datos.length - 1] : undefined;
  }

  get tamano(): number {
    return this.#datos.length;
  }

  estaVacia(): boolean {
    return this.#datos.length === 0;
  }

  // Al hacer una acción nueva se vacía la pila de rehacer.
  vaciar(): void {
    this.#datos = [];
  }

  // Copia del fondo a la cima.
  aArreglo(): T[] {
    return this.#datos.slice();
  }
}
