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

### MVP (entrega)

| Fase | Contenido | Resultado |
|---|---|---|
| 0. Base | Monorepo, modelo de datos, CI con pruebas | Repo que corre `npm test` |
| 1. Estructuras | Las 6 estructuras propias con pruebas | Rúbrica de estructuras cubierta |
| 2. Plantillas | Validador, lector delimitado y de ancho fijo, transformaciones, detección con trie, 5 plantillas | Cualquier archivo soportado → movimientos estándar |
| 3. Cruce | Exacto (hash), tolerancia (AVL), N:1 (subconjuntos), puntaje (heap), conflictos (grafo) | Coincidencias + excepciones con motivo |
| 4. Perfiles | Tolerancia asimétrica, ventana de días, retenciones conocidas | Cada empresa ajusta el cruce sin código |
| 5. Panel | Carga, detección, resultados, revisión con deshacer, asistente de plantillas, vista de grafo | Netlify |
| 6. API | Sesiones y confirmación de matches en transacción PostgreSQL | Render + Neon |
| 7. Cierre | README, documento final, despliegue | Entrega |

### Después de la entrega

| Fase | Contenido |
|---|---|
| 8. Más formatos | Excel (SheetJS), MT940, camt.053, presets por banco con muestras reales |
| 9. Reglas avanzadas | Reglas ordenadas AND/OR, tarifas por municipio y vigencia, GMF |
| 10. Multiempresa | Autenticación, plantillas y perfiles por empresa con versiones |
| 11. Escala | Procesamiento por lotes en workers, colas persistentes, 10⁶ movimientos |
| 12. Comunidad | npm 0.x, README bilingüe, plantillas aportadas por usuarios |
| 13. Colombia | Referencia de pago Bre-B, cruce con facturas DIAN (CUFE) |

## 5. Riesgos

- **Empleador:** nada de datos, código ni formatos internos de la empresa
  donde trabaja el autor. Solo fuentes públicas y datos sintéticos.
- **Datos personales:** el panel procesa en el navegador; la API solo guarda
  datos de ejemplo.
- **Formatos bancarios no públicos:** por eso existe el asistente de
  plantillas.
- **Alcance:** lo que no está en la tabla del MVP no entra mañana.
