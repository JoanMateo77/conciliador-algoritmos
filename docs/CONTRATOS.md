# Contratos entre módulos

Este archivo es la fuente de verdad para quienes construyen cada módulo.
Si un módulo necesita algo que no está aquí, se agrega aquí primero.

Convenciones para todo el código:

- TypeScript que Node 24 ejecuta sin compilar (type stripping). Solo sintaxis
  borrable: nada de `enum`, `namespace`, propiedades en parámetros del
  constructor ni decoradores. Importar con extensión `.ts` y usar
  `import type` para tipos.
- Nombres en español, igual que `src/modelo.ts`. Comentarios cortos que
  expliquen el porqué.
- Dinero siempre en centavos enteros (`number` entero seguro). Nunca
  decimales.
- El núcleo (`packages/core`) no tiene dependencias, no lee archivos ni usa
  red ni `Date.now()` dentro del cruce (resultados reproducibles).
- Pruebas con `node:test` y `node:assert/strict`, archivos `*.test.ts` en
  `packages/core/test/` (o `apps/api/test/`). Se corren con `npm test` desde
  la raíz.

## 1. Modelo (`packages/core/src/modelo.ts`, ya existe)

`Lado`, `Desglose`, `Movimiento`, `ErrorDeDato`, `aCentavos`,
`normalizarReferencia`, `aFechaISO`, `diasEntre`, `formatearCOP`.

## 2. Estructuras (`packages/core/src/estructuras/`)

Implementaciones propias, sin usar estructuras de librerías. Cada una en su
archivo, exportada por nombre.

```ts
// Cola.ts — FIFO con índice de inicio (desencolar O(1) sin shift)
class Cola<T> { encolar(x: T): void; desencolar(): T | undefined; frente(): T | undefined;
  get tamano(): number; estaVacia(): boolean; aArreglo(): T[] }

// Pila.ts — LIFO
class Pila<T> { apilar(x: T): void; desapilar(): T | undefined; cima(): T | undefined;
  get tamano(): number; estaVacia(): boolean; vaciar(): void; aArreglo(): T[] /* fondo→cima */ }

// ArbolAVL.ts — clave numérica, admite claves repetidas (lista de valores por nodo)
class ArbolAVL<T> { insertar(clave: number, valor: T): void;
  eliminar(clave: number, coincide: (v: T) => boolean): boolean;
  buscarRango(min: number, max: number): T[]   // inclusivo, ordenado por clave, O(log n + k)
  get tamano(): number /* valores */; altura(): number; enOrden(): { clave: number; valor: T }[] }

// Trie.ts — claves texto, varios valores por clave
class Trie<T> { insertar(clave: string, valor: T): void; buscar(clave: string): T[];
  buscarPrefijo(prefijo: string): T[]          // valores de todas las claves que empiezan así
  prefijosDe(texto: string): T[]               // valores de las claves que son prefijo de texto
  contiene(clave: string): boolean; get tamano(): number /* claves */ }

// MinHeap.ts
class MinHeap<T> { constructor(comparar: (a: T, b: T) => number);
  insertar(x: T): void; extraer(): T | undefined; ver(): T | undefined;
  get tamano(): number; aArreglo(): T[] }
class TopK<T> { constructor(k: number, puntaje: (x: T) => number);  // usa MinHeap de tamaño k
  agregar(x: T): void; resultado(): T[] /* mayor puntaje primero */ }

// GrafoBipartito.ts — lista de adyacencia
class GrafoBipartito { agregarNodo(id: string, lado: 'banco' | 'ventas'): void;
  agregarArista(idBanco: string, idVenta: string, peso: number): void;
  vecinos(id: string): { id: string; peso: number }[]; quitarNodo(id: string): void;
  componentes(): string[][]   // BFS; cada componente con sus ids
  nodos(): { id: string; lado: 'banco' | 'ventas' }[];
  aristas(): { banco: string; venta: string; peso: number }[];
  get cantidadNodos(): number; get cantidadAristas(): number }
```

`estructuras/index.ts` reexporta todas.

## 3. Plantillas (`packages/core/src/plantillas/`)

Una plantilla es JSON puro que describe un formato. Agregar un banco nuevo es
agregar un JSON, sin código.

```ts
type CampoDestino = 'id' | 'fecha' | 'monto' | 'referencia' | 'descripcion' | 'referenciaPago'
  | 'bruto' | 'comision' | 'ivaComision' | 'retenciones';

type Mapeo = string   // delimitado: nombre de columna (o índice "#3"); ancho fijo: no aplica
  | {
      de?: string;              // columna origen (delimitado)
      inicio?: number;          // ancho fijo: posición 1-based
      longitud?: number;        // ancho fijo
      unir?: string[];          // concatena varias columnas con espacio
      regex?: string;           // se toma el grupo 1 (o el match completo)
      decimalesImplicitos?: number; // montos sin separador (Asobancaria)
      signo?: 'negar' | 'abs';
      fijo?: string;            // valor constante
    };

interface Plantilla {
  id: string; nombre: string; version: number; lado: 'banco' | 'ventas';
  descripcion?: string; fuente?: string;            // de dónde sale el formato (documentación pública)
  tipo: 'delimitado' | 'anchoFijo';
  codificacion?: 'utf-8' | 'latin1';                 // la decodifica quien lee el archivo (panel/API)
  separador?: string;                                // delimitado; si falta se detecta entre , ; \t |
  separadorDecimal?: ',' | '.';                      // por defecto ','
  formatoFecha: string;                              // ej. 'dd/MM/yyyy', 'yyyy-MM-dd', 'yyyyMMdd'
  filasEncabezado?: number;                          // delimitado: por defecto 1
  registroDetalle?: { inicio: number; longitud: number; valor: string }; // ancho fijo: qué líneas leer
  omitirSi?: { campo: string; regex: string }[];     // descarta filas (totales, saldos, rechazadas)
  soloEntradas?: boolean;                            // descarta montos <= 0
  detectar?: { encabezados?: string[]; prefijoLinea?: string };
  columnas: Partial<Record<CampoDestino, Mapeo>>;    // fecha y monto obligatorios
}

validarPlantilla(p: unknown): { ok: true; plantilla: Plantilla } | { ok: false; errores: string[] }
leerArchivo(texto: string, plantilla: Plantilla):
  { movimientos: Movimiento[]; errores: { linea: number; mensaje: string }[] }
  // Una línea mala no detiene el archivo: va a errores. Si falta 'id', se usa `${plantilla.id}:${linea}`.
  // CSV con comillas dobles y separadores dentro de comillas debe funcionar.

class RegistroPlantillas {
  registrar(p: Plantilla): void           // valida; lanza Error con la lista de errores
  obtener(id: string): Plantilla | undefined
  listar(): Plantilla[]
  detectar(texto: string): { plantilla: Plantilla; confianza: number }[]
  // Usa Trie: encabezados normalizados -> plantillas, y prefijoLinea -> plantillas (prefijosDe).
  // Ordena por confianza (fracción de encabezados encontrados; prefijo exacto = 1).
}
```

Archivos: `tipos.ts`, `validar.ts`, `csv.ts`, `leer.ts`, `registro.ts`, `index.ts`.

## 4. Ingesta (`packages/core/src/ingesta.ts`)

```ts
interface ArchivoEntrada { nombre: string; texto: string; plantillaId?: string }
interface ResultadoIngesta { nombre: string; plantillaId: string | null; movimientos: Movimiento[];
  errores: { linea: number; mensaje: string }[] }
procesarArchivos(archivos: ArchivoEntrada[], registro: RegistroPlantillas): ResultadoIngesta[]
// Usa Cola: encola todos, procesa en orden de llegada; un archivo sin plantilla
// detectable queda con plantillaId null y un error, sin frenar a los demás.
```

## 5. Perfiles y cruce (`packages/core/src/cruce/`)

```ts
interface Perfil {
  id: string; nombre: string;
  toleranciaFaltanteCentavos: number;   // el banco puede traer hasta esto MENOS (comisiones)
  toleranciaFaltantePorcentaje: number; // o hasta este % menos, ej. 0.04; se usa el mayor
  toleranciaSobranteCentavos: number;   // sobrepagos: normalmente 0
  ventanaDias: number;                  // la venta puede ser hasta N días antes del abono
  diasDespues: number;                  // o hasta N días después (normalmente 0 o 1)
  maxGrupo: number;                     // máximo de ventas en un abono agrupado (p. ej. 8)
  umbralAutomatico: number;             // 0..1, p. ej. 0.9
  umbralSugerencia: number;             // 0..1, p. ej. 0.6
  retenciones: { nombre: string; tasa: number }[]; // explican faltantes, ej. ReteFuente 0.015
}
PERFIL_POR_DEFECTO: Perfil
validarPerfil(p: unknown): { ok: true; perfil: Perfil } | { ok: false; errores: string[] }

interface Coincidencia {
  id: string;                        // estable: 'c1', 'c2'... en orden de creación
  tipo: 'exacta' | 'tolerancia' | 'agrupada' | 'manual';
  bancoIds: string[]; ventasIds: string[];
  puntaje: number;                   // 0..1
  diferenciaCentavos: number;        // suma banco - suma ventas (negativo = llegó menos)
  explicacion: string;               // en español, ej. "Faltan $1.540 ≈ comisión 3,5 %"
  estado: 'automatica' | 'sugerida'; // según umbrales del perfil
}

interface ResultadoConciliacion {
  coincidencias: Coincidencia[];
  sinCruzarBanco: string[]; sinCruzarVentas: string[];
  resumen: { movimientosBanco: number; movimientosVentas: number; automaticas: number;
    sugeridas: number; sinCruzarBanco: number; sinCruzarVentas: number;
    totalBancoCentavos: number; totalVentasCentavos: number; totalConciliadoCentavos: number };
  grafo: { nodos: { id: string; lado: 'banco' | 'ventas' }[];
    aristas: { banco: string; venta: string; peso: number }[] };   // candidatos del pase 2
  pases: { nombre: string; coincidencias: number }[];
}

conciliar(banco: Movimiento[], ventas: Movimiento[], perfil?: Perfil): ResultadoConciliacion
```

Pases, de barato a caro (cada uno trabaja solo con lo que quedó libre):

1. **Exacta** (Map por `monto|referencia`, y luego por `monto|fecha`): O(n + m).
2. **Tolerancia 1:1**: ventas en un `ArbolAVL` por monto; para cada abono se
   busca el rango permitido por el perfil y la ventana de fechas. Puntaje
   por monto, fecha y similitud de referencia (Levenshtein normalizado o
   prefijo vía `Trie`). `TopK` guarda los mejores candidatos. Las aristas
   van al `GrafoBipartito`; en cada componente se asigna de mayor a menor
   puntaje sin repetir nodos (greedy por componente, documentado).
3. **Agrupada N:1**: para cada abono libre, ventas libres en la ventana de
   fechas cuya suma cae dentro de la tolerancia. Backtracking con poda
   (ventas ordenadas por monto desc, corta si la suma pasa el máximo),
   máximo `maxGrupo` ventas y máximo 40 candidatos por abono; si hay más,
   se deja a revisión manual y se informa en `pases`.

`explicacion` usa las retenciones del perfil: si el faltante coincide (±1 %)
con comisión + retenciones conocidas, lo dice.

Archivos: `perfil.ts`, `puntaje.ts`, `pases.ts`, `conciliar.ts`, `index.ts`.

## 6. Sesión de revisión (`packages/core/src/sesion.ts`)

```ts
type Evento =
  | { tipo: 'confirmar'; coincidenciaId: string }
  | { tipo: 'rechazar'; coincidenciaId: string }
  | { tipo: 'manual'; coincidencia: Coincidencia };

class SesionRevision {
  constructor(resultado: ResultadoConciliacion);
  confirmar(id: string): void; rechazar(id: string): void;   // rechazar libera sus movimientos
  emparejarManual(bancoIds: string[], ventasIds: string[], banco: Movimiento[], ventas: Movimiento[]): Coincidencia;
  deshacer(): boolean; rehacer(): boolean;                   // dos Pila<Evento>
  puedeDeshacer(): boolean; puedeRehacer(): boolean;
  estadoDe(id: string): 'automatica' | 'sugerida' | 'confirmada' | 'rechazada';
  coincidencias(): (Coincidencia & { estadoRevision: string })[];
  sinCruzar(): { banco: string[]; ventas: string[] };
  bitacora(): Evento[];                                       // lista solo de anexar; deshacer no borra, agrega
}
```

## 7. Punto de entrada (`packages/core/src/index.ts`, ya existe)

Reexporta modelo, estructuras, plantillas, ingesta, cruce y sesión.

## 8. Plantillas incluidas (`packages/plantillas/`)

- `formatos/*.json`: una plantilla por archivo.
- `muestras/`: archivos sintéticos (nunca datos reales).
- `index.ts`: `export const PLANTILLAS: Plantilla[]` (importa los JSON con
  `with { type: 'json' }`) y `export const MUESTRAS: { id: string; nombre: string; lado: 'banco' | 'ventas'; plantillaId: string; texto: string }[]`
  (importa los textos sin leer el disco, por ejemplo guardándolos en
  `muestras/index.ts` como cadenas), para que funcionen igual en Node y en el
  navegador.

## 9. API (`apps/api/`)

Node `node:http` + `pg`. Variables: `DATABASE_URL`, `PORT`, `CORS_ORIGEN`.

```
GET  /salud                                   { ok: true, baseDeDatos: boolean }
GET  /plantillas                              Plantilla[]
POST /conciliaciones                          body { banco: ArchivoEntrada, ventas: ArchivoEntrada, perfil?: Perfil }
                                              -> { id, resultado }  (guarda todo en UNA transacción)
GET  /conciliaciones                          lista resumida
GET  /conciliaciones/:id                      { id, creada, resultado, estados, bitacora }
POST /conciliaciones/:id/coincidencias/:cid/confirmar   transacción: estado + evento de bitácora
POST /conciliaciones/:id/coincidencias/:cid/rechazar    transacción: estado + evento + libera movimientos
```

## 10. Panel (`apps/web/`)

React 18 + Vite. Importa `@conciliador/core` y `@conciliador/plantillas`
directamente del código fuente (alias de Vite). Variable `VITE_API_URL`
opcional: si existe, aparece "Guardar en el servidor".
