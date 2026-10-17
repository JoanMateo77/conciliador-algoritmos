// Árbol AVL por clave numérica: insertar/eliminar O(log n), buscarRango O(log n + k).
// En el conciliador indexa ventas por monto para hallar candidatas dentro de la tolerancia.

interface NodoAVL<T> {
  clave: number;
  valores: T[]; // claves repetidas (mismo monto) comparten nodo
  izq: NodoAVL<T> | null;
  der: NodoAVL<T> | null;
  altura: number; // hoja = 1
}

function alturaDe<T>(n: NodoAVL<T> | null): number {
  return n === null ? 0 : n.altura;
}

function actualizar<T>(n: NodoAVL<T>): void {
  n.altura = 1 + Math.max(alturaDe(n.izq), alturaDe(n.der));
}

function factor<T>(n: NodoAVL<T>): number {
  return alturaDe(n.izq) - alturaDe(n.der);
}

function rotarDerecha<T>(y: NodoAVL<T>): NodoAVL<T> {
  const x = y.izq!;
  y.izq = x.der;
  x.der = y;
  actualizar(y);
  actualizar(x);
  return x;
}

function rotarIzquierda<T>(x: NodoAVL<T>): NodoAVL<T> {
  const y = x.der!;
  x.der = y.izq;
  y.izq = x;
  actualizar(x);
  actualizar(y);
  return y;
}

// Restaura la propiedad AVL en n; cubre los cuatro casos (II, DD, ID, DI).
function balancear<T>(n: NodoAVL<T>): NodoAVL<T> {
  actualizar(n);
  const f = factor(n);
  if (f > 1) {
    if (factor(n.izq!) < 0) n.izq = rotarIzquierda(n.izq!); // doble izquierda-derecha
    return rotarDerecha(n);
  }
  if (f < -1) {
    if (factor(n.der!) > 0) n.der = rotarDerecha(n.der!); // doble derecha-izquierda
    return rotarIzquierda(n);
  }
  return n;
}

export class ArbolAVL<T> {
  #raiz: NodoAVL<T> | null = null;
  #tamano = 0;

  insertar(clave: number, valor: T): void {
    if (Number.isNaN(clave)) throw new Error('La clave del AVL no puede ser NaN');
    this.#raiz = this.#insertar(this.#raiz, clave, valor);
    this.#tamano++;
  }

  #insertar(n: NodoAVL<T> | null, clave: number, valor: T): NodoAVL<T> {
    if (n === null) return { clave, valores: [valor], izq: null, der: null, altura: 1 };
    if (clave === n.clave) {
      n.valores.push(valor); // no cambia la forma del árbol
      return n;
    }
    if (clave < n.clave) n.izq = this.#insertar(n.izq, clave, valor);
    else n.der = this.#insertar(n.der, clave, valor);
    return balancear(n);
  }

  // Quita el primer valor con esa clave que cumpla `coincide`; el nodo se borra si queda vacío.
  eliminar(clave: number, coincide: (v: T) => boolean): boolean {
    const estado = { quitado: false };
    this.#raiz = this.#eliminar(this.#raiz, clave, coincide, estado);
    if (estado.quitado) this.#tamano--;
    return estado.quitado;
  }

  #eliminar(n: NodoAVL<T> | null, clave: number, coincide: (v: T) => boolean,
    estado: { quitado: boolean }): NodoAVL<T> | null {
    if (n === null) return null;
    if (clave < n.clave) {
      n.izq = this.#eliminar(n.izq, clave, coincide, estado);
    } else if (clave > n.clave) {
      n.der = this.#eliminar(n.der, clave, coincide, estado);
    } else {
      const i = n.valores.findIndex(coincide);
      if (i < 0) return n;
      n.valores.splice(i, 1);
      estado.quitado = true;
      if (n.valores.length > 0) return n;
      // Nodo vacío: se borra como en un ABB y luego se rebalancea.
      if (n.izq === null) return n.der;
      if (n.der === null) return n.izq;
      // Dos hijos: se sube el sucesor (mínimo del subárbol derecho).
      let sucesor = n.der;
      while (sucesor.izq !== null) sucesor = sucesor.izq;
      n.clave = sucesor.clave;
      n.valores = sucesor.valores;
      n.der = this.#quitarMinimo(n.der);
    }
    return balancear(n);
  }

  #quitarMinimo(n: NodoAVL<T>): NodoAVL<T> | null {
    if (n.izq === null) return n.der;
    n.izq = this.#quitarMinimo(n.izq);
    return balancear(n);
  }

  // Inclusivo y ordenado por clave; poda las ramas que no pueden tener claves en [min, max].
  buscarRango(min: number, max: number): T[] {
    const salida: T[] = [];
    if (min > max) return salida;
    const recorrer = (n: NodoAVL<T> | null): void => {
      if (n === null) return;
      if (n.clave > min) recorrer(n.izq);
      if (n.clave >= min && n.clave <= max) for (const v of n.valores) salida.push(v);
      if (n.clave < max) recorrer(n.der);
    };
    recorrer(this.#raiz);
    return salida;
  }

  // Cantidad de valores, no de nodos.
  get tamano(): number {
    return this.#tamano;
  }

  // Altura en nodos: vacío = 0, solo raíz = 1.
  altura(): number {
    return alturaDe(this.#raiz);
  }

  enOrden(): { clave: number; valor: T }[] {
    const salida: { clave: number; valor: T }[] = [];
    const recorrer = (n: NodoAVL<T> | null): void => {
      if (n === null) return;
      recorrer(n.izq);
      for (const valor of n.valores) salida.push({ clave: n.clave, valor });
      recorrer(n.der);
    };
    recorrer(this.#raiz);
    return salida;
  }
}
