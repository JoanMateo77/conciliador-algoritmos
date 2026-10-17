# Documento final: Conciliador

Proyecto de Algoritmos II (UAO), 2026. Autor: Joan Mateo Cardona Lorza.

Este documento describe lo que hay **construido** en el repositorio. Lo que
falta está en la sección 9, junto con las fases que siguen según
[PLAN.md](PLAN.md).

## 1. Alcance

El conciliador cruza dos listas: lo que entró al banco (abonos) y lo que la
empresa vendió (ventas de una pasarela o del ERP). Por cada abono dice con qué
venta o ventas corresponde, qué tan seguro está y por qué hay diferencia.

Lo que hace el MVP:

| Pieza | Qué hay |
|---|---|
| Formatos | Archivos delimitados (CSV con comillas, `;`, `\t`, `\|`) y de ancho fijo. Todo se describe con una plantilla JSON |
| Plantillas incluidas | Extracto bancario CSV genérico, recaudo Asobancaria 2001 (ancho fijo, latin1), transacciones Wompi, liquidación Mercado Pago y ventas CSV genéricas de un ERP |
| Detección | Elige la plantilla de un archivo por sus encabezados o por el prefijo de la primera línea |
| Cruce | Exacto, 1:1 con tolerancia y agrupado N:1 (suma de subconjuntos) |
| Perfiles | Tolerancia asimétrica (en centavos o en %), ventana de días antes y después, tamaño máximo de grupo, umbrales y retenciones conocidas |
| Revisión | Confirmar, rechazar (los movimientos quedan libres), emparejar a mano, deshacer y rehacer, bitácora que solo crece |
| Panel | React + Vite. Carga con detección, demos, perfil, resultados, grafo de conflictos, asistente de plantillas. Todo se procesa en el navegador |
| API | `node:http` + PostgreSQL. Guarda la conciliación y cada decisión en una transacción |
| Pruebas | 108 pruebas con `node:test` (más 7 de la API que solo corren con PostgreSQL). CI en GitHub Actions |

Fuera del alcance de esta entrega: Excel, MT940/camt.053, cruce N:M general,
usuarios y autenticación, y facturación electrónica DIAN.

## 2. Tecnologías y por qué

| Tecnología | Por qué |
|---|---|
| **TypeScript sin compilar** (Node 24, *type stripping*) | Los tipos documentan el contrato entre módulos, y Node ejecuta los `.ts` directamente: no hay paso de build ni `dist/` que se desincronice. Por eso el código usa solo sintaxis borrable (nada de `enum` ni `namespace`) |
| **npm workspaces** (monorepo) | El núcleo, las plantillas, la API y el panel comparten el mismo código fuente. El panel importa `@conciliador/core` por alias de Vite y la API por el enlace del workspace |
| **Núcleo sin dependencias** | Las estructuras de datos son propias (lo pide la materia) y el motor se puede auditar completo. Funciona igual en Node y en el navegador |
| **`node:test`** | Viene con Node: cero dependencias para probar |
| **React 18 + Vite** | El panel procesa los archivos en el navegador, así los datos de la empresa no salen del equipo. Vite compila rápido y entiende TypeScript |
| **`node:http` + `pg`** | La API tiene 7 rutas: un framework no aporta lo suficiente para justificar otra dependencia. `pg` es el cliente de PostgreSQL más usado en Node |
| **PostgreSQL** (Neon) | Las decisiones de conciliación necesitan transacciones ACID y bloqueo de filas (`FOR UPDATE`). `jsonb` guarda el resultado del motor tal cual |
| **Vercel + Neon** | Un solo proyecto con plan gratuito: el panel va a la CDN, la API a una función que atiende `/api/*` y la base es PostgreSQL de Neon creada desde Vercel. Mismo dominio, sin CORS ([DESPLIEGUE_VERCEL.md](DESPLIEGUE_VERCEL.md)). Netlify + Render quedan como alternativa ([DESPLIEGUE.md](DESPLIEGUE.md)) |

## 3. Arquitectura

```
                        packages/plantillas (JSON + muestras sintéticas)
                                     │
                                     ▼
 archivos ──► packages/core ─────────────────────────────────────────────────┐
             plantillas/  validar · csv (parser propio) · leer · registro    │
             ingesta.ts   procesarArchivos (Cola)                            │
             modelo.ts    Movimiento estándar (centavos enteros)             │
             cruce/       perfil · puntaje · pases · conciliar               │
             sesion.ts    SesionRevision (Pila ×2 + bitácora)                │
             estructuras/ Cola · Pila · ArbolAVL · Trie · MinHeap · Grafo    │
             └──────────────────────────────────────────────────────────────┘
                     ▲                                   ▲
                     │ alias de Vite                     │ workspace
             apps/web (React, Vercel)   ──HTTP /api────────► apps/api (node:http + pg, función de Vercel)
                                                                │
                                                                ▼
                                                    PostgreSQL (Neon)
```

Reglas que sigue el código:

1. **El núcleo no conoce bancos.** Recibe `Movimiento` y nada más. Un banco
   nuevo es un JSON nuevo.
2. **Dinero en centavos enteros.** `aCentavos` convierte el texto
   (`"1.234.567,89"`) a entero sin pasar por flotantes, y el cruce rechaza
   montos que no sean `Number.isSafeInteger`.
3. **Resultados reproducibles.** El cruce no usa reloj ni azar. Todos los
   desempates terminan en el orden del archivo, y los ids de coincidencia
   (`c1`, `c2`…) son estables. Gracias a eso la API puede repetir el cruce y
   aplicar las mismas decisiones que se tomaron en el panel.
4. **Nada se borra.** Deshacer agrega un evento a la bitácora. En la base, la
   tabla `eventos` solo recibe `INSERT`.
5. **Un error no frena el lote.** Una línea mala queda en `errores` con su
   número, y un archivo sin plantilla no detiene a los demás.

## 4. Estructuras de datos

Todas viven en `packages/core/src/estructuras/` y están probadas en
`packages/core/test/estructuras.test.ts` (26 pruebas, entre ellas comparaciones contra
fuerza bruta con datos pseudoaleatorios y la verificación del balance del AVL).

### 4.1 Cola (`Cola.ts`)

- **Problema que resuelve.** `procesarArchivos` (`ingesta.ts`) recibe varios
  archivos y los atiende en orden de llegada. Si uno falla, se registra el
  error y se sigue con el siguiente. También es la frontera del BFS en
  `GrafoBipartito.componentes()`.
- **Por qué esta y no otra.** El orden importa (FIFO) y no hay prioridades. Un
  arreglo con `shift()` cuesta O(n) por operación; la cola guarda un índice de
  inicio y compacta solo cuando la parte muerta pasa de la mitad.
- **Complejidad.** `encolar` O(1) amortizado, `desencolar` O(1) amortizado,
  `frente`/`tamano`/`estaVacia` O(1), `aArreglo` O(n).

### 4.2 Pila (`Pila.ts`)

- **Problema que resuelve.** Deshacer y rehacer en la revisión
  (`sesion.ts`): una pila guarda lo que se puede deshacer y otra lo que se
  puede rehacer. Cada registro lleva el estado anterior para poder revertirlo.
  Una acción nueva vacía la pila de rehacer, como en cualquier editor.
- **Por qué esta y no otra.** Siempre se deshace la última acción (LIFO). Esa
  disciplina además garantiza algo que la sesión necesita: al deshacer un
  rechazo, nada pudo haber tomado los movimientos liberados, porque cualquier
  acción posterior ya se deshizo antes.
- **Complejidad.** `apilar`, `desapilar`, `cima`, `vaciar`: O(1). `aArreglo` O(n).

### 4.3 Árbol AVL (`ArbolAVL.ts`)

- **Problema que resuelve.** Pase 2: hay que encontrar las ventas cuyo monto
  cabe en la tolerancia de un abono. Por ejemplo, para un abono de $96.850 con
  5 % de faltante permitido, sirven las ventas entre $96.850 y $101.947. Las
  ventas libres se indexan por monto en centavos y `buscarRango(min, max)`
  devuelve las candidatas en orden.
- **Por qué esta y no otra.** Un `Map` solo encuentra montos exactos (eso ya lo
  hace el pase 1). Un arreglo ordenado con búsqueda binaria también sirve para
  rangos, pero insertar o eliminar en él cuesta O(n). El AVL mantiene la altura
  en O(log n) aunque las ventas lleguen ordenadas (lo normal en un extracto),
  que es justo el caso en que un ABB sin balancear degenera en lista. Admite
  claves repetidas guardando una lista de valores por nodo, porque muchas
  ventas tienen el mismo monto.
- **Complejidad.** `insertar` y `eliminar` O(log n). `buscarRango` O(log n + k)
  (poda las ramas fuera del rango). `altura` O(1), `enOrden` O(n). Memoria O(n).

### 4.4 Trie (`Trie.ts`)

- **Problema que resuelve.** Dos usos:
  1. **Detección de plantilla** (`plantillas/registro.ts`). Un trie mapea cada
     encabezado normalizado a las plantillas que lo esperan, y otro mapea
     prefijos de línea (por ejemplo `"01"` de Asobancaria) usando
     `prefijosDe`.
  2. **Referencias truncadas** (pase 2). El banco suele cortar la referencia
     (`PED2026109` en vez de `PED2026109377`) o agregarle texto al final.
     `buscarPrefijo` encuentra las ventas cuya referencia empieza por la del
     banco, y `prefijosDe` las que son prefijo de la del banco.
- **Por qué esta y no otra.** Con un `Map` habría que probar cada prefijo
  posible o recorrer todas las claves. El trie responde en tiempo
  proporcional al largo del texto, sin importar cuántas plantillas o
  referencias haya.
- **Complejidad.** `insertar`, `buscar` y `contiene` O(L) con L el largo de la
  clave. `prefijosDe(texto)` O(|texto| + r). `buscarPrefijo(p)` O(|p| + tamaño
  del subárbol). Memoria O(suma de los largos).

### 4.5 MinHeap y TopK (`MinHeap.ts`)

- **Problema que resuelve.** Un abono puede tener cientos de ventas en rango.
  Solo los **5 mejores** candidatos (`CANDIDATOS_POR_ABONO`) pasan al grafo,
  y así el grafo queda pequeño. `TopK` mantiene un montículo mínimo de tamaño
  k: la raíz es el peor de los guardados, y es el único que puede salir
  cuando llega uno mejor.
- **Por qué esta y no otra.** Ordenar todos los candidatos cuesta O(c log c) y
  guarda todo. El heap de tamaño k cuesta O(c log k) con memoria O(k). Con
  igual puntaje gana el que llegó primero, para que el resultado sea
  reproducible.
- **Complejidad.** `insertar` y `extraer` O(log n), `ver` O(1). `TopK.agregar`
  O(log k), `resultado` O(k log k).

### 4.6 Grafo bipartito (`GrafoBipartito.ts`)

- **Problema que resuelve.** Dos abonos pueden querer la misma venta. Cada
  candidato del pase 2 es una arista abono↔venta con peso igual al puntaje.
  Las **componentes conexas** (BFS con la `Cola`) separan los conflictos
  independientes, y cada uno se resuelve por su lado. El panel dibuja este
  grafo en la pestaña *Grafo*.
- **Por qué esta y no otra.** El problema real es un emparejamiento en un
  grafo bipartito. Con lista de adyacencia (un `Map` por nodo), agregar una
  arista cuesta O(1) y recorrer cuesta O(V + E). Una matriz de adyacencia
  costaría O(n·m) de memoria con 100.000 movimientos.
- **Complejidad.** `agregarNodo` y `agregarArista` O(1). `vecinos(id)`
  O(grado). `quitarNodo` O(grado). `componentes`, `nodos` y `aristas` O(V + E).

### 4.7 Estructuras del lenguaje que también se usan

`Map` y `Set` (tablas hash) en el pase 1 (índice `monto|referencia`), en el
estado ocupado/libre de la sesión y en el registro de plantillas. Son parte del
lenguaje y no cuentan como estructuras propias.

## 5. Algoritmo de cruce por pases

Archivo principal: `packages/core/src/cruce/pases.ts`, orquestado por
`conciliar.ts`. Notación: **n** abonos del banco, **m** ventas.

Antes de los pases se valida el perfil, se verifica que no haya ids repetidos
ni montos no enteros, y cada fecha se convierte una sola vez a número de día
(restar enteros es más barato que comparar fechas). Cada pase marca como
ocupado lo que empareja, así **ningún movimiento queda en dos coincidencias**.

### Pase 1: exacta (O(n + m) esperado)

1. Se crea un `Map` de `monto|referencia` a una lista de ventas. Por cada
   abono se toma la siguiente venta libre con esa clave. Puntaje 1.
2. Con lo que quedó libre se repite lo mismo con `monto|fecha`. Puntaje 0,95,
   porque mismo monto el mismo día con otra referencia es algo menos seguro.

### Pase 2: tolerancia 1:1

1. Las ventas libres se meten en un **AVL** por monto (O(m log m)) y en un
   **Trie** por referencia.
2. Por cada abono libre:
   - `rangoVentas` calcula el rango de montos posible según el perfil. La
     tolerancia es asimétrica: el banco puede traer hasta un X % **menos**
     (comisiones), pero casi nunca más.
   - `buscarRango` del AVL da las candidatas; se descartan las que caen fuera
     de la ventana de días.
   - Puntaje = 0,5·monto + 0,2·fecha + 0,3·referencia. Cada componente vale de
     0,5 a 1. La referencia se compara con Levenshtein normalizado, o vale 0,9
     si el Trie la encontró por prefijo.
   - Lo que queda bajo `umbralSugerencia` se descarta. **TopK** guarda los 5
     mejores.
3. Los candidatos son aristas del **grafo bipartito**. Por cada componente
   conexa, las aristas se ordenan de mayor a menor puntaje y se asignan sin
   repetir nodos (*greedy* por componente). Desempates: menor diferencia y
   luego orden del archivo. Esto no garantiza el emparejamiento óptimo (eso es
   la fase 11 con el método húngaro). Sí evita el error del greedy ingenuo,
   que va abono por abono y deja sin pareja al que tenía una sola opción.

Complejidad: O(m log m + n·(log m + k·L²) + E log E), donde k es el número de
ventas en el rango de monto de cada abono, L el largo de las referencias
(Levenshtein O(L²), con L ≤ ~20) y E ≤ 5n las aristas.

### Pase 3: agrupada N:1 (suma de subconjuntos acotada)

1. Las ventas libres se ordenan por día. Para cada abono, con búsqueda binaria
   se toman las ventas de su ventana (O(log m + w)).
2. Si hay más de **40 candidatas** (`MAX_CANDIDATOS_GRUPO`), el abono se omite
   y se informa en `pases` como «agrupada omitida: revisión manual», porque
   2⁴⁰ subconjuntos no se pueden explorar.
3. Si no, se hace **backtracking** con las ventas ordenadas de mayor a menor
   monto, con máximo `maxGrupo` ventas por grupo, y dos podas:
   - si la suma pasa el máximo, se salta esa venta (las siguientes son menores
     y alguna puede caber);
   - si ni sumando las mayores restantes se alcanza el mínimo, se corta la
     rama entera (con sumas prefijas en O(1)).
4. Hay además un presupuesto de 50.000 nodos por abono
   (`PRESUPUESTO_BUSQUEDA`) que acota el peor caso sin depender del reloj.
   Puntaje del grupo = 0,9·(0,6·monto + 0,4·fecha): un grupo nunca pasa de
   0,9, porque una suma puede cuadrar por casualidad.

Complejidad: O(m log m + n·(log m + w + B)), con B ≤ 50.000 nodos. Es
exponencial solo dentro de una ventana acotada, como pide el plan.

### Explicación de diferencias (`puntaje.ts`)

Por cada coincidencia con faltante se busca, en orden:

1. el desglose de la venta (comisión, IVA, retenciones);
2. la **comisión típica del lote** (la mediana del % faltante) más cada
   combinación de retenciones del perfil (2^r con r ≤ 10);
3. solo retenciones.

Se acepta un margen de ±1 %. Ejemplo real de la demo: «Faltan $24.198,20
(4,65 % de $520.000) ≈ comisión 3,15 % + ReteFuente 1,5 % ($7.800)».

### Total

Tiempo O((n + m) log m + n·k), con el pase 3 acotado por constantes. Memoria
O(n + m). La sección 7 muestra que **k** es lo que domina en la práctica.

## 6. Base de datos y transacciones

Esquema en `apps/api/src/esquema.sql`. Se aplica al arrancar, es idempotente y
usa un *advisory lock* para que dos instancias que arrancan a la vez no
choquen.

```
conciliaciones (id uuid PK, creada, archivo_banco, archivo_ventas,
                plantilla_banco, plantilla_ventas, perfil jsonb, resumen jsonb, detalle jsonb)
      │ 1
      │ N
coincidencias  (PK conciliacion_id + id, orden, tipo, banco_ids text[], ventas_ids text[],
                puntaje, diferencia_centavos bigint, explicacion,
                estado_inicial, estado)                 ◄── decisión vigente
      │ 1                                   │ 1
      │ N                                   │ N
movimientos    (PK conciliacion_id+lado+id,  eventos (id bigserial, coincidencia_id, tipo,
                fecha, monto_centavos bigint,          estado_anterior, estado_nuevo, creado)
                referencia, desglose jsonb, ...,       ◄── bitácora: solo INSERT
                coincidencia_id NULL = libre)
```

Decisiones de diseño:

- Los montos son `bigint` en centavos. Nunca se usa `numeric` ni `float` para
  dinero.
- `CHECK` en tipos y estados: la base rechaza un estado inventado aunque la
  API tenga un error.
- `estado_inicial` (lo que dijo el motor) se guarda aparte de `estado` (la
  decisión humana vigente), para poder auditar las correcciones.
- `detalle jsonb` guarda el grafo, los pases y los sin cruzar originales, que
  no necesitan tabla propia.
- Los inserts masivos usan `jsonb_to_recordset`: un `INSERT` por tabla con
  miles de filas en un solo viaje a la base, en vez de uno por fila.

### Transacciones (`apps/api/src/bd.ts`, `repositorio.ts`)

`enTransaccion` hace `BEGIN`, ejecuta el trabajo con **el mismo cliente** y
termina en `COMMIT`. Ante cualquier error hace `ROLLBACK` y relanza el error.
Si ni siquiera el `ROLLBACK` funciona, la conexión se descarta del pool en vez
de devolverla rota.

- **`POST /conciliaciones`**: inserta la conciliación, todas las coincidencias
  y todos los movimientos (ya enlazados a su coincidencia) en **una**
  transacción.
- **Confirmar o rechazar**: en una transacción se hace
  `SELECT ... FOR UPDATE` de la coincidencia (dos revisores a la vez quedan en
  fila), se valida la transición, se actualiza el estado y se inserta el
  evento. Al rechazar, además se ejecuta `UPDATE movimientos SET
  coincidencia_id = NULL` para liberar los movimientos.

**Qué pasa si falla.** Si la base se cae a mitad de guardar, o si uno de los
mil movimientos viola una restricción, el `ROLLBACK` deshace todo. No queda una
conciliación a medias: sin coincidencias, con movimientos huérfanos, o con un
rechazo que cambió el estado pero no liberó los movimientos ni dejó evento. El
cliente recibe un 500 con «Error interno del servidor» (el detalle SQL queda
solo en el log) y puede reintentar. Una transición inválida, como confirmar
algo rechazado, responde **409** y tampoco deja rastro. Las pruebas «un fallo a mitad del guardado no deja filas a medias», «si falla
algo dentro de una decisión, el estado no cambia» y «confirmaciones
simultáneas: solo una gana» (`apps/api/test/api.test.ts`) lo comprueban contra
PostgreSQL real.

## 7. Mediciones

Script: [`scripts/medir.ts`](../scripts/medir.ts). Genera ventas y abonos
**sintéticos y deterministas** con un generador pseudoaleatorio con semilla
fija (mulberry32). La mezcla es: 45 % pares exactos, 30 % con comisión de
2,5–4,5 % y referencia truncada, 15 % de ventas abonadas en grupos de 2 a 4,
5 % de ventas sin abono y 5 % de abonos sin venta. Luego mide `conciliar` con
`PERFIL_POR_DEFECTO`, tras una corrida de calentamiento, y reporta la mediana
de 5 corridas (3 para 100.000).

```bash
node scripts/medir.ts                    # 60 ventas por día (comercio mediano)
node scripts/medir.ts --por-dia=10       # comercio pequeño
```

Equipo: Apple M5, 16 GB, macOS, Node v24.15.0.

**60 ventas por día:**

| Ventas | Abonos | Mediana | Mínimo | Automáticas | Sugeridas | Banco conciliado | Pases | Aristas del grafo |
|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 10.000 | 7.587 | 85 ms | 72 ms | 3.677 | 2.612 | 82,9 % | exacta 3.645 · tolerancia 2.631 · agrupada 13 · omitida 1.295 | 10.643 |
| 100.000 | 76.065 | 2.257 ms | 2.226 ms | 36.324 | 26.371 | 82,4 % | exacta 36.256 · tolerancia 26.335 · agrupada 104 · omitida 13.334 | 105.818 |

**10 ventas por día:**

| Ventas | Abonos | Mediana | Mínimo | Automáticas | Sugeridas | Banco conciliado | Pases | Aristas del grafo |
|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 10.000 | 7.587 | 129 ms | 116 ms | 3.653 | 3.411 | 93,1 % | exacta 3.645 · tolerancia 2.378 · agrupada 1.041 | 4.094 |
| 100.000 | 76.065 | 2.605 ms | 2.589 ms | 36.273 | 34.578 | 93,1 % | exacta 36.256 · tolerancia 24.282 · agrupada 10.313 | 40.046 |

Lo que muestran los números:

- **100.000 ventas se concilian en unos 2 a 3 segundos** en un portátil. Es
  suficiente para el uso real (un comercio mediano tiene entre 1.000 y 20.000
  ventas al mes), pero el crecimiento **no es O(n log n)**: 10 veces más datos
  tardan entre 20 y 27 veces más.
- **La causa está medida, no supuesta.** Un perfil de CPU
  (`node --cpu-prof`) con 100.000 ventas muestra que la mayor parte del tiempo
  se va en `ArbolAVL.buscarRango` y en el bucle del pase 2 que descarta
  candidatas por fecha. El AVL indexa **solo por monto**: un rango del 5 %
  sobre montos repartidos en todo el año devuelve k ventas que crecen con m, y
  la mayoría se descarta luego por estar fuera de la ventana de días. El
  costo real del pase 2 es O(n·k) con k proporcional a m.
  Corrección propuesta (fase 13): particionar por fecha (un AVL por día, o
  una clave compuesta día+monto) para que k dependa de la densidad diaria y no
  del total.
- **El pase agrupado depende de la densidad.** Con 60 ventas por día, una
  ventana de 6 días tiene unas 360 candidatas, más que el tope de 40. Así que
  casi todos los abonos agrupados se omiten y quedan para revisión manual (se
  informan en `pases`; nunca se pierden). Con 10 ventas por día el pase
  encuentra el 93 % de los grupos. Para comercios grandes hace falta acotar
  las candidatas también por referencia de lote o usar una ventana más corta
  en el perfil.
- El pase 1 resuelve casi la mitad de los abonos con un `Map`, en tiempo
  lineal. Por eso conviene ir de barato a caro.

## 8. Pruebas

```bash
npm test                                             # 108 pruebas (las de PostgreSQL se saltan)
DATABASE_URL_PRUEBA=postgres://... npm test          # incluye las de la API con base real
```

| Archivo | Qué cubre |
|---|---|
| `packages/core/test/estructuras.test.ts` | Las 6 estructuras: vacía, un elemento, muchos elementos y comparación contra fuerza bruta |
| `packages/core/test/plantillas.test.ts` | Validador, parser CSV (comillas, saltos dentro de comillas, BOM, CRLF), ancho fijo, detección |
| `packages/core/test/cruce.test.ts` | Perfiles, cada pase, tolerancia asimétrica, ventana de días, prefijo con Trie, conflicto donde el greedy ingenuo falla, tope de 40 candidatos, explicaciones, determinismo, invariantes con 1.000 movimientos |
| `packages/core/test/escenario.test.ts` | Prueba de aceptación: las muestras de `ESCENARIO.md` dan exactamente lo esperado |
| `packages/core/test/sesion.test.ts` | Confirmar, rechazar, manual, deshacer y rehacer, bitácora |
| `packages/plantillas/muestras.test.ts` | Las muestras son coherentes (saldos, totales de control Asobancaria, encabezados) |
| `apps/api/test/api.test.ts` | Rutas, validación, CORS, límites, y con PostgreSQL: guardado, transacciones, `FOR UPDATE`, rollback |

El CI (`.github/workflows/ci.yml`) corre todo con un servicio PostgreSQL 16 y
además compila el panel.

## 9. Limitaciones y próximas fases

Limitaciones conocidas de esta versión:

- **Pase 2 en O(n·k)** con k proporcional a m (ver sección 7).
- **Pase agrupado** inútil con más de 40 ventas en la ventana. Esos abonos
  quedan para revisión manual.
- La asignación por componente es **greedy**, no óptima.
- La API **no recibe emparejamientos manuales** ni plantillas propias: solo
  conoce las plantillas incluidas, y el panel desactiva «Guardar en el
  servidor» cuando se usa una plantilla creada en el navegador.
- **Asobancaria 2001**: el lector va línea por línea y espera la fecha repetida
  en la zona reservada del detalle (ver la descripción de la plantilla).
- Sin autenticación ni multiempresa. Las plantillas y perfiles propios viven en
  el `localStorage` del navegador.
- Solo formatos de texto. No lee Excel, MT940 ni camt.053.
- Las plantillas se construyeron con documentación pública y datos
  sintéticos; falta validarlas con archivos reales anonimizados.

Próximas fases (de [PLAN.md](PLAN.md)), una rama por fase mezclada con
`--no-ff`:

| Semana | Fase | Contenido |
|---|---|---|
| 1 | 8. Validación con usuarios | Entrevistas; 3 a 5 archivos reales anonimizados convertidos en plantillas y vectores de prueba |
| 2 | 9. Más formatos | Excel (SheetJS en un adaptador), MT940 y camt.053 como lectores registrados |
| 3 | 10. Reglas avanzadas | Reglas AND/OR ordenadas, tarifas de retención con vigencia y municipio, GMF 4×1000 |
| 4 | 11. Cruce N:M | Asignación óptima (método húngaro) por componente; reporte «por qué no cruzó» |
| 5 | 12. Multiempresa | JWT, empresas, roles, versiones de plantillas y perfiles por empresa |
| 6 | 13. Escala | Cola persistente en PostgreSQL, worker aparte, índice del pase 2 por fecha+monto (sección 7), pruebas con 10⁶ movimientos |
| 7 | 14. Librería pública | Compilar a JS + tipos, publicar `0.x` en npm, guía para aportar plantillas |
| 8 | 15. Colombia | Referencia de Pago de Bre-B, cruce pago ↔ factura electrónica DIAN (CUFE), exportes contables |
