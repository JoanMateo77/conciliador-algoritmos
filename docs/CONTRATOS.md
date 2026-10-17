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

---

# Fases 9 a 15: contratos de ampliación

Regla de compatibilidad: todo lo nuevo es **opcional y retrocompatible**. Un
perfil, una plantilla o una llamada del MVP debe seguir funcionando igual
(en el cruce, con `cruceOptimo: false`; ver la sección 11).
Las 115 pruebas existentes no se borran ni se debilitan.

## Dueños de carpetas (para trabajar en paralelo sin choques)

| Fase | Dueño de |
|---|---|
| 8 y 9. Formatos y anonimización | `packages/core/src/plantillas/**`, `packages/plantillas/**`, `packages/excel/**`, `scripts/anonimizar.ts` |
| 10 y 11. Reglas y cruce N:M | `packages/core/src/cruce/**`, `packages/core/src/sesion.ts` |
| 12 y 13. Multiempresa y escala | `apps/api/**`, `render.yaml` |
| 15. DIAN y Bre-B | `packages/dian/**` |
| 14. Librería pública | manifiestos `package.json`, configuración de compilación, `CHANGELOG.md`, `CONTRIBUTING.md` |
| Panel | `apps/web/**` |

El modelo (`modelo.ts`) ya trae `plantillaVersion?` y `documento?:
DocumentoFiscal`. Nadie más lo cambia sin agregarlo aquí.

## 9. Formatos

```ts
// Lectores registrables: una plantilla puede ser declarativa o apuntar a un lector propio.
type TipoPlantilla = 'delimitado' | 'anchoFijo' | 'mt940' | 'camt053';
interface LectorFormato {
  tipo: string;                                   // 'mt940', 'camt053', ...
  leer(texto: string, plantilla: Plantilla): { movimientos: Movimiento[]; errores: { linea: number; mensaje: string }[] };
  detectar?(texto: string): number;                // 0..1
}
registrarLector(lector: LectorFormato): void       // en plantillas/index.ts
// leerArchivo usa el lector según plantilla.tipo; 'delimitado' y 'anchoFijo' siguen igual.
// Todo movimiento leído lleva plantillaVersion = plantilla.version. Si el mapeo de una
// plantilla incluida cambia, sube su version (banco-csv-generico está en la 2).
// Plantilla gana `hoja?: string` (Excel) sin efecto en el núcleo.
```

Parser XML (`core/src/plantillas/xml.ts`, único en el proyecto; lo usan camt.053 y
`@conciliador/dian`, que lo reexporta con nombres cortos):

```ts
analizarXML(texto: string): ElementoXML   // lanza ErrorXML (ErrorDeDato) con linea y columna
// ElementoXML { nombre, prefijo, local, uri, atributos: AtributoXML[], hijos, texto, linea, columna }
// Namespaces por URI. Rechaza DOCTYPE, entidades desconocidas y '&' sin escapar.
hijoXML, hijosXML, rutaXML, descendientesXML (por URI + nombre local), atributoXML, textoXML
```

`@conciliador/excel`:

```ts
leerExcel(datos: ArrayBuffer | Uint8Array, opciones?: { hoja?: string }):
  { hojas: string[]; texto: string }   // texto = CSV con ';' de la hoja elegida, listo para leerArchivo
```

Así una plantilla delimitada sirve igual para el CSV y para el Excel del mismo
banco, y el núcleo sigue sin dependencias.

`scripts/anonimizar.ts <entrada> <salida> [--plantilla id]`: reemplaza
nombres, cédulas/NIT, correos, cuentas y referencias por valores sintéticos
estables (mismo valor original → mismo reemplazo), conserva el formato
exacto (longitudes en ancho fijo, separadores, columnas) y opcionalmente
desplaza montos y fechas. Sirve para que usuarios reales donen archivos (fase 8).

## 10. Reglas avanzadas (`cruce/reglas.ts`, `cruce/tarifas.ts`)

```ts
type Condicion =
  | { campo: 'referencia' | 'descripcion' | 'plantilla'; op: 'igual' | 'contiene' | 'empiezaPor' | 'regex'; valor: string }
  | { campo: 'monto'; op: 'entre'; min: number; max: number }          // centavos
  | { campo: 'fecha'; op: 'entre'; desde: string; hasta: string };
interface Regla {
  id: string; nombre: string; prioridad: number;      // menor = primero
  lado: 'banco' | 'ventas';
  si: { todas?: Condicion[]; alguna?: Condicion[] };  // AND / OR
  accion:
    | { tipo: 'clasificar'; categoria: string }        // ej. 'gasto:GMF', 'comision', 'ignorar'
    | { tipo: 'exigirReferencia' }                     // solo cruza con la misma referencia
    | { tipo: 'tolerancia'; faltanteCentavos?: number; faltantePorcentaje?: number };
}
interface Tarifa {
  nombre: string;                 // 'ReteFuente', 'ReteICA', 'ReteIVA', 'Comision', 'GMF'
  tasa: number;
  base: 'bruto' | 'comision' | 'iva';
  desde: string; hasta?: string;  // vigencia ISO
  medioPago?: string; municipio?: string;
}
// Perfil gana (opcionales): reglas?: Regla[]; tarifas?: Tarifa[]; municipio?: string
// Regex de usuario (op 'regex' y regex de plantillas): revisarRegex/regexSegura/crearProbador
// en core/src/regexSegura.ts. Máx. 200 caracteres, sin cuantificadores anidados ni (a|b)+,
// sin referencias hacia atrás, costo acotado (≈ dos '*'); se prueban sobre 256 caracteres
// con presupuesto de tiempo (ErrorRegexCostosa). validarReglas: ≤ 200 reglas, ≤ 20 condiciones.
// API: sin token (demo) una regla con op 'regex' responde 403.
// conciliar aplica primero reglas de clasificación (los clasificados salen del cruce y van a
// ResultadoConciliacion.clasificados), luego los pases. Las tarifas vigentes a la fecha del abono
// explican faltantes; 'retenciones' del MVP sigue funcionando.
```

## 11. Cruce N:M y explicabilidad

```ts
// Nuevo pase final opcional (Perfil.cruceOptimo?: boolean, por defecto true):
// por cada componente del GrafoBipartito con <= 60 nodos, asignación óptima con el
// algoritmo Húngaro (implementación propia en cruce/hungaro.ts, O(k³)) en lugar del greedy.
// Clusters N:M: componente donde suma banco ≈ suma ventas dentro de tolerancia → tipo 'agrupadaNM'.
// ResultadoConciliacion gana:
//   clasificados: { id: string; lado: 'banco' | 'ventas'; categoria: string; reglaId: string }[]
//   motivos: Record<string, string>   // id de movimiento sin cruzar -> por qué no cruzó, en español
// Coincidencia.tipo admite además 'agrupadaNM'.
// Pase 3 con cruceOptimo: si la referencia de un abono nombra una venta libre en su ventana,
// el grupo tiene que incluirla; si esa venta no está en la ventana, el abono no se agrupa
// (y su motivo lo dice).
// maxGrupo limita las ventas por grupo en el pase 3 y en el N:M. Con maxGrupo < 2 no corre
// ninguno de los dos: en 0.1.0 maxGrupo 1 significaba "no agrupar" y lo sigue significando
// (sin esto, el N:M armaría clusters de 2+ abonos contra 1 venta).
```

Cambio de comportamiento (declarado en `CHANGELOG.md`, 0.2.0 → "Cambiado"):
con `cruceOptimo` en su valor por defecto (`true`) un perfil del MVP puede
dar un resultado distinto (Húngaro, N:M y referencia requerida en el pase 3).
`cruceOptimo: false` reproduce exactamente el resultado del MVP; ese es el
alcance de la regla de compatibilidad para el cruce.

## 12. Multiempresa (API)

Autenticación propia con `node:crypto` (scrypt para contraseñas, JWT HS256
firmado con `JWT_SECRETO`), sin librerías nuevas. Roles: `admin`, `analista`,
`lector`. Toda tabla con datos de negocio lleva `empresa_id` y toda consulta
filtra por la empresa del token. Plantillas y perfiles por empresa con
historial de versiones (nunca se sobrescriben; cada cambio crea versión).
Auditoría: cada evento guarda `usuario_id`.

```
POST /auth/registro    { empresa, nombre, correo, contrasena } -> crea empresa + admin
POST /auth/ingreso     { correo, contrasena } -> { token, usuario }
GET  /empresa/usuarios | POST /empresa/usuarios (admin)
GET/POST /empresa/plantillas, GET /empresa/plantillas/:id/versiones
GET/POST /empresa/perfiles,   GET /empresa/perfiles/:id/versiones
```

Las rutas del MVP siguen funcionando: sin token operan en un espacio
público de demostración (empresa `demo`).

## 13. Escala (API)

- Tabla `trabajos` como cola persistente: `estado` (pendiente, procesando,
  hecho, fallido), intentos, error; se toma con `FOR UPDATE SKIP LOCKED`.
- `POST /conciliaciones?asincrono=1` encola y responde 202 con id de trabajo;
  `GET /trabajos/:id` da el estado.
- `src/worker.ts` (proceso aparte, `npm run worker -w apps/api`) toma
  trabajos, concilia y guarda en una transacción; reintentos con límite.
- Paginación (`?limite=&cursor=`) en listados; índices para los filtros.
- Registros estructurados JSON (una línea por evento) y `GET /metricas`.
- `scripts/carga.ts`: prueba de carga con 10⁶ movimientos sintéticos
  contra el núcleo y contra la cola.

## 14. Librería pública

- `npm run build:lib` compila `packages/core`, `packages/plantillas`,
  `packages/excel` y `packages/dian` a `dist/` (JS + `.d.ts`) con
  `rewriteRelativeImportExtensions`. Los `exports` publican `dist` con
  condición `types`, y el desarrollo local sigue usando `src`.
- `npm pack --dry-run` sin archivos de más; ejemplo de 10 líneas probado
  en un proyecto limpio que instala el `.tgz`.
- `CHANGELOG.md`, `CONTRIBUTING.md` (cómo aportar una plantilla), versión 0.2.0.

## 15. DIAN y Bre-B (`@conciliador/dian`)

```ts
leerFacturaUBL(xml: string): { movimiento: Movimiento | null; errores: string[] }
// Parser XML propio, sin dependencias: el de core (plantillas/xml.ts), compartido con camt.053. Extrae número, CUFE (cbc:UUID),
// NIT emisor/adquirente, fecha de emisión y vencimiento, subtotal, IVA, retenciones
// (WithholdingTaxTotal) y total a pagar (PayableAmount). Movimiento lado 'ventas',
// montoCentavos = total a pagar, referencia = número de factura, documento = DocumentoFiscal.
leerFacturas(xmls: string[]): { movimientos: Movimiento[]; errores: { indice: number; mensaje: string }[] }
```

Bre-B: si un movimiento trae `referenciaPago` y una venta tiene la misma
`referenciaPago` o `referencia`, el pase exacto la usa como llave principal
(dueño: cruce). La plantilla `banco-csv-generico` puede mapear la columna
`REFERENCIA PAGO` a `referenciaPago` (dueño: formatos).
