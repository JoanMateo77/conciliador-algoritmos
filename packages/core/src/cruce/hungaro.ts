// Algoritmo Húngaro (Kuhn-Munkres) con potenciales, implementación propia.
// Resuelve la asignación de costo mínimo en O(n²·m) con n filas <= m columnas;
// para una matriz cuadrada de lado k es O(k³). Se usa en el pase 2 para elegir,
// dentro de cada componente del grafo, el emparejamiento de mayor puntaje total.

// Asignación de costo mínimo. costo[f][c] finito; requiere filas <= columnas.
// Devuelve, para cada fila, la columna asignada (todas las filas quedan asignadas).
export function asignacionMinima(costo: number[][]): number[] {
  const n = costo.length;
  if (n === 0) return [];
  const m = costo[0].length;
  if (n > m) throw new Error('asignacionMinima: se necesitan al menos tantas columnas como filas');
  // Índices desde 1: la columna 0 es ficticia y simplifica el recorrido de caminos aumentantes.
  const u = new Array<number>(n + 1).fill(0);   // potencial de filas
  const v = new Array<number>(m + 1).fill(0);   // potencial de columnas
  const p = new Array<number>(m + 1).fill(0);   // p[c] = fila asignada a la columna c
  const camino = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minimo = new Array<number>(m + 1).fill(Infinity);
    const usada = new Array<boolean>(m + 1).fill(false);
    do {
      usada[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (usada[j]) continue;
        const actual = costo[i0 - 1][j - 1] - u[i0] - v[j];
        if (actual < minimo[j]) { minimo[j] = actual; camino[j] = j0; }
        if (minimo[j] < delta) { delta = minimo[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (usada[j]) { u[p[j]] += delta; v[j] -= delta; } else minimo[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    // Invierte el camino aumentante encontrado.
    do {
      const j1 = camino[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  const salida = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j] !== 0) salida[p[j] - 1] = j - 1;
  return salida;
}

// Emparejamiento de peso máximo en una matriz rectangular. null (o peso <= 0) = sin arista:
// esas parejas nunca se devuelven, así un nodo puede quedar sin pareja.
// Con pesos enteros el resultado es exacto (sin errores de redondeo al sumar).
export function emparejamientoMaximo(pesos: (number | null)[][]): { fila: number; columna: number }[] {
  const filas = pesos.length;
  const columnas = filas === 0 ? 0 : pesos[0].length;
  if (filas === 0 || columnas === 0) return [];
  // Matriz cuadrada: sobrar en un lado equivale a casarse con un nodo ficticio de costo 0.
  const k = Math.max(filas, columnas);
  const costo: number[][] = [];
  for (let f = 0; f < k; f++) {
    const fila = new Array<number>(k).fill(0);
    for (let c = 0; c < k; c++) {
      const w = f < filas && c < columnas ? pesos[f][c] : null;
      if (w !== null && w > 0) fila[c] = -w;
    }
    costo.push(fila);
  }
  const asignada = asignacionMinima(costo);
  const salida: { fila: number; columna: number }[] = [];
  for (let f = 0; f < filas; f++) {
    const c = asignada[f];
    const w = c < columnas ? pesos[f][c] : null;
    if (w !== null && w > 0) salida.push({ fila: f, columna: c });
  }
  return salida;
}
