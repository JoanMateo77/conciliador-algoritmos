# Documento final: Conciliador

Proyecto de Algoritmos II (UAO), 2026. Autor: Joan Mateo Cardona Lorza.

Este documento describe lo que hay **construido** en el repositorio: el MVP
(fases 0 a 7, versión 0.1.0) y las fases de escalado 8 a 15 (versión 0.2.0).
Lo que falta está en la sección 10, y el estado de cada fase en
[PLAN.md](PLAN.md).

## 1. Alcance

El conciliador cruza dos listas: lo que entró al banco (abonos) y lo que la
empresa vendió (ventas de una pasarela o del ERP). Por cada abono dice con qué
venta o ventas corresponde, qué tan seguro está y por qué hay diferencia.

| Pieza | MVP (0.1.0) | Escalado (0.2.0) |
|---|---|---|
| Formatos | Delimitados (CSV con comillas, `;`, `\t`, `\|`) y ancho fijo, descritos con una plantilla JSON | Excel (`@conciliador/excel`), MT940 y camt.053 como lectores registrables, facturas electrónicas DIAN UBL 2.1 (`@conciliador/dian`). Cada movimiento guarda `plantillaVersion` |
| Plantillas incluidas | Extracto bancario CSV, Asobancaria 2001 (ancho fijo, latin1), Wompi, Mercado Pago, ventas de un ERP | MT940 genérico, camt.053 genérico; columna opcional `REFERENCIA PAGO` (Bre-B) en el extracto CSV (versión 2) |
| Detección | Por encabezados o prefijo de la primera línea (Trie) | Los lectores registrados aportan su propia detección (MT940 y camt.053 por contenido) |
| Cruce | Exacto, 1:1 con tolerancia (greedy por componente) y agrupado N:1 | Referencia de Pago de Bre-B como llave del exacto; asignación **óptima (Húngaro)** por componente; clusters **N:M**; motivo de cada movimiento sin cruzar |
| Perfiles | Tolerancia asimétrica, ventana de días, tamaño máximo de grupo, umbrales, retenciones | Reglas AND/OR ordenadas, tarifas con vigencia, medio de pago y municipio, `cruceOptimo` |
| Revisión | Confirmar, rechazar, emparejar a mano, deshacer y rehacer, bitácora | Igual, con `agrupadaNM` y movimientos clasificados por reglas |
| Panel | React + Vite; todo en el navegador | Excel, MT940, camt.053 y XML DIAN; editores de reglas y tarifas; pestaña *Servidor* (ingreso, versiones, cola) |
| API | `node:http` + PostgreSQL, cada decisión en una transacción | Multiempresa con JWT y roles, plantillas y perfiles versionados, migraciones, cola de trabajos con worker aparte, paginación, métricas |
| Librería | Solo dentro del monorepo | Cuatro paquetes compilables a JS + `.d.ts` (`npm run build:lib`), listos para npm |
| Pruebas | 115 (108 + 7 con PostgreSQL) | **274** con `node:test` (246 sin base de datos; 28 más de la API con PostgreSQL). CI con tipos, pruebas, `build:lib` y panel |

Pendiente (sección 10): entrevistas y archivos reales de la fase 8, el
`npm publish` de la fase 14 y los exportes contables de la fase 15.

## 2. Tecnologías y por qué

| Tecnología | Por qué |
|---|---|
| **TypeScript sin compilar** (Node 24, *type stripping*) | Los tipos documentan el contrato entre módulos, y Node ejecuta los `.ts` directamente: no hay paso de build ni `dist/` que se desincronice. Por eso el código usa solo sintaxis borrable (nada de `enum` ni `namespace`) |
| **npm workspaces** (monorepo) | El núcleo, las plantillas, la API y el panel comparten el mismo código fuente. El panel importa `@conciliador/core` por alias de Vite y la API por el enlace del workspace |
| **Núcleo sin dependencias** | Las estructuras de datos son propias (lo pide la materia) y el motor se puede auditar completo. Funciona igual en Node y en el navegador |
| **`node:test`** | Viene con Node: cero dependencias para probar |
| **React 18 + Vite** | El panel procesa los archivos en el navegador, así los datos de la empresa no salen del equipo. Vite compila rápido y entiende TypeScript |
| **`node:http` + `pg`** | La API tiene una tabla de rutas propia (18 rutas): un framework no aporta lo suficiente para justificar otra dependencia. `pg` es el cliente de PostgreSQL más usado en Node |
| **PostgreSQL** (Neon) | Las decisiones de conciliación necesitan transacciones ACID y bloqueo de filas (`FOR UPDATE`). `jsonb` guarda el resultado del motor tal cual. Además sirve de **cola** (`FOR UPDATE SKIP LOCKED`), así no hace falta Redis ni otro servicio |
| **`node:crypto`** | scrypt para contraseñas y HMAC-SHA256 para los JWT, sin librerías de autenticación |
| **SheetJS (`xlsx`)** | Solo en `@conciliador/excel`: leer `.xlsx`/`.xls` bien es mucho trabajo y el núcleo debe seguir sin dependencias. Se instala desde el CDN oficial de SheetJS (la versión de npm está desactualizada) |
| **`tsc` para la librería** | `npm run build:lib` genera JS + `.d.ts` con `rewriteRelativeImportExtensions`. En el monorepo se sigue usando el `.ts` (condición `conciliador-src` en `.npmrc`) |
| **Vercel + Neon** | Un solo proyecto con plan gratuito: el panel va a la CDN, la API a una función que atiende `/api/*` y la base es PostgreSQL de Neon creada desde Vercel. Mismo dominio, sin CORS. Como Vercel no admite procesos permanentes, la cola avanza con cada consulta de estado de un trabajo ([DESPLIEGUE_VERCEL.md](DESPLIEGUE_VERCEL.md)). Render (API + worker) y Netlify quedan como alternativa ([DESPLIEGUE.md](DESPLIEGUE.md)) |

## 3. Arquitectura

```
                        packages/plantillas (JSON + muestras sintéticas)
                                     │
                                     ▼
 archivos ──► packages/core ─────────────────────────────────────────────────┐
             plantillas/  validar · csv · leer · registro · lectores         │
                          mt940 · camt053 · xml (parser propio)              │
             ingesta.ts   procesarArchivos (Cola)                            │
             modelo.ts    Movimiento estándar (centavos enteros)             │
             cruce/       perfil · reglas · tarifas · puntaje · pases        │
                          hungaro · motivos · conciliar                      │
             sesion.ts    SesionRevision (Pila ×2 + bitácora)                │
             estructuras/ Cola · Pila · ArbolAVL · Trie · MinHeap · Grafo    │
             └──────────────────────────────────────────────────────────────┘
   adaptadores: packages/excel (SheetJS) · packages/dian (UBL 2.1, usa el xml del núcleo)
                     ▲                                   ▲
                     │ alias de Vite                     │ workspace
             apps/web (React, Vercel)   ──HTTP /api────────► apps/api (node:http + pg, función de Vercel)
                                                          │  auth · empresas · rutas
                                                          │  POST ?asincrono=1 → INSERT trabajos
                                                          ▼
                                              PostgreSQL (Neon) ◄── apps/api/src/worker.ts
                                              migraciones · empresas    (proceso aparte,
                                              datos por empresa_id       FOR UPDATE SKIP LOCKED)
                                              trabajos (cola)
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
6. **Todo lo nuevo es opcional.** Un perfil, una plantilla o una llamada de
   0.1.0 sigue siendo válida. Con `cruceOptimo: false` el cruce da
   exactamente el resultado de 0.1.0, y con el perfil de la demo el resultado
   es el mismo de 0.1.0 aun con el cruce óptimo (`reglas.test.ts` lo compara
   con un resultado guardado del MVP, `test/fixtures/demo-mvp.json`).
7. **Un formato es un dato con versión.** Si el mapeo de una plantilla
   cambia, sube `version`, y cada movimiento guarda con qué versión se leyó
   (`banco-csv-generico` pasó a la 2 al agregar `REFERENCIA PAGO`).

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

### 4.7 Parser XML propio (`plantillas/xml.ts`)

- **Problema que resuelve.** camt.053 y las facturas DIAN son XML con
  namespaces (`cbc:`, `cac:`, o un namespace por defecto que cada emisor
  escribe distinto). El núcleo no puede depender de una librería.
- **Cómo funciona.** Un solo recorrido del texto con una **Pila** de elementos
  abiertos; cada elemento hereda el mapa de namespaces de su padre y resuelve
  su prefijo a URI. La navegación compara por URI + nombre local (DIAN) o solo
  por nombre local (camt.053, que cambia de URI entre versiones). Las líneas y
  columnas de los errores salen de una búsqueda binaria sobre los inicios de
  línea.
- **Una sola política de seguridad.** Rechaza `DOCTYPE` (evita la expansión de
  entidades, «billion laughs», y las entidades externas), entidades
  desconocidas y `&` sin escapar. Antes había dos parsers casi iguales (uno en
  el núcleo y otro en `dian`) con políticas distintas ante DOCTYPE; se
  unificaron en el del núcleo y `dian` lo reexporta.
- **Complejidad.** O(largo del texto) para analizar; O(hijos) por paso de ruta.

### 4.8 Estructuras del lenguaje que también se usan

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

### Antes de los pases: reglas del perfil (`reglas.ts`)

`compilarReglas` compila una sola vez las regex (ya revisadas contra ReDoS) y
devuelve una función que, para cada movimiento, da la primera regla de cada
tipo de acción por `prioridad`. Las de `clasificar` sacan el movimiento del
cruce (van a `resultado.clasificados`, p. ej. el GMF 4×1000 como
`gasto:GMF`); `exigirReferencia` y `tolerancia` cambian lo que aceptan los
pases para ese movimiento. Costo O((n + m)·c), con c condiciones (≤ 200
reglas × 20 condiciones por perfil).

### Pase 1: exacta (O(n + m) esperado)

0. **Bre-B** (0.2.0): si el abono trae `referenciaPago` (Referencia de Pago
   de Bre-B) y una venta tiene la misma `referenciaPago` o `referencia`, esa
   es la llave principal, porque identifica la transferencia de punta a punta.
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
   luego orden del archivo. Esto no garantiza el emparejamiento óptimo. Sí
   evita el error del greedy ingenuo, que va abono por abono y deja sin
   pareja al que tenía una sola opción. Desde 0.2.0, con `cruceOptimo` (por
   defecto) y componentes de hasta 60 nodos, se usa el **algoritmo Húngaro**
   (ver abajo); el greedy queda para componentes más grandes y para
   `cruceOptimo: false`.

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

### Pase 2 óptimo: algoritmo Húngaro (`hungaro.ts`)

- **Problema.** Dentro de una componente del grafo, elegir parejas abono↔venta
  sin repetir nodos que **maximicen la suma de puntajes**. El greedy puede
  equivocarse: una arista alta (0,95) que bloquea dos buenas (0,9 + 0,9) gana
  0,95 en vez de 1,8.
- **Algoritmo.** Kuhn-Munkres con potenciales (implementación propia,
  `asignacionMinima`): por cada fila busca un camino aumentante de costo
  reducido mínimo y actualiza los potenciales u, v. `emparejamientoMaximo`
  convierte el problema a costo mínimo sobre una matriz cuadrada k×k
  (k = max(abonos, ventas)), con costo 0 para «sin pareja», así un nodo puede
  quedar libre.
- **Desempates reproducibles.** Los pesos son enteros: el puntaje con 4
  decimales en la parte alta (× 2²⁰) y, en la baja, el puesto de la arista en
  el orden de desempate del greedy. A igual suma gana la misma preferencia
  que usaba el MVP, y no hay errores de redondeo al sumar.
- **Complejidad.** O(n²·m) con n ≤ m; para la matriz cuadrada, **O(k³)**. Por
  eso solo se usa en componentes de hasta 60 nodos (`MAX_NODOS_OPTIMO`):
  60³ ≈ 216.000 operaciones por componente como máximo. Con 5 candidatos por
  abono casi todas las componentes son mucho menores.
- **Garantía probada.** `hungaro.test.ts` compara contra fuerza bruta en
  matrices pequeñas y verifica la propiedad del plan: el óptimo **nunca suma
  menos que el greedy**, en componentes pseudoaleatorias y en `conciliar`
  completo.

### Pase 4: N:M, suma de subconjuntos por componente

Para lo que siguió libre tras el pase 3 (solo con `cruceOptimo`):

1. Se arma otro `GrafoBipartito` abono↔venta con las ventas de la ventana de
   fechas de cada abono (abonos con más de 40 candidatas no entran).
2. Por cada componente con **2 o más abonos**, hasta 24 nodos
   (`MAX_NODOS_NM`) y hasta 6 abonos (`MAX_ABONOS_NM`), se prueban los
   subconjuntos de 2 o más abonos (como mucho 2⁶ − 6 − 1 = 57). Para cada uno
   se suman sus montos y se busca, con el mismo **backtracking con poda** del
   pase 3, el subconjunto de ventas vecinas (1 a `maxGrupo`) cuya suma cae en
   la tolerancia, con presupuesto de 20.000 nodos. Cada abono del grupo debe
   tener al menos una venta del grupo en su ventana.
3. Se toma el mejor cluster (puntaje del grupo × 0,95, siempre `sugerida`), se
   ocupan sus nodos y se repite con lo que queda de la componente.
4. Componentes más grandes o búsquedas cortadas por el presupuesto se informan
   en `pases` («agrupadaNM omitida») y en `motivos`.

Complejidad: por componente O(2ᵃ·B) con a ≤ 6 y B ≤ 20.000 (constante
acotada); en total O(m log m + E + c·2ᵃ·B) con c componentes candidatas. Con
`maxGrupo` 0 o 1 el pase no corre (igual que el pase 3), para que quien usaba
`maxGrupo: 1` como «no agrupar» en 0.1.0 siga sin grupos.

### Por qué no cruzó (`motivos.ts`)

Después de los pases, cada movimiento libre recibe una frase en español con lo
que los pases anotaron y una revisión de su ventana de fechas (búsqueda
binaria sobre los movimientos ordenados por día): sin candidatos en la
ventana, monto fuera de tolerancia por $X (con la pareja más cercana), mejor
candidato bajo el umbral, candidato tomado por otra coincidencia (cuál y con
qué puntaje), regla de referencia que nadie cumple, demasiados candidatos para
agrupar, o débito/venta negativa. Costo O(s·w), s sin cruzar y w movimientos
por ventana.

### Explicación de diferencias (`puntaje.ts`, `tarifas.ts`)

Por cada coincidencia con faltante se busca, en orden:

1. el desglose de la venta (comisión, IVA, retenciones);
2. la **comisión típica del lote** (la mediana del % faltante) más cada
   combinación de retenciones del perfil (2^r con r ≤ 10);
3. solo retenciones.

Se acepta un margen de ±1 %. Ejemplo real de la demo: «Faltan $24.198,20
(4,65 % de $520.000) ≈ comisión 3,15 % + ReteFuente 1,5 % ($7.800)».

Si el perfil trae `tarifas`, primero se calculan las vigentes a la fecha del
abono (la más específica por nombre: con medio de pago y municipio antes que
sin ellos, la de vigencia más reciente) y se busca la combinación más simple
que explica el faltante, respetando dependencias (el IVA de la comisión solo
con la comisión, ReteIVA solo con el IVA). Se prueban a lo sumo 2¹⁰
combinaciones (`MAX_NOMBRES_TARIFA`).

### Total

Tiempo O((n + m) log m + n·k), con el pase 3, el Húngaro y el pase N:M
acotados por constantes. Memoria O(n + m). La sección 8 muestra que **k** es
lo que domina en la práctica.

## 6. Base de datos y transacciones

El esquema vive en **migraciones numeradas** (`apps/api/src/migraciones/`):

| Migración | Qué hace |
|---|---|
| `001_inicial.sql` | El esquema del MVP (antes `esquema.sql`) |
| `002_multiempresa.sql` | Empresas, usuarios, `empresa_id` en todo, plantillas y perfiles versionados, auditoría |
| `003_trabajos.sql` | Cola persistente de trabajos |
| `004_cruce_ampliado.sql` | Tipo `agrupadaNM` y columna `extra jsonb` para lo que el núcleo agregue |

`aplicarMigraciones` toma un *advisory lock* (dos instancias que arrancan a la
vez no chocan), corre cada archivo pendiente **una vez** en su propia
transacción y lo anota en la tabla `migraciones` con su SHA-256; si alguien
edita una migración ya aplicada, se registra un aviso en vez de reaplicarla.
La API y el worker migran al arrancar. Una base creada por 0.1.0 se migra sin
perder datos: sus filas quedan en la empresa pública `demo`.

### 6.1 Modelo del MVP

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

### 6.2 Modelo multiempresa

```
empresas (id uuid PK, nombre, codigo UNIQUE — solo 'demo' lo tiene)
   │ 1
   ├── N usuarios (id, empresa_id, nombre, correo UNIQUE lower(), hash_contrasena 'scrypt$N$r$p$sal$hash',
   │               rol CHECK admin|analista|lector, activo)
   ├── N conciliaciones (+ empresa_id, usuario_id, perfil_id, perfil_version; UNIQUE (id, empresa_id))
   │        └── coincidencias · movimientos · eventos (+ empresa_id;
   │              FK (conciliacion_id, empresa_id) → conciliaciones (id, empresa_id))
   │              eventos.usuario_id = quién decidió (auditoría)
   ├── N plantillas_empresa (empresa_id, id, lado, version_actual)
   │        └── N plantillas_versiones (empresa_id, plantilla_id, version, contenido jsonb, usuario_id)
   ├── N perfiles_empresa (empresa_id, id, version_actual)
   │        └── N perfiles_versiones (empresa_id, perfil_id, version, contenido jsonb, usuario_id)
   └── N trabajos (cola, sección 6.3)
```

Decisiones:

- **Aislamiento en la base, no solo en la API.** Toda tabla con datos de
  negocio lleva `empresa_id` y toda consulta filtra por la empresa del token.
  Además las hijas tienen una llave foránea **compuesta** `(conciliacion_id,
  empresa_id)`: aunque la API tuviera un error, la base no acepta un
  movimiento de la empresa A colgado de una conciliación de la empresa B. Un
  disparador completa `empresa_id` desde la conciliación si el `INSERT` no lo
  trae.
- **Historial inmutable.** Guardar una plantilla o un perfil crea la versión
  `version_actual + 1`; un disparador rechaza `UPDATE` y `DELETE` en las
  tablas de versiones, y `UPDATE` en `eventos`. Una conciliación guarda el
  `perfil_id` y la `perfil_version` con que se hizo, así se puede repetir
  aunque el perfil cambie después.
- **Índices para los filtros reales**: `(empresa_id, creada DESC, id DESC)` en
  conciliaciones (la paginación por cursor recorre ese índice), usuarios por
  empresa, eventos por usuario.
- **Paginación por cursor** (*keyset*): el cursor es la clave de la última
  fila vista en base64url; cuesta lo mismo en la página 1 que en la 1.000 y no
  repite ni salta filas si entran nuevas.

### 6.3 Cola persistente con `FOR UPDATE SKIP LOCKED`

`POST /conciliaciones?asincrono=1` valida el cuerpo, inserta una fila en
`trabajos` (estado `pendiente`, la entrada en `carga jsonb`) y responde **202**
con el id. La API no concilia: no se bloquea con un archivo grande. Un
proceso aparte (`apps/api/src/worker.ts`, `npm run worker -w apps/api`) toma
trabajos así:

```sql
UPDATE trabajos t SET estado = 'procesando', intentos = t.intentos + 1, toma = $1, worker = $2, tomado_en = now()
WHERE t.id = (SELECT id FROM trabajos WHERE estado = 'pendiente' AND disponible_en <= now()
              ORDER BY disponible_en, creado LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING ...
```

- **Por qué `SKIP LOCKED`.** Con `FOR UPDATE` a secas, dos workers esperarían
  la misma fila. Con `SKIP LOCKED` cada uno salta las filas que otro ya
  bloqueó y toma la siguiente: varios workers trabajan en paralelo y **nunca
  dos procesan el mismo trabajo** (prueba «dos workers concurrentes procesan
  cada trabajo exactamente una vez»). Es una cola FIFO por `disponible_en`
  sobre un índice parcial `WHERE estado = 'pendiente'`, así el costo de tomar
  no crece con los trabajos ya hechos.
- **Guardar y cerrar en una transacción.** El worker concilia y, en **una**
  transacción, guarda la conciliación y marca el trabajo `hecho`. El cierre
  exige que la `toma` (un uuid de esa toma) siga siendo la suya: si el
  trabajo se dio por perdido y otro worker lo tomó, el lento hace `ROLLBACK` y
  nada se guarda dos veces.
- **Reintentos con límite.** Un error de datos (4xx, regex que agota su
  tiempo) marca `fallido` sin reintentar. Otro error (base caída) devuelve el
  trabajo a `pendiente` con espera exponencial (2 s, 4 s, 8 s… hasta 5 min)
  hasta `max_intentos` (3).
- **Workers caídos.** Un trabajo en `procesando` por más de 10 minutos vuelve a
  la cola (o queda `fallido` si no le quedan intentos).
- **Apagado limpio.** Ante `SIGTERM` el worker deja de tomar, termina el
  trabajo en curso (tope de 25 s, Render da 30) y cierra el pool.

Complejidad: tomar un trabajo es O(log t) sobre el índice parcial; el trabajo
en sí cuesta lo mismo que `conciliar` más un `INSERT` masivo por tabla.

## 7. Seguridad

| Riesgo | Medida |
|---|---|
| Contraseñas robadas de la base | **scrypt** (N = 16384, r = 8, p = 1) con sal aleatoria de 16 bytes por usuario; los parámetros viajan con el hash para endurecerlos sin invalidar los viejos. Comparación con `timingSafeEqual` |
| Tokens falsificados | **JWT HS256** propio con `node:crypto`: solo se acepta `alg: HS256` (un token `none` u otro algoritmo se rechaza antes de mirar la firma), firma comparada en tiempo constante, `exp` obligatorio (8 h por defecto). Secreto en `JWT_SECRETO`; un usuario desactivado deja de pasar aunque su token no haya vencido |
| Una empresa ve datos de otra | `empresa_id` del token en toda consulta + llaves foráneas compuestas en la base (sección 6.2). Pruebas de aislamiento en `multiempresa.test.ts` y `cola.test.ts` |
| Permisos | Roles jerárquicos `lector` < `analista` < `admin` por ruta. Sin token se opera como analista anónimo de la empresa `demo` (las rutas del MVP siguen funcionando) y no se administra nada |
| Fuerza bruta en el ingreso | Límite por IP en `/auth/ingreso` y `/auth/registro` (10 por minuto, responde 429). Detrás de Render la IP sale de `X-Forwarded-For` solo si `CONFIAR_PROXY=1` |
| ReDoS con regex de usuario | `revisarRegex` (`core/src/regexSegura.ts`): ≤ 200 caracteres, sin cuantificadores anidados `(a+)+`, sin `(a|b)+`, sin referencias hacia atrás, a lo sumo dos `*`/`+`. Al ejecutarlas el texto se recorta a 256 caracteres y un presupuesto de tiempo corta con `ErrorRegexCostosa` (422 en la API, `fallido` sin reintento en la cola). La demo anónima no acepta reglas `regex` (403). Perfiles: ≤ 200 reglas, ≤ 20 condiciones |
| XML malicioso | El parser propio rechaza `DOCTYPE` (sin expansión de entidades ni entidades externas) y entidades desconocidas, para camt.053 y DIAN por igual |
| Cuerpos enormes | Máximo 2 MB por petición (413) |
| Fugas en errores | Un 500 responde «Error interno del servidor»; el detalle SQL queda solo en el registro JSON |
| Historial alterado | Versiones de plantillas y perfiles y la bitácora de eventos son de solo agregar (disparadores) |
| Datos personales | El panel procesa en el navegador; la API solo guarda lo que se le envía; `scripts/anonimizar.ts` para donar archivos reales; todas las muestras son sintéticas |

## 8. Mediciones

Scripts: [`scripts/medir.ts`](../scripts/medir.ts) y
[`scripts/carga.ts`](../scripts/carga.ts). Generan ventas y abonos
**sintéticos y deterministas** con un generador pseudoaleatorio con semilla
fija (mulberry32). La mezcla es: 45 % pares exactos, 30 % con comisión de
2,5–4,5 % y referencia truncada, 15 % de ventas abonadas en grupos de 2 a 4,
5 % de ventas sin abono y 5 % de abonos sin venta. `medir.ts` mide
`conciliar` con `PERFIL_POR_DEFECTO` (que en 0.2.0 trae `cruceOptimo: true`:
Húngaro y pase N:M encendidos), tras una corrida de calentamiento, y reporta la
mediana de 5 corridas (3 para 100.000).

```bash
npm run medir                            # 60 ventas por día (comercio mediano)
npm run medir -- --por-dia=10            # comercio pequeño
CARGA_DATABASE_URL=postgres://... npm run carga   # 10⁶ movimientos + cola con 2 workers
```

Equipo: Apple M5, 16 GB, macOS, Node v24.15.0. Corridas del 17 de octubre de
2026 sobre la versión 0.2.0.

### 8.1 `conciliar` (versión 0.2.0)

**60 ventas por día:**

| Ventas | Abonos | Mediana | Mínimo | Automáticas | Sugeridas | Banco conciliado | Pases | Aristas del grafo |
|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 10.000 | 7.587 | 91 ms | 87 ms | 3.675 | 2.690 | 83,9 % | exacta 3.645 · tolerancia 2.707 · agrupada 13 · omitida 1.220 | 10.643 |
| 100.000 | 76.065 | 2.128 ms | 2.077 ms | 36.319 | 26.974 | 83,2 % | exacta 36.256 · tolerancia 26.949 · agrupada 88 · omitida 12.739 | 105.818 |

**10 ventas por día:**

| Ventas | Abonos | Mediana | Mínimo | Automáticas | Sugeridas | Banco conciliado | Pases | Aristas del grafo |
|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 10.000 | 7.587 | 179 ms | 149 ms | 3.647 | 3.559 | 95,5 % | exacta 3.645 · tolerancia 2.545 · agrupada 996 · N:M 20 (13 omitidas) | 4.094 |
| 100.000 | 76.065 | 2.499 ms | 2.439 ms | 36.263 | 35.874 | 95,4 % | exacta 36.256 · tolerancia 25.681 · agrupada 9.964 · N:M 236 (153 omitidas) | 40.046 |

**Comparación con el MVP (0.1.0, mismo equipo y datos):**

| Escenario | 0.1.0 | 0.2.0 | Banco conciliado 0.1.0 → 0.2.0 |
|---|---:|---:|---|
| 100.000 ventas, 60 por día | 2.257 ms | 2.128 ms | 82,4 % → 83,2 % |
| 100.000 ventas, 10 por día | 2.605 ms | 2.499 ms | 93,1 % → 95,4 % |
| 10.000 ventas, 10 por día | 129 ms | 179 ms | 93,1 % → 95,5 % |

### 8.2 Prueba de carga: 10⁶ movimientos y la cola

**Núcleo** (`scripts/carga.ts`): 1.000.000 de movimientos (banco + ventas) en
10 lotes de 100.000, cada lote un periodo independiente como un extracto
mensual.

| Lotes | Movimientos | Conciliar (total) | Por lote | Ritmo | Banco conciliado | Memoria máxima (RSS) |
|---:|---:|---:|---:|---:|---:|---:|
| 10 | 1.000.000 | 10.022 ms (10.752 ms con la generación) | 952 a 1.049 ms | 99.782 mov/s | 83,1 % | 638 MB |

**Cola** (PostgreSQL 16 local, 2 procesos worker reales): 40 trabajos de unos
2.000 movimientos encolados por HTTP con `POST /conciliaciones?asincrono=1`.

| Medida | Valor |
|---|---|
| Encolar 40 trabajos (80.017 movimientos) | 204 ms (5 ms por POST, respuesta 202) |
| Procesar los 40 (desde lanzar los workers) | 2.630 ms; 40 hechos, 0 fallidos |
| Ritmo | 15,2 trabajos/s · 30.429 movimientos/s |
| Por trabajo (leer + conciliar + guardar en una transacción) | promedio 36 ms, máximo 63 ms |
| Workers que tomaron trabajo | 2 de 2 |
| Latencia de `GET /salud` durante la carga (50 sondeos) | p50 1,0 ms · p95 1,3 ms · máximo 3,3 ms |

Lo que muestran los números:

- **10⁶ movimientos se concilian en unos 10 segundos** por lotes, con memoria
  acotada (638 MB). El criterio de la fase 13, «10⁶ movimientos conciliados sin
  bloquear la API», se cumple: mientras los workers procesan, `/salud`
  responde en 1 ms de mediana, porque la API solo inserta en la cola.
- **El cruce óptimo no encareció el caso grande.** A 100.000 ventas 0.2.0 es
  incluso un poco más rápido que 0.1.0 (el resto del código también cambió) y
  concilia más: el Húngaro y el pase N:M suben el banco conciliado de 93,1 % a
  95,4 % con 10 ventas por día. Con 10.000 ventas y 10 por día el pase N:M sí
  se nota (129 → 179 ms), porque hay muchas componentes pequeñas que explorar;
  en valor absoluto sigue siendo una fracción de segundo.
- **El crecimiento sigue sin ser O(n log n).** 10 veces más datos tardan unas
  14 a 23 veces más. La causa ya medida en el MVP sigue ahí: el AVL del pase
  2 indexa **solo por monto**, así que un rango del 5 % devuelve k ventas que
  crecen con m y la mayoría se descarta por fecha. Procesar por periodos (como
  hace `carga.ts`) acota m y es la forma práctica de escalar hoy; el índice
  día+monto queda pendiente (sección 10).
- **El pase agrupado depende de la densidad.** Con 60 ventas por día una
  ventana de 6 días tiene unas 360 candidatas, más que el tope de 40, y casi
  todos los abonos agrupados quedan para revisión manual (se informan en
  `pases` y en `motivos`). Con 10 por día el pase encuentra casi todos.
- El pase 1 resuelve casi la mitad de los abonos con un `Map`, en tiempo
  lineal. Por eso conviene ir de barato a caro.

## 9. Pruebas

```bash
npm test                                             # 246 pruebas (las de PostgreSQL se saltan)
DATABASE_URL_PRUEBA=postgres://... npm test          # 274: incluye las de la API con base real
```

| Archivo | Qué cubre |
|---|---|
| `packages/core/test/estructuras.test.ts` | Las 6 estructuras: vacía, un elemento, muchos elementos y comparación contra fuerza bruta |
| `packages/core/test/plantillas.test.ts` | Validador, parser CSV (comillas, saltos dentro de comillas, BOM, CRLF), ancho fijo, detección |
| `packages/core/test/cruce.test.ts` | Perfiles, cada pase, tolerancia asimétrica, ventana de días, prefijo con Trie, conflicto donde el greedy ingenuo falla, tope de 40 candidatos, explicaciones, determinismo, invariantes con 1.000 movimientos, `cruceOptimo: false` contra el comportamiento de 0.1.0 |
| `packages/core/test/hungaro.test.ts` | Húngaro contra fuerza bruta, «nunca peor que el greedy», clusters N:M (y `maxGrupo` 1 sin grupos), motivos |
| `packages/core/test/reglas.test.ts` | Reglas AND/OR, prioridades, GMF, exigir referencia, tolerancia por regla, tarifas con vigencia, municipio y medio de pago, Bre-B, demo idéntica al MVP |
| `packages/core/test/regexSegura.test.ts` | Regex rechazadas (anidadas, alternancias, referencias), recorte y presupuesto de tiempo |
| `packages/core/test/formatos.test.ts` | MT940, camt.053, lectores registrables, `plantillaVersion`, columna opcional Bre-B, parser XML (misma política que DIAN) |
| `packages/core/test/anonimizar.test.ts` | Cada muestra conserva líneas, longitudes y columnas y se lee igual; reemplazos estables; Excel |
| `packages/core/test/escenario.test.ts` | Prueba de aceptación: las muestras de `ESCENARIO.md` dan exactamente lo esperado |
| `packages/core/test/sesion.test.ts` | Confirmar, rechazar, manual, deshacer y rehacer, bitácora |
| `packages/plantillas/muestras.test.ts` | Las muestras son coherentes (saldos, totales de control Asobancaria, encabezados) |
| `packages/excel/test/excel.test.ts` | `.xlsx` → CSV, hojas, números sin exponente, misma lectura que el CSV |
| `packages/dian/test/dian.test.ts` | Parser XML con namespaces y errores con línea/columna, facturas, notas crédito, `AttachedDocument`, CUFE, retenciones, duplicados, cruce pagos B2B ↔ facturas |
| `apps/api/test/api.test.ts` | Rutas, validación, CORS, límites, y con PostgreSQL: guardado, transacciones, `FOR UPDATE`, rollback |
| `apps/api/test/seguridad.test.ts` | JWT (vencido, alterado, `alg: none`), roles, scrypt, límite de velocidad, cursores |
| `apps/api/test/multiempresa.test.ts` | Migraciones (también desde una base del MVP), aislamiento entre empresas, roles, versiones de plantillas y perfiles, paginación, métricas |
| `apps/api/test/cola.test.ts` | 202 y `GET /trabajos/:id`, `SKIP LOCKED` con dos workers, rollback y reintentos, worker caído, proceso real con `SIGTERM` |

El CI (`.github/workflows/ci.yml`) revisa los tipos, corre todo con un
servicio PostgreSQL 16 y compila la librería (`build:lib`) y el panel.

## 10. Limitaciones y estado de las fases

Limitaciones conocidas de la versión 0.2.0:

- **Pase 2 en O(n·k)** con k proporcional a m (sección 8). Hoy se escala por
  periodos; falta el índice día+monto.
- **Pase agrupado** inútil con más de 40 ventas en la ventana. Esos abonos
  quedan para revisión manual, con su motivo.
- El Húngaro solo se usa en componentes de hasta 60 nodos; las más grandes
  siguen con el greedy.
- La API **no recibe emparejamientos manuales** hechos en el panel.
- **Asobancaria 2001**: el lector va línea por línea y espera la fecha repetida
  en la zona reservada del detalle (ver la descripción de la plantilla).
- Las plantillas se construyeron con documentación pública y datos
  sintéticos; **falta validarlas con archivos reales** anonimizados (fase 8).
- El límite de velocidad del ingreso vive en la memoria de cada proceso: con
  varias instancias de la API cada una cuenta por su lado.
- Los workers de Render no tienen plan gratuito (ver
  [DESPLIEGUE.md](DESPLIEGUE.md)).

Estado de las fases de escalado (detalle en [PLAN.md](PLAN.md)):

| Fase | Estado | Qué falta |
|---|---|---|
| 8. Validación con usuarios | Parcial | Herramienta (`scripts/anonimizar.ts`) y guía ([GUIA_VALIDACION.md](GUIA_VALIDACION.md)) listas; faltan las entrevistas y los archivos reales |
| 9. Más formatos | Hecha | — |
| 10. Reglas avanzadas | Hecha | — |
| 11. Cruce N:M y explicabilidad | Hecha | — |
| 12. Multiempresa | Hecha | — |
| 13. Escala y estabilidad | Hecha | Índice día+monto del pase 2 (mejora, no criterio de la fase) |
| 14. Librería pública | Lista para publicar | `npm publish` con la cuenta del autor |
| 15. Colombia | Parcial | Bre-B y facturas DIAN hechos; faltan los exportes para contabilidad |
