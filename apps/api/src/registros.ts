// Registros estructurados: una línea JSON por evento, fácil de filtrar en Render o con jq.
// LOG_NIVEL = depurar | info | aviso | error | silencio. Bajo `node --test` se silencia
// por defecto para no ensuciar la salida de las pruebas.

export type Nivel = 'depurar' | 'info' | 'aviso' | 'error';
const ORDEN: Record<Nivel | 'silencio', number> = { depurar: 10, info: 20, aviso: 30, error: 40, silencio: 100 };

function nivelMinimo(): number {
  const pedido = process.env.LOG_NIVEL as Nivel | 'silencio' | undefined;
  if (pedido && pedido in ORDEN) return ORDEN[pedido];
  return process.env.NODE_TEST_CONTEXT ? ORDEN.silencio : ORDEN.info;
}

export function registrar(nivel: Nivel, evento: string, datos: Record<string, unknown> = {}): void {
  if (ORDEN[nivel] < nivelMinimo()) return;
  const linea = JSON.stringify({ ts: new Date().toISOString(), nivel, evento, ...datos }, (_clave, valor) =>
    valor instanceof Error ? { mensaje: valor.message, pila: valor.stack } : valor);
  if (ORDEN[nivel] >= ORDEN.aviso) process.stderr.write(linea + '\n');
  else process.stdout.write(linea + '\n');
}
