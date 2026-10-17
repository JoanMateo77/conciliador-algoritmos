# Plan de desarrollo: Conciliador

Librería modular de conciliación de pagos para Colombia, adaptable a cada
empresa mediante plantillas (formatos de archivo) y perfiles (reglas de cruce).

## 1. ¿Se puede sacar completo para mañana?

No. La versión completa (lectores Excel, MT940/camt.053, cruce N:M general,
DIAN, versionado de plantillas por empresa con usuarios, npm) son 6 a 8
semanas. Lo que sí se puede entregar mañana es un **MVP funcional** que
cumple toda la rúbrica y deja la arquitectura lista para crecer sin rehacer
nada.

| Pieza | MVP (mañana) | Versión completa (después) |
|---|---|---|
| Formatos | CSV/delimitado y ancho fijo por plantilla JSON | Excel, MT940, camt.053, JSON de API |
| Plantillas | 5 incluidas + asistente en el panel | Biblioteca compartida, versiones por empresa |
| Cruce | Exacto, 1:1 con tolerancia, N:1 por suma de subconjuntos | N:M general, aprendizaje de pesos |
| Perfiles | Tolerancias, ventana de días, retenciones conocidas | Reglas ordenadas AND/OR, tarifas por municipio y vigencia |
| Panel | Carga de archivos, resultados, revisión, deshacer, grafo | Usuarios, historial, reportes |
| Backend | API Node + PostgreSQL, confirmar match en transacción | Multiempresa, autenticación, colas de trabajo |

## 2. Arquitectura (pensada para escalar)

```
packages/core        motor puro: sin E/S, sin dependencias, 100 % probado
  estructuras/       Cola, Pila, ÁrbolAVL, Trie, MinHeap, GrafoBipartito (propias)
  modelo             Movimiento estándar (montos en centavos enteros)
  plantillas/        validar, leer (delimitado, ancho fijo), detectar
  cruce/             pases de cruce, puntaje, resolución de conflictos
  sesion             revisión humana con deshacer/rehacer y bitácora
packages/plantillas  formatos en JSON (un archivo por banco o pasarela)
apps/web             panel React + Vite (Netlify), procesa en el navegador
apps/api             API Node + PostgreSQL (Render + Neon)
docs/                plan, documento final, despliegue
```

Reglas que garantizan estabilidad y escala:

1. **El núcleo no conoce bancos.** Solo recibe movimientos estándar. Un
   banco nuevo es un JSON nuevo, no código nuevo.
2. **Dinero en centavos enteros.** Nunca decimales; se valida con
   `Number.isSafeInteger`.
3. **Todo lo variable es dato.** Formatos en plantillas, reglas y tarifas en
   perfiles. Las plantillas llevan `version`.
4. **Pases de barato a caro.** Nada peor que O(n log n) sobre el total; lo
   exponencial (suma de subconjuntos) solo en ventanas acotadas.
5. **Nada se borra.** Las decisiones quedan en una bitácora; deshacer es otro
   evento.
6. **Puntos de extensión.** Si un formato no cabe en una plantilla, se
   registra un lector propio con la misma interfaz.
7. **Pruebas con vectores.** Cada plantilla trae un archivo de muestra y el
   resultado esperado.

## 3. Estructuras de datos (rúbrica)

| Categoría | Estructura | Dónde se usa |
|---|---|---|
| Lineal | Cola | Archivos en espera de procesar (orden de llegada) |
| Lineal | Pila (x2) | Deshacer y rehacer decisiones de revisión |
| Árbol | Árbol AVL | Buscar movimientos por rango de monto ± tolerancia |
| Árbol | Trie | Detectar la plantilla por encabezados y buscar referencias por prefijo |
| Árbol | MinHeap | Quedarse con los K mejores candidatos de cada movimiento |
| Grafo | Grafo bipartito | Banco ↔ ventas candidatas; componentes para resolver conflictos |

## 4. Fases

### MVP (entrega) — hecho, versión 0.1.0

| Fase | Contenido | Resultado | Estado |
|---|---|---|---|
| 0. Base | Monorepo, modelo de datos, CI con pruebas | Repo que corre `npm test` | Hecha |
| 1. Estructuras | Las 6 estructuras propias con pruebas | Rúbrica de estructuras cubierta | Hecha |
| 2. Plantillas | Validador, lector delimitado y de ancho fijo, transformaciones, detección con trie, 5 plantillas | Cualquier archivo soportado → movimientos estándar | Hecha |
| 3. Cruce | Exacto (hash), tolerancia (AVL), N:1 (subconjuntos), puntaje (heap), conflictos (grafo) | Coincidencias + excepciones con motivo | Hecha |
| 4. Perfiles | Tolerancia asimétrica, ventana de días, retenciones conocidas | Cada empresa ajusta el cruce sin código | Hecha |
| 5. Panel | Carga, detección, resultados, revisión con deshacer, asistente de plantillas, vista de grafo | Netlify | Hecha |
| 6. API | Sesiones y confirmación de matches en transacción PostgreSQL | Render + Neon | Hecha |
| 7. Cierre | README, documento final, despliegue | Entrega | Hecha (115 pruebas) |

### Después de la entrega: escalado semana a semana

Cada fase termina con algo que funciona, con pruebas, y se integra a `main`
con una rama propia (`fase-08-formatos`, `fase-09-reglas`...) mezclada con
`--no-ff`, igual que en los retos del curso.

| Semana | Fase | Contenido | Criterio de terminado |
|---|---|---|---|
| 1 (19–25 oct) | 8. Validación con usuarios | 5 a 10 entrevistas cortas; conseguir 3 a 5 archivos reales anonimizados (extracto Bancolombia o Davivienda, Asobancaria, Wompi o Mercado Pago); convertirlos en plantillas y vectores de prueba | Cada archivo real se lee sin errores y tiene su prueba |
| 2 (26 oct–1 nov) | 9. Más formatos | Excel (.xlsx) con SheetJS en el adaptador, sin tocar el núcleo; MT940 y camt.053 como lectores registrados; versión de plantilla en cada movimiento | Mismo cruce con CSV o Excel del mismo extracto |
| 3 (2–8 nov) | 10. Reglas avanzadas | Reglas ordenadas con condiciones AND/OR (igual, contiene, regex, rango); tarifas de retención con vigencia por fecha, medio de pago y municipio; GMF (4×1000) clasificado como gasto | Un perfil puede expresar las reglas de Xero/Odoo sin código |
| 4 (9–15 nov) | 11. Cruce N:M y explicabilidad | Clusters N:M en el grafo con asignación óptima (Húngaro) por componente; desempates documentados; reporte "por qué no cruzó" por movimiento | Pruebas de propiedades: nunca empeora frente al greedy |
| 5 (16–22 nov) | 12. Multiempresa | Autenticación (JWT), empresas, usuarios y roles; plantillas y perfiles por empresa con historial de versiones; auditoría por usuario | Dos empresas con formatos distintos en la misma instancia |
| 6 (23–29 nov) | 13. Escala y estabilidad | Ingesta por lotes con cola persistente (tabla de trabajos en PostgreSQL), procesamiento en un worker aparte, paginación, índices; pruebas de carga con 10⁶ movimientos; métricas y registros estructurados | 10⁶ movimientos conciliados sin bloquear la API |
| 7 (30 nov–6 dic) | 14. Librería pública | Compilación a JS + tipos, publicación `0.x` en npm, README bilingüe, documentación de la API, guía para aportar plantillas, versionado semántico y changelog | `npm install` y ejemplo de 10 líneas funcionan en un proyecto limpio |
| 8 (7–13 dic) | 15. Colombia | Campo de Referencia de Pago de Bre-B (si el BanRep la aprueba); cruce pago ↔ factura con XML de la DIAN (CUFE); exportes para contabilidad | Ciclo pasarela → banco → factura cerrado en la demo |

### Estado de las fases de escalado (17 de octubre de 2026, versión 0.2.0)

Las fases 9 a 15 se construyeron antes del calendario semanal, en paralelo y
con los contratos de [CONTRATOS.md](CONTRATOS.md) («Fases 9 a 15»). Quedan
274 pruebas en verde (246 sin PostgreSQL).

| Fase | Estado | Qué hay | Qué falta |
|---|---|---|---|
| 8. Validación con usuarios | **Parcial** | `scripts/anonimizar.ts` (reemplazos estables, formato exacto, también Excel) con pruebas; guía de entrevistas y de pedido de archivos en [GUIA_VALIDACION.md](GUIA_VALIDACION.md) | Las 5 a 10 entrevistas y los 3 a 5 archivos reales anonimizados convertidos en plantillas y vectores de prueba. Es lo único que no se puede hacer sin usuarios |
| 9. Más formatos | **Hecha** | `@conciliador/excel` (SheetJS, sin tocar el núcleo), lectores registrables MT940 y camt.053 con plantillas y muestras, `plantillaVersion` en cada movimiento, columnas opcionales | — |
| 10. Reglas avanzadas | **Hecha** | Reglas AND/OR ordenadas (igual, contiene, empieza por, regex segura, rangos), tarifas con vigencia, medio de pago y municipio, GMF clasificado como gasto, editores en el panel | — |
| 11. Cruce N:M y explicabilidad | **Hecha** | Húngaro propio por componente, clusters `agrupadaNM`, `motivos` por movimiento; prueba de propiedad «nunca peor que el greedy»; `cruceOptimo: false` reproduce 0.1.0 | — |
| 12. Multiempresa | **Hecha** | scrypt + JWT HS256 propios, roles, `empresa_id` en todo con llaves compuestas, plantillas y perfiles con historial inmutable, auditoría por usuario, pestaña *Servidor* en el panel | — |
| 13. Escala y estabilidad | **Hecha** | Migraciones, cola `trabajos` con `FOR UPDATE SKIP LOCKED`, worker aparte con reintentos y apagado limpio, paginación por cursor, índices, registros JSON, `/metricas`, `scripts/carga.ts`: 10⁶ movimientos en ~10 s y `/salud` en 1 ms durante la carga | Mejora pendiente (no es criterio de la fase): índice día+monto en el pase 2 |
| 14. Librería pública | **Lista para publicar** | `npm run build:lib` (JS + `.d.ts`), `exports` con `types`, metadatos, `files`, README bilingüe de `core`, `CHANGELOG.md`, `CONTRIBUTING.md`, versión 0.2.0 | `npm publish` con la cuenta del autor (y la URL real del repositorio en los `package.json`) |
| 15. Colombia | **Parcial** | `referenciaPago` de Bre-B como llave del pase exacto; `@conciliador/dian` lee facturas UBL 2.1 (CUFE, NIT, IVA, retenciones); demo pagos B2B ↔ facturas en el panel | Exportes para contabilidad; ajustar Bre-B a la especificación final del BanRep cuando se publique |

Principios para escalar sin rehacer:

- El núcleo sigue puro. Lo nuevo (Excel, autenticación, workers) vive en
  adaptadores, en la API o en el panel.
- Todo cambio de formato o regla es un dato con versión, nunca un `if` por
  banco.
- Cada fase agrega pruebas antes de cambiar código existente; CI en verde
  para mezclar.
- Medir antes de optimizar: `scripts/medir.ts` se corre en cada fase de
  escala y sus números van al documento final.

## 5. Riesgos

- **Empleador:** nada de datos, código ni formatos internos de la empresa
  donde trabaja el autor. Solo fuentes públicas y datos sintéticos.
- **Datos personales:** el panel procesa en el navegador; la API solo guarda
  datos de ejemplo.
- **Formatos bancarios no públicos:** por eso existe el asistente de
  plantillas.
- **Alcance:** lo que no está en la tabla del MVP no entra mañana.
