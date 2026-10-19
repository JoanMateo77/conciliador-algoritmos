# Registro de cambios

Todos los cambios importantes de los paquetes `@conciliador/*` quedan aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto usa [versionado semántico](https://semver.org/lang/es/). Mientras
la versión sea `0.x`, un cambio que rompa compatibilidad sube el número del
medio (0.2 → 0.3) y una corrección sube el último.

## [Sin publicar]

### Agregado

- Despliegue en Vercel con base Neon: `npm run build:vercel` arma la salida
  (panel estático + una función para `/api/*` + migraciones) con el Build
  Output API, y `npm run migrar` aplica las migraciones a mano. En Vercel la
  cola de trabajos avanza con cada `GET /trabajos/:id`, porque no hay
  procesos permanentes. Si falta `JWT_SECRETO`, la función deriva uno estable
  de `DATABASE_URL` para que todas las instancias acepten los mismos tokens.
  Guía: `docs/DESPLIEGUE_VERCEL.md`.

- Panel rediseñado tras una revisión de UX con un estilo sobrio de herramienta
  financiera: barra superior blanca, pestañas subrayadas (en móvil se desplazan
  de lado), paleta neutra con el acento solo en la acción principal, íconos SVG
  en vez de emojis y métricas planas con un punto de estado. Además: barra fija con «Conciliar» que dice qué falta cuando está
  deshabilitado, «Conciliar con este perfil» desde Perfil, montos del resumen
  en su propia fila sin partirse, errores de lectura en un recuadro visible,
  descripciones de plantillas con «Ver más», atajos con `<kbd>` y tablas con
  filas alternas. El detalle de una coincidencia pasa de `<aside>` a
  `<section>` (axe: landmark dentro de `main`).

### Seguridad

- Regex de usuario (reglas del perfil y plantillas) protegidas contra ReDoS con
  `revisarRegex` (`packages/core/src/regexSegura.ts`): a lo sumo 200 caracteres, sin
  cuantificadores anidados (`(a+)+`), sin alternancias repetidas (`(a|b)+`), sin
  referencias hacia atrás y con un costo de retroceso acotado (como mucho dos `*`/`+`).
  Al ejecutarlas, el texto se recorta a 256 caracteres y un presupuesto de tiempo
  (`crearProbador`, 2 s + 20 µs por prueba) corta con `ErrorRegexCostosa`. Perfiles: a lo
  sumo 200 reglas y 20 condiciones por regla.
- API: sin token (demo) no se aceptan reglas con `op: "regex"` (403). Con token, si una
  regex agota su tiempo la conciliación responde 422 y en la cola el trabajo falla sin
  reintentos.
- Panel: Vite 6.0.7 → 6.4.3 (esbuild 0.25), corrige GHSA-67mh-4wv8-2f99 del
  servidor de desarrollo. Solo afecta `apps/web`; los paquetes publicados no dependen de Vite.
- Un solo parser XML: `@conciliador/dian` usa el de `@conciliador/core`
  (`analizarXML` y navegación por namespace, ahora exportados por el núcleo). El
  lector camt.053 pasa a **rechazar `DOCTYPE`** y entidades desconocidas, igual
  que el de facturas DIAN (antes los saltaba o los dejaba como texto).

### Cambiado

- La plantilla `asobancaria-2001` sube a la **versión 2** y lee archivos reales
  sin modificarlos: la fecha de recaudo sale del registro 01 (posiciones 13-20),
  como dice el estándar, en vez de esperarla repetida en la zona reservada del
  detalle. Para eso las columnas de ancho fijo aceptan `registro`, que toma el
  campo de la última línea de ese tipo. El anonimizador desplaza esa fecha en
  el encabezado.
- La plantilla `banco-csv-generico` sube a la **versión 2**: su mapeo ganó la
  columna opcional `REFERENCIA PAGO` (Bre-B). Los movimientos leídos con ella
  llevan `plantillaVersion: 2`.

### Corregido

- `maxGrupo: 1` (o 0) vuelve a significar «no agrupar»: el pase N:M ya no arma
  clusters de varios abonos contra una venta con ese valor, igual que el pase 3.

## [0.2.0] - 2026-10-17

Fases 8 a 15 del plan. Todo lo nuevo es opcional: un perfil, una plantilla o
una llamada de 0.1.0 sigue siendo válida sin cambios. El resultado del cruce sí
puede mejorar con el cruce óptimo, que viene encendido (ver "Cambiado"); con
`Perfil.cruceOptimo: false` se obtiene exactamente el resultado de 0.1.0.

### Agregado

- **Librería pública (fase 14).** `npm run build:lib` compila `core`,
  `plantillas`, `excel` y `dian` a `dist/` (JS + `.d.ts`). Los `exports`
  publican `dist/`; en el monorepo se sigue usando el TypeScript sin compilar
  gracias a la condición `conciliador-src` (ver `.npmrc`). Metadatos para npm,
  `files`, `sideEffects: false` y `engines`.
- **Formatos (fases 8 y 9).** Lectores registrables (`registrarLector`,
  `LectorFormato`) y lectores MT940 y camt.053 con sus plantillas
  (`mt940-generico`, `camt053-generico`). Cada movimiento lleva
  `plantillaVersion`. Plantillas con `hoja` para Excel y columnas `opcional`.
- **`@conciliador/excel`.** `leerExcel` convierte una hoja de `.xlsx`/`.xls`
  en CSV con `;`, así la misma plantilla delimitada sirve para el CSV y el
  Excel del mismo banco.
- **`scripts/anonimizar.ts`.** Reemplazo estable y con formato exacto de
  nombres, documentos, correos, cuentas y referencias para donar archivos
  reales como vectores de prueba.
- **Reglas y tarifas (fase 10).** Reglas ordenadas con condiciones AND/OR
  (igual, contiene, empieza por, regex, rangos de monto y fecha) que
  clasifican, exigen referencia o ajustan la tolerancia; tarifas con vigencia,
  medio de pago y municipio (ReteFuente, ReteICA, ReteIVA, comisión, GMF).
  `ResultadoConciliacion.clasificados`.
- **Cruce N:M y explicabilidad (fase 11).** Asignación óptima con el algoritmo
  Húngaro (propio, `cruce/hungaro.ts`) por componente del grafo, clusters
  `agrupadaNM` y `ResultadoConciliacion.motivos` con el porqué de cada
  movimiento sin cruzar. Se apaga con `Perfil.cruceOptimo: false`.
- **Multiempresa (fase 12, API).** Registro e ingreso con scrypt y JWT HS256,
  roles `admin`, `analista` y `lector`, plantillas y perfiles por empresa con
  historial de versiones y auditoría por usuario.
- **Escala (fase 13, API).** Migraciones numeradas, cola persistente en la
  tabla `trabajos` con `FOR UPDATE SKIP LOCKED`, worker aparte
  (`npm run worker -w apps/api`), `POST /conciliaciones?asincrono=1`,
  paginación por cursor, registros JSON, `GET /metricas` y
  `scripts/carga.ts`.
- **`@conciliador/dian` (fase 15).** `leerFacturaUBL` y `leerFacturas` leen
  facturas electrónicas UBL 2.1 (CUFE, NIT, IVA, retenciones, total a pagar)
  con un parser XML propio. Referencia de Pago de Bre-B (`referenciaPago`)
  como llave del pase exacto.
- `CONTRIBUTING.md` con la guía para aportar plantillas.

### Cambiado

- **Resultado del cruce con el perfil por defecto.** `cruceOptimo` viene en
  `true`, así que un perfil de 0.1.0 sin ese campo puede dar otro resultado:
  el pase 2 asigna con el Húngaro en vez del greedy, aparece el pase N:M
  (`agrupadaNM`) y en el pase 3, si la referencia de un abono nombra una
  venta, el grupo tiene que incluir esa venta (antes podía armarse con una
  suma casual de ventas ajenas; ahora el abono queda sin cruzar y `motivos`
  lo explica). Ejemplo: en el escenario de Tienda La Ceiba con tolerancia del
  4 %, 0.1.0 agrupaba B8 con tres ventas ajenas y ahora agrupa B10 con su
  lote. Con el perfil de la demo el resultado no cambia. Con
  `cruceOptimo: false` estas tres cosas y el cruce por referencia de pago Bre-B se apagan y el resultado es idéntico al
  de 0.1.0 (comprobado sobre todas las muestras con 49 perfiles).
- Versión 0.2.0 en todos los paquetes. `@conciliador/plantillas` y
  `@conciliador/dian` declaran `@conciliador/core` como dependencia.
- El esquema de la API pasó de `esquema.sql` a migraciones; los datos de una
  base de 0.1.0 quedan en la empresa `demo` y las rutas sin token siguen
  funcionando.
- La integración continua también compila la librería y revisa los tipos.

## [0.1.0] - 2026-10-17

MVP (fases 0 a 7).

### Agregado

- Modelo `Movimiento` con montos en centavos enteros, fechas ISO y
  referencias normalizadas.
- Estructuras propias: `Cola`, `Pila`, `ArbolAVL`, `Trie`, `MinHeap`/`TopK` y
  `GrafoBipartito`.
- Plantillas JSON (delimitado y ancho fijo) con validación, detección por
  encabezados con un Trie e ingesta en orden de llegada.
- Cruce por pases: exacto, con tolerancia y agrupado N:1, con perfiles por
  empresa (tolerancias, ventana de días, retenciones conocidas) y
  explicaciones en español.
- `SesionRevision` con confirmar, rechazar, emparejar a mano, deshacer,
  rehacer y bitácora.
- Cinco plantillas incluidas (banco CSV, Asobancaria 2001, Wompi, Mercado
  Pago, ventas CSV) con muestras sintéticas.
- Panel React + Vite y API `node:http` + PostgreSQL con transacciones.

[Sin publicar]: https://github.com/JoanMateo77/conciliador-algoritmos/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/JoanMateo77/conciliador-algoritmos/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/JoanMateo77/conciliador-algoritmos/releases/tag/v0.1.0
