// Trie de texto: insertar/buscar O(largo de la clave). En el conciliador detecta la
// plantilla por encabezados o prefijo de línea y busca referencias por prefijo.

interface NodoTrie<T> {
  hijos: Map<string, NodoTrie<T>>;
  valores: T[] | null; // null = ninguna clave termina aquí
}

function nuevoNodo<T>(): NodoTrie<T> {
  return { hijos: new Map(), valores: null };
}

export class Trie<T> {
  #raiz: NodoTrie<T> = nuevoNodo();
  #tamano = 0;

  insertar(clave: string, valor: T): void {
    let n = this.#raiz;
    for (const c of clave) { // for..of recorre por punto de código, no rompe tildes ni emojis
      let hijo = n.hijos.get(c);
      if (hijo === undefined) {
        hijo = nuevoNodo();
        n.hijos.set(c, hijo);
      }
      n = hijo;
    }
    if (n.valores === null) {
      n.valores = [];
      this.#tamano++;
    }
    n.valores.push(valor);
  }

  #nodo(clave: string): NodoTrie<T> | undefined {
    let n: NodoTrie<T> | undefined = this.#raiz;
    for (const c of clave) {
      n = n.hijos.get(c);
      if (n === undefined) return undefined;
    }
    return n;
  }

  buscar(clave: string): T[] {
    const n = this.#nodo(clave);
    return n?.valores ? n.valores.slice() : [];
  }

  // Valores de todas las claves que empiezan por `prefijo` (preorden, orden de inserción).
  buscarPrefijo(prefijo: string): T[] {
    const inicio = this.#nodo(prefijo);
    const salida: T[] = [];
    if (inicio === undefined) return salida;
    const pendientes: NodoTrie<T>[] = [inicio]; // pila explícita: sin riesgo de desbordar con claves largas
    while (pendientes.length > 0) {
      const n = pendientes.pop()!;
      if (n.valores) salida.push(...n.valores);
      const hijos = [...n.hijos.values()];
      for (let i = hijos.length - 1; i >= 0; i--) pendientes.push(hijos[i]);
    }
    return salida;
  }

  // Valores de las claves que son prefijo de `texto`, de la más corta a la más larga.
  prefijosDe(texto: string): T[] {
    const salida: T[] = [];
    let n: NodoTrie<T> | undefined = this.#raiz;
    if (n.valores) salida.push(...n.valores);
    for (const c of texto) {
      n = n.hijos.get(c);
      if (n === undefined) break;
      if (n.valores) salida.push(...n.valores);
    }
    return salida;
  }

  contiene(clave: string): boolean {
    return this.#nodo(clave)?.valores != null;
  }

  // Cantidad de claves distintas.
  get tamano(): number {
    return this.#tamano;
  }
}
