# Conciliador

Librería modular en TypeScript que cruza los abonos del banco con las ventas de
un comercio colombiano y explica cada diferencia, adaptable a cualquier banco o
pasarela con plantillas JSON.

[![Licencia MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)

## El problema

En Colombia una venta de $520.000 pagada por PSE o tarjeta casi nunca llega
completa ni el mismo día. La pasarela (Wompi, Mercado Pago…) descuenta su
comisión y el IVA sobre la comisión. A veces aplica también ReteFuente, abona
varias ventas en un solo depósito y deja una referencia truncada. Encima, cada
banco exporta el extracto en su propio formato: CSV con `;`, montos con
`1.234,56`, Excel, archivos de recaudo Asobancaria de ancho fijo en latin1,
MT940 o camt.053 por banca empresarial.

El resultado es que alguien de contabilidad pasa horas cruzando a mano dos
hojas de cálculo. El conciliador hace ese cruce y deja a la persona solo los
casos dudosos, con una explicación en español de cada diferencia
(«Faltan $24.198,20 (4,65 %) ≈ comisión 3,15 % + ReteFuente 1,5 %»).

## Qué trae (versión 0.2.0)

| Área | Qué hay |
|---|---|
| Formatos | CSV/delimitado y ancho fijo por plantilla JSON; **Excel** (`.xlsx`, `.xls`) con `@conciliador/excel`; **MT940** y **camt.053** como lectores registrados; **facturas electrónicas DIAN** (UBL 2.1) con `@conciliador/dian` |
| Plantillas incluidas | Extracto bancario CSV, Asobancaria 2001, Wompi, Mercado Pago, ventas de un ERP, MT940 genérico y camt.053 genérico. Cada movimiento guarda `plantillaVersion` |
| Cruce | Exacto (con la Referencia de Pago de Bre-B como llave), 1:1 con tolerancia, N:1 por suma de subconjuntos y **N:M**; asignación **óptima con el algoritmo Húngaro** por componente del grafo |
| Reglas y tarifas | Reglas AND/OR ordenadas (clasificar, exigir referencia, cambiar tolerancia), GMF 4×1000 como gasto, tarifas de comisión y retenciones con vigencia, medio de pago y municipio |
| Explicabilidad | Cada coincidencia explica su diferencia y cada movimiento sin cruzar trae su **motivo** («Monto fuera de tolerancia por $3.398,20…», «Su candidato V3 quedó en c4…») |
| Revisión | Confirmar, rechazar, emparejar a mano, deshacer y rehacer, bitácora que solo crece |
| API | Multiempresa con usuarios, roles y JWT; plantillas y perfiles por empresa con historial de versiones; **cola de trabajos** en PostgreSQL con worker aparte; paginación, registros JSON y métricas |
| Librería | `@conciliador/core`, `@conciliador/plantillas`, `@conciliador/excel` y `@conciliador/dian` compilan a JS + `.d.ts` (`npm run build:lib`), listos para npm |

## Cómo funciona

```
 extracto.csv ─┐                                      ┌─ Coincidencias
 recaudo.txt  ─┤   PLANTILLA JSON          MOVIMIENTO │   automáticas / sugeridas
 ventas.csv   ─┤  (formato, columnas, ─►   ESTÁNDAR   │   + explicación
               │   fecha, decimales)      (centavos   │
   Cola ───────┘   detección con Trie      enteros)   └─ Sin cruzar
                                              │
                                              ▼
                      ┌──────────── CRUCE POR PASES (de barato a caro) ───────────┐
                      │ 1. Exacta     Map  monto|referencia, luego monto|fecha    │
                      │ 2. Tolerancia ArbolAVL por monto + Trie de referencias    │
                      │               + TopK (MinHeap) + GrafoBipartito           │
                      │ 3. Agrupada   N ventas -> 1 abono, backtracking con poda  │
                      │ 4. N:M        varios abonos <-> varias ventas por         │
                      │               componente del grafo (cruceOptimo)          │
                      └───────────────────────────────────────────────────────────┘
                                              │
                                              ▼
                      REVISIÓN HUMANA (SesionRevision)
                      confirmar / rechazar / emparejar a mano
                      deshacer y rehacer con dos Pilas · bitácora que solo crece
                                              │
                                              ▼
                      Panel React (navegador)  ──opcional──►  API Node + PostgreSQL
                                                              (cada decisión en una transacción)
```

1. **Plantilla.** Un JSON describe el formato: separador, columnas, formato de
   fecha y separador decimal, filas a omitir, posiciones de ancho fijo. El
   registro detecta la plantilla de un archivo por sus encabezados o por el
   prefijo de la primera línea.
2. **Movimiento estándar.** Toda fila termina como un `Movimiento`
   (`packages/core/src/modelo.ts`): fecha ISO, monto en **centavos enteros**,
   referencia normalizada. El motor de cruce no sabe de bancos.
3. **Cruce.** Primero las reglas del perfil sacan lo que no es un pago (por
   ejemplo el GMF). Luego van los pases; cada uno trabaja solo con lo que el
   anterior dejó libre. Las tolerancias, la ventana de días, las retenciones,
   las reglas y las tarifas vienen de un **perfil** por empresa, que también
   es JSON.
4. **Revisión.** Lo que supera `umbralAutomatico` queda automático. Lo demás
   llega como sugerencia, y la persona confirma, rechaza (los movimientos
   quedan libres otra vez) o empareja a mano.

## Estructuras de datos propias

Todas están implementadas a mano en `packages/core/src/estructuras/`, sin
librerías, y tienen pruebas en `packages/core/test/estructuras.test.ts`.

| Estructura | Archivo | Dónde se usa en el conciliador |
|---|---|---|
| **Cola** (FIFO con índice de inicio) | `Cola.ts` | `procesarArchivos` atiende los archivos en orden de llegada; BFS de `GrafoBipartito.componentes()` |
| **Pila** (×2) | `Pila.ts` | Deshacer y rehacer en `SesionRevision` |
| **Árbol AVL** (claves repetidas) | `ArbolAVL.ts` | Pase 2: ventas indexadas por monto; `buscarRango` da las candidatas dentro de la tolerancia |
| **Trie** | `Trie.ts` | Detección de plantilla por encabezados y prefijo de línea (`RegistroPlantillas`); referencias truncadas en el pase 2 |
| **MinHeap** + **TopK** | `MinHeap.ts` | Pase 2: guarda los 5 mejores candidatos de cada abono en O(log k) |
| **Grafo bipartito** (lista de adyacencia) | `GrafoBipartito.ts` | Pase 2: aristas abono↔venta candidata; cada componente conexa es un conflicto que se resuelve aparte; el panel lo dibuja |

Desde la versión 0.2.0 hay además algoritmos propios que se apoyan en ellas:
el **Húngaro** (`cruce/hungaro.ts`, O(k³) por componente de hasta 60 nodos),
la **suma de subconjuntos por componente** del pase N:M y un **parser XML**
(`plantillas/xml.ts`) que comparten camt.053 y las facturas DIAN.

La justificación y la complejidad de cada una están en
[docs/DOCUMENTO_FINAL.md](docs/DOCUMENTO_FINAL.md).

## Formatos

| Formato | Cómo se lee | Plantilla o paquete |
|---|---|---|
| CSV / TXT delimitado | Plantilla declarativa (`tipo: "delimitado"`) | `banco-csv-generico`, `wompi-transacciones`, `mercadopago-liquidacion`, `ventas-csv-generico` |
| Ancho fijo | Plantilla declarativa (`tipo: "anchoFijo"`) | `asobancaria-2001` (latin1) |
| Excel `.xlsx` / `.xls` | `leerExcel` convierte la hoja en CSV con `;` y se usa **la misma plantilla delimitada** del CSV (campo opcional `hoja`) | `@conciliador/excel` (SheetJS) |
| MT940 (SWIFT) | Lector registrado `mt940`: campos `:61:`/`:86:`, verifica `:60F:` + movimientos = `:62F:` | `mt940-generico` |
| camt.053 (ISO 20022) | Lector registrado `camt053`: cada `<Ntry>` es un movimiento, verifica saldo de apertura + movimientos = cierre | `camt053-generico` |
| Factura electrónica DIAN (UBL 2.1) | `leerFacturaUBL` / `leerFacturas`: número, CUFE, NIT, IVA, retenciones y total a pagar; lado `ventas` | `@conciliador/dian` |

Un formato que no cabe en una plantilla se agrega con `registrarLector({ tipo,
leer, detectar? })`; la plantilla solo dice `"tipo": "<ese tipo>"` y mapea los
campos que el lector entrega. La detección automática funciona con todos los
formatos de plantilla (el Excel, después de convertirlo a CSV); las facturas
DIAN se leen con su propio paquete.

La columna opcional `REFERENCIA PAGO` (Referencia de Pago de **Bre-B**) va a
`referenciaPago`, y el pase exacto la usa como llave principal. Por ese cambio
de mapeo la plantilla `banco-csv-generico` está en la versión 2.

## Reglas, tarifas y cruce óptimo

Todo esto son campos **opcionales** del perfil; un perfil de 0.1.0 sigue siendo
válido.

```json
{
  "reglas": [{
    "id": "gmf-4x1000", "nombre": "GMF 4x1000 como gasto bancario", "prioridad": 10, "lado": "banco",
    "si": { "alguna": [{ "campo": "descripcion", "op": "contiene", "valor": "GMF" },
                       { "campo": "descripcion", "op": "contiene", "valor": "4X1000" }] },
    "accion": { "tipo": "clasificar", "categoria": "gasto:GMF" }
  }],
  "tarifas": [
    { "nombre": "Comision",   "tasa": 0.0265, "base": "bruto",    "desde": "2026-01-01" },
    { "nombre": "IVA",        "tasa": 0.19,   "base": "comision", "desde": "2026-01-01" },
    { "nombre": "ReteICA",    "tasa": 0.0033, "base": "bruto",    "desde": "2026-01-01", "municipio": "Cali" }
  ],
  "municipio": "Cali",
  "cruceOptimo": true
}
```

- **Reglas** (`cruce/reglas.ts`): condiciones `todas` (AND) y `alguna` (OR)
  sobre referencia, descripción, plantilla (`igual`, `contiene`, `empiezaPor`,
  `regex`), monto o fecha (`entre`). Acciones: `clasificar` (el movimiento sale
  del cruce y aparece en `resultado.clasificados`), `exigirReferencia` y
  `tolerancia`. Se aplican por `prioridad` (menor primero). `REGLA_GMF` viene
  lista.
- **Tarifas** (`cruce/tarifas.ts`): comisión, IVA, ReteFuente, ReteICA, ReteIVA
  o GMF con vigencia (`desde`/`hasta`), medio de pago y municipio. Las vigentes
  a la fecha del abono explican el faltante. `retenciones` del MVP sigue
  funcionando.
- **Regex seguras**: toda regex de usuario (reglas y plantillas) pasa por
  `revisarRegex` contra ReDoS (ver «Seguridad» en el documento final).
- **Cruce óptimo** (`cruceOptimo`, por defecto `true`): el pase 2 asigna con el
  algoritmo Húngaro en vez del greedy, se activa el pase N:M (`agrupadaNM`) y
  en el pase 3 un abono cuya referencia nombra una venta solo se agrupa con
  ella. **`cruceOptimo: false` da exactamente el resultado de 0.1.0.**
- `maxGrupo` limita las ventas por grupo en los pases N:1 y N:M. Con `0` o `1`
  no se agrupa nada (ni N:1 ni N:M), igual que en 0.1.0.
- **Motivos**: `resultado.motivos[id]` dice en español por qué no cruzó cada
  movimiento libre: sin candidatos en la ventana, fuera de tolerancia por
  cuánto, candidato tomado por otra coincidencia, demasiados candidatos para
  agrupar, débito o venta negativa.

## Cómo correrlo

Requisitos: **Node 24** (ejecuta TypeScript sin compilar; desde 22.18 también
funciona) y npm. PostgreSQL es opcional.

```bash
npm install                  # instala los workspaces
npm test                     # núcleo, plantillas, excel, dian y API (las de PostgreSQL se saltan sin base)
npm run typecheck            # tipos del núcleo, paquetes, API y panel
npm run dev:web              # panel en http://localhost:5173
npm run start:api            # API en http://localhost:3000
npm run worker -w apps/api   # worker de la cola de trabajos (proceso aparte, necesita DATABASE_URL)
npm run build:web            # compila el panel a apps/web/dist
npm run build:lib            # compila core, plantillas, excel y dian a dist/ (JS + .d.ts)
npm run medir                # tiempo de conciliar 10.000 y 100.000 movimientos sintéticos
npm run carga                # prueba de carga: 10⁶ movimientos y la cola con workers reales
npm run anonimizar -- entrada.csv salida.csv   # anonimiza un archivo real para donarlo
```

Dentro del monorepo los paquetes `@conciliador/*` se resuelven a su TypeScript
sin compilar gracias a la condición `conciliador-src` que `.npmrc` pasa a todos
los scripts de npm. Si corre un script directamente con `node`, agregue
`--conditions=conciliador-src` (por ejemplo
`node --conditions=conciliador-src scripts/carga.ts --solo-nucleo`); sin ella
Node usaría `dist/`, que solo existe tras `npm run build:lib`.

**Prueba de carga** (`scripts/carga.ts`): `--solo-nucleo` concilia 10⁶
movimientos sintéticos por lotes; la parte de cola necesita
`CARGA_DATABASE_URL` (una base de pruebas: escribe en la empresa `demo`) y
acepta `--trabajos`, `--por-trabajo` y `--workers`.

**Anonimizar** (`scripts/anonimizar.ts`): reemplaza nombres, cédulas/NIT,
correos, cuentas y referencias por valores sintéticos **estables** (con la
misma `--clave`, el mismo valor da el mismo reemplazo en todos los archivos del
comercio, así siguen cruzando) y conserva el formato exacto: líneas, columnas,
separadores y longitudes de ancho fijo. Opciones: `--plantilla id`,
`--clave secreto`, `--desplazar-dias N`, `--factor-montos F`, `--hoja nombre`.
La guía para conseguir archivos reales está en
[docs/GUIA_VALIDACION.md](docs/GUIA_VALIDACION.md).

**Panel.** Abra la pestaña *Cargar* y pulse una de las demos (datos
sintéticos de la tienda ficticia «La Ceiba», incluida una de pagos B2B contra
facturas DIAN), o arrastre sus propios archivos: CSV, TXT, Excel, MT940,
camt.053 o facturas XML. El perfil se edita con reglas y tarifas, y los
resultados muestran el motivo de cada movimiento sin cruzar.
Todo se procesa **en el navegador**: los archivos no salen del equipo a menos
que se pulse «Guardar en el servidor». Ese botón, y la pestaña *Servidor*
(ingreso, plantillas y perfiles de la empresa con sus versiones, conciliación
por la cola), solo aparecen si existe `VITE_API_URL`:

```bash
VITE_API_URL=http://localhost:3000 npm run dev:web
```

**API.** Variables (ver `apps/api/.env.example`):

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | PostgreSQL. Si falta, la API arranca en **modo memoria**: `/salud`, `/plantillas` y `POST /conciliaciones` funcionan sin guardar; el resto responde 503 |
| `PORT` | Puerto (3000 por defecto) |
| `CORS_ORIGEN` | `*` o lista de orígenes separados por coma (p. ej. la URL de Netlify) |
| `JWT_SECRETO` | Secreto para firmar los tokens (HS256). Si falta, se usa uno temporal y los tokens se invalidan al reiniciar (en Vercel se deriva uno estable de `DATABASE_URL`, pero conviene definirlo) |
| `JWT_DURACION_S` | Vida de un token en segundos (8 horas por defecto) |
| `CONFIAR_PROXY` | `1` detrás de un proxy propio (Render): la IP del límite de ingresos sale de `X-Forwarded-For` |
| `TRABAJO_MAX_INTENTOS` | Intentos de cada trabajo de la cola antes de quedar `fallido` (3) |
| `WORKER_CONCURRENCIA`, `WORKER_INTERVALO_MS`, `WORKER_APAGADO_MS` | Worker: trabajos a la vez, espera con la cola vacía, tope para terminar tras `SIGTERM` |
| `LOG_NIVEL` | `depurar`, `info`, `aviso`, `error` o `silencio` (registros JSON, una línea por evento) |
| `PG_MAX_CONEXIONES` | Conexiones del pool por proceso (10) |
| `DATABASE_URL_PRUEBA` | Solo pruebas: una base desechable para las pruebas de la API con PostgreSQL |

El esquema se aplica solo al arrancar la API o el worker, con **migraciones
numeradas** (`apps/api/src/migraciones/NNN_nombre.sql`): cada una corre una
vez, en su propia transacción, y queda anotada en la tabla `migraciones`. Una
base creada por la versión 0.1.0 se migra sin perder datos (quedan en la
empresa `demo`).

```bash
DATABASE_URL=postgres://usuario:clave@localhost:5432/conciliador npm run start:api
curl http://localhost:3000/salud          # {"ok":true,"baseDeDatos":true}

# Pruebas de la API contra una base real:
DATABASE_URL_PRUEBA=postgres://postgres@localhost:5432/postgres npm test
```

Rutas del MVP (siguen iguales; sin token operan en la empresa pública
`demo`): `GET /salud`, `GET /plantillas`, `POST /conciliaciones`,
`GET /conciliaciones`, `GET /conciliaciones/:id`,
`POST /conciliaciones/:id/coincidencias/:cid/confirmar` y `.../rechazar`.

**Multiempresa.** Con `Authorization: Bearer <token>` cada petición opera en la
empresa del usuario y con su rol (`lector` < `analista` < `admin`):

| Ruta | Rol | Qué hace |
|---|---|---|
| `POST /auth/registro` | público | Crea una empresa y su primer usuario `admin` |
| `POST /auth/ingreso` | público | `{ correo, contrasena }` → `{ token, usuario }` (con límite de intentos por IP) |
| `GET` / `POST /empresa/usuarios` | admin | Lista y crea usuarios de la empresa |
| `GET` / `POST /empresa/plantillas`, `GET /empresa/plantillas/:id/versiones` | lector / analista | Plantillas propias; cada cambio crea una versión, nunca se sobrescribe |
| `GET` / `POST /empresa/perfiles`, `GET /empresa/perfiles/:id/versiones` | lector / analista | Perfiles propios con historial; `POST /conciliaciones` acepta `perfilId` y `perfilVersion` |
| `POST /conciliaciones?asincrono=1` | analista | Encola y responde **202** con `trabajoId`; el worker concilia y guarda |
| `GET /trabajos/:id` | lector | Estado del trabajo: `pendiente`, `procesando`, `hecho` (con `conciliacionId`) o `fallido` (con el error) |
| `GET /metricas` | lector | Peticiones por ruta, tiempos y estado de la cola de la empresa |

Los listados aceptan `?limite=&cursor=` (paginación por cursor; la página
siguiente llega en la cabecera `X-Cursor-Siguiente`). Detalles en
[docs/CONTRATOS.md](docs/CONTRATOS.md) §9, §12 y §13.

```bash
# Registro, ingreso y conciliación asíncrona (datos sintéticos)
curl -X POST localhost:3000/auth/registro -H 'Content-Type: application/json' \
  -d '{"empresa":"Tienda Ejemplo","nombre":"Ana","correo":"ana@ejemplo.test","contrasena":"una-clave-larga-123"}'
TOKEN=$(curl -s -X POST localhost:3000/auth/ingreso -H 'Content-Type: application/json' \
  -d '{"correo":"ana@ejemplo.test","contrasena":"una-clave-larga-123"}' | node -p 'JSON.parse(require("fs").readFileSync(0)).token')
curl -X POST 'localhost:3000/conciliaciones?asincrono=1' -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d @cuerpo.json      # { banco: {nombre, texto}, ventas: {...} }
curl localhost:3000/trabajos/<trabajoId> -H "Authorization: Bearer $TOKEN"
```

Despliegue en producción en **Vercel + Neon** (panel, API y base en un solo proyecto):
[docs/DESPLIEGUE_VERCEL.md](docs/DESPLIEGUE_VERCEL.md). En Vercel no hay worker permanente: cada
consulta a `GET /trabajos/:id` procesa antes un trabajo pendiente, así la cola avanza mientras el
panel espera. Alternativa con Render (API + worker) y Netlify: [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md).

```bash
npm run build:vercel              # arma .vercel/output (panel + función /api + migraciones)
DATABASE_URL=... npm run migrar   # aplica las migraciones (también corren solas al arrancar)
```

## Agregar un banco nuevo (sin programar)

Un banco nuevo se agrega con un archivo JSON y sin tocar código. Ejemplo para
un extracto **ficticio** que se ve así:

```
Fecha Mov|Concepto|Documento|Credito|Debito
2026-10-01|SALDO INICIAL|||
2026-10-01|ABONO PSE REF:PED-2026-0001|884512|89500.00|
2026-10-02|PAGO PROVEEDOR|884513||-120000.00
2026-10-02|TRANSFERENCIA REF PED-2026-0002|884514|1250000.50|
```

`packages/plantillas/formatos/banco-ejemplo-csv.json`:

```json
{
  "id": "banco-ejemplo-csv",
  "nombre": "Banco Ejemplo: movimientos CSV",
  "version": 1,
  "lado": "banco",
  "descripcion": "Extracto ficticio separado por '|', fechas aaaa-mm-dd y montos con punto decimal. Los débitos (Credito vacío) se omiten.",
  "fuente": "Formato inventado para la documentación.",
  "tipo": "delimitado",
  "codificacion": "latin1",
  "separador": "|",
  "separadorDecimal": ".",
  "formatoFecha": "yyyy-MM-dd",
  "filasEncabezado": 1,
  "omitirSi": [
    { "campo": "Concepto", "regex": "^(SALDO|TOTAL)" },
    { "campo": "Credito", "regex": "^\\s*$" }
  ],
  "soloEntradas": true,
  "detectar": { "encabezados": ["Fecha Mov", "Concepto", "Documento", "Credito", "Debito"] },
  "columnas": {
    "fecha": "Fecha Mov",
    "descripcion": "Concepto",
    "referencia": { "de": "Concepto", "regex": "REF[: ]*(\\S+)" },
    "monto": "Credito"
  }
}
```

Con este archivo de ejemplo salen dos movimientos: `PED20260001` por $89.500 y
`PED20260002` por $1.250.000,50. Para sumarla a las incluidas:

1. Guarde el JSON en `packages/plantillas/formatos/`.
2. Impórtelo en `packages/plantillas/index.ts` y agréguelo a `PLANTILLAS`.
3. Si quiere, agregue un archivo sintético en `muestras/` con su prueba
   (la guía completa está en [CONTRIBUTING.md](CONTRIBUTING.md)).
4. `npm test`. `validarPlantilla` rechaza la plantilla con una lista de errores
   en español si algo está mal.
   Las regex (`omitirSi`, `regex` de columnas y reglas del perfil) tienen límites contra
   ReDoS: hasta 200 caracteres, sin cuantificadores anidados como `(a+)+`, sin `(a|b)+`,
   sin `\1`, a lo sumo dos `*`/`+`, y se aplican a los primeros 256 caracteres del campo.

Para ancho fijo (`"tipo": "anchoFijo"`) cada columna usa
`{ "inicio": 51, "longitud": 14, "decimalesImplicitos": 2 }`. Vea
`formatos/asobancaria-2001.json`. Una columna que no siempre viene se marca
`{ "de": "REFERENCIA PAGO", "opcional": true }`. Todas las opciones están en
[docs/CONTRATOS.md](docs/CONTRATOS.md) §3 y §9.

Si un formato ya publicado cambia, no edite la plantilla vieja: suba `version`.
Cada movimiento guarda `plantillaVersion`, así se sabe con qué mapeo se leyó.

Sin tocar el repositorio, la pestaña **Plantillas** del panel ofrece un
asistente que arma la plantilla desde un archivo de muestra, y también permite
importar un JSON. Sin sesión esas plantillas viven solo en ese navegador, y
«Guardar en el servidor» se desactiva cuando una de ellas está en uso (la demo
pública solo conoce las incluidas). Con sesión, la pestaña *Servidor* las sube
como plantillas de la empresa, con historial de versiones, y la API las usa al
conciliar.

## Usar el núcleo como librería

Los cuatro paquetes están listos para npm (versión 0.2.0; falta solo el
`npm publish` con la cuenta del autor, ver fase 14 del plan):

```bash
npm install @conciliador/core @conciliador/plantillas   # + @conciliador/excel o @conciliador/dian si los necesita
```

| Paquete | Qué trae | Dependencias |
|---|---|---|
| `@conciliador/core` | Estructuras, plantillas, lectores MT940/camt.053, cruce, reglas, tarifas, sesión, parser XML | ninguna |
| `@conciliador/plantillas` | Plantillas JSON incluidas y muestras sintéticas | `core` |
| `@conciliador/excel` | `leerExcel(datos, { hoja? })` → `{ hojas, texto }` (CSV con `;`) | `xlsx` (SheetJS) |
| `@conciliador/dian` | `leerFacturaUBL`, `leerFacturas` (UBL 2.1) | `core` |

`npm run build:lib` compila los cuatro a `dist/` (JS + `.d.ts`) y los `exports`
publican `dist/`. Para probar el paquete sin publicarlo:
`npm pack -w packages/core` y `npm install ./conciliador-core-0.2.0.tgz` en
un proyecto limpio. Ejemplo desde el código fuente del monorepo:

```ts
import { readFileSync } from 'node:fs';
import { RegistroPlantillas, procesarArchivos, conciliar, SesionRevision } from '@conciliador/core';
import { PLANTILLAS } from '@conciliador/plantillas';

const registro = new RegistroPlantillas();
for (const p of PLANTILLAS) registro.registrar(p);
const leer = (ruta: string) => ({ nombre: ruta, texto: readFileSync(ruta, 'utf8') });
const [banco, ventas] = procesarArchivos([leer('extracto-banco.csv'), leer('ventas-wompi.csv')], registro);
const resultado = conciliar(banco.movimientos, ventas.movimientos); // perfil opcional
for (const c of resultado.coincidencias) console.log(c.id, c.tipo, c.estado, c.explicacion);
new SesionRevision(resultado).confirmar('c1');                     // revisión con deshacer/rehacer
```

Con las muestras de `packages/plantillas/muestras/` imprime 13 coincidencias:
4 exactas, 6 con tolerancia y 3 agrupadas. `resultado.motivos` explica los
movimientos que quedaron libres.

Facturas DIAN contra pagos del banco:

```ts
import { leerFacturas } from '@conciliador/dian';
const { movimientos: facturas, errores } = leerFacturas([xml1, xml2]); // lado 'ventas', referencia = número
const r = conciliar(pagosDelBanco, facturas, { ...PERFIL_POR_DEFECTO, ventanaDias: 45 });
```

## Estructura de carpetas

```
conciliador/
├── packages/
│   ├── core/                    motor puro: sin E/S ni dependencias
│   │   ├── src/
│   │   │   ├── modelo.ts        Movimiento, centavos, fechas, formato COP
│   │   │   ├── estructuras/     Cola, Pila, ArbolAVL, Trie, MinHeap/TopK, GrafoBipartito
│   │   │   ├── plantillas/      tipos, validar, csv, leer, registro (detección), lectores,
│   │   │   │                    mt940, camt053, xml (parser propio con namespaces)
│   │   │   ├── ingesta.ts       procesarArchivos (Cola)
│   │   │   ├── cruce/           perfil, puntaje, pases, hungaro, reglas, tarifas, motivos, conciliar
│   │   │   ├── regexSegura.ts   revisión de regex de usuario contra ReDoS
│   │   │   └── sesion.ts        SesionRevision (dos Pilas + bitácora)
│   │   └── test/                pruebas con node:test
│   ├── plantillas/              formatos/*.json, muestras sintéticas, ESCENARIO.md
│   ├── excel/                   leerExcel (SheetJS) -> CSV para las plantillas delimitadas
│   └── dian/                    facturas electrónicas UBL 2.1, muestras sintéticas
├── apps/
│   ├── web/                     panel React 18 + Vite
│   └── api/                     node:http + pg: auth, empresas, migraciones/, trabajos (cola),
│                                worker.ts, vercel.ts (entrada de Vercel), métricas, pruebas
├── scripts/                     medir, carga, anonimizar, compilar-lib, construir-vercel
├── docs/                        PLAN, CONTRATOS, DOCUMENTO_FINAL, DESPLIEGUE_VERCEL, DESPLIEGUE, GUIA_VALIDACION
├── .github/workflows/ci.yml     tipos, pruebas con PostgreSQL, build:lib y build del panel
├── vercel.json                  despliegue principal (Vercel + Neon)
├── render.yaml · netlify.toml   despliegue alternativo (API + worker, panel)
├── CHANGELOG.md · CONTRIBUTING.md
└── LICENSE
```

## Integrantes

Proyecto individual.

| Nombre | Código | Rol |
|---|---|---|
| Joan Mateo Cardona Lorza | _(por completar)_ | Desarrollo completo |

## Enlaces

| Recurso | URL |
|---|---|
| Panel (Vercel) | <URL_VERCEL> |
| API | <URL_VERCEL>/api |
| Salud de la API | <URL_VERCEL>/api/salud |
| Repositorio | <URL_REPOSITORIO> |
| Paquetes en npm | <URL_NPM> |
| Documento final | [docs/DOCUMENTO_FINAL.md](docs/DOCUMENTO_FINAL.md) |
| Plan y estado de las fases | [docs/PLAN.md](docs/PLAN.md) |
| Despliegue | [docs/DESPLIEGUE_VERCEL.md](docs/DESPLIEGUE_VERCEL.md) |
| Cambios | [CHANGELOG.md](CHANGELOG.md) |
| Cómo aportar una plantilla | [CONTRIBUTING.md](CONTRIBUTING.md) |

## Licencia

[MIT](LICENSE) © 2026 Joan Mateo Cardona Lorza.

Los datos de muestra son sintéticos e inventados. Las plantillas se basan en
documentación pública y no en archivos reales de ninguna entidad.
