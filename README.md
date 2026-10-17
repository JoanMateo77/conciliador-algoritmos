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
`1.234,56`, archivos de recaudo Asobancaria de ancho fijo en latin1.

El resultado es que alguien de contabilidad pasa horas cruzando a mano dos
hojas de cálculo. El conciliador hace ese cruce y deja a la persona solo los
casos dudosos, con una explicación en español de cada diferencia
(«Faltan $24.198,20 (4,65 %) ≈ comisión 3,15 % + ReteFuente 1,5 %»).

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
3. **Cruce.** Tres pases; cada uno trabaja solo con lo que el anterior dejó
   libre. Las reglas (tolerancias, ventana de días, retenciones) vienen de un
   **perfil** por empresa, que también es JSON.
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

La justificación y la complejidad de cada una están en
[docs/DOCUMENTO_FINAL.md](docs/DOCUMENTO_FINAL.md).

## Cómo correrlo

Requisitos: **Node 24** (ejecuta TypeScript sin compilar; desde 22.18 también
funciona) y npm. PostgreSQL es opcional.

```bash
npm install            # instala los workspaces
npm test               # núcleo, plantillas y API (las de PostgreSQL se saltan sin base)
npm run dev:web        # panel en http://localhost:5173
npm run start:api      # API en http://localhost:3000
npm run build:web      # compila el panel a apps/web/dist
node scripts/medir.ts  # mide el tiempo de conciliar 10.000 y 100.000 movimientos sintéticos
```

**Panel.** Abra la pestaña *Cargar* y pulse una de las demos (datos
sintéticos de la tienda ficticia «La Ceiba»), o arrastre sus propios archivos.
Todo se procesa **en el navegador**: los archivos no salen del equipo a menos
que se pulse «Guardar en el servidor». Ese botón solo aparece si existe
`VITE_API_URL`:

```bash
VITE_API_URL=http://localhost:3000 npm run dev:web
```

**API.** Variables (ver `apps/api/.env.example`):

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | PostgreSQL. Si falta, la API arranca en **modo memoria**: `/salud`, `/plantillas` y `POST /conciliaciones` funcionan sin guardar; el resto responde 503 |
| `PORT` | Puerto (3000 por defecto) |
| `CORS_ORIGEN` | `*` o lista de orígenes separados por coma (p. ej. la URL de Netlify) |
| `DATABASE_URL_PRUEBA` | Solo pruebas: una base desechable para las pruebas de la API con PostgreSQL |

El esquema (`apps/api/src/esquema.sql`) se aplica solo al arrancar.

```bash
DATABASE_URL=postgres://usuario:clave@localhost:5432/conciliador npm run start:api
curl http://localhost:3000/salud          # {"ok":true,"baseDeDatos":true}

# Pruebas de la API contra una base real:
DATABASE_URL_PRUEBA=postgres://postgres@localhost:5432/postgres npm test
```

Rutas: `GET /salud`, `GET /plantillas`, `POST /conciliaciones`,
`GET /conciliaciones`, `GET /conciliaciones/:id`,
`POST /conciliaciones/:id/coincidencias/:cid/confirmar` y
`.../rechazar`. Los detalles están en [docs/CONTRATOS.md](docs/CONTRATOS.md) §9.

Despliegue en Neon, Render y Netlify: [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md).

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
3. Si quiere, agregue un archivo sintético en `muestras/` con su prueba.
4. `npm test`. `validarPlantilla` rechaza la plantilla con una lista de errores
   en español si algo está mal.

Para ancho fijo (`"tipo": "anchoFijo"`) cada columna usa
`{ "inicio": 51, "longitud": 14, "decimalesImplicitos": 2 }`. Vea
`formatos/asobancaria-2001.json`. Todas las opciones están en
[docs/CONTRATOS.md](docs/CONTRATOS.md) §3.

Sin tocar el repositorio, la pestaña **Plantillas** del panel ofrece un
asistente que arma la plantilla desde un archivo de muestra, y también permite
importar un JSON. Esas plantillas se guardan solo en ese navegador. Por eso
«Guardar en el servidor» se desactiva cuando una de ellas está en uso: la API
solo conoce las plantillas incluidas.

## Usar el núcleo como librería

Dentro del monorepo (aún no está publicado en npm; ver fase 14 del plan):

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
4 exactas, 6 con tolerancia y 3 agrupadas.

## Estructura de carpetas

```
conciliador/
├── packages/
│   ├── core/                    motor puro: sin E/S ni dependencias
│   │   ├── src/
│   │   │   ├── modelo.ts        Movimiento, centavos, fechas, formato COP
│   │   │   ├── estructuras/     Cola, Pila, ArbolAVL, Trie, MinHeap/TopK, GrafoBipartito
│   │   │   ├── plantillas/      tipos, validar, csv (parser propio), leer, registro (detección)
│   │   │   ├── ingesta.ts       procesarArchivos (Cola)
│   │   │   ├── cruce/           perfil, puntaje, pases, conciliar
│   │   │   └── sesion.ts        SesionRevision (dos Pilas + bitácora)
│   │   └── test/                pruebas con node:test
│   └── plantillas/              formatos/*.json, muestras sintéticas, ESCENARIO.md
├── apps/
│   ├── web/                     panel React 18 + Vite (Netlify)
│   └── api/                     node:http + pg (Render + Neon), esquema.sql, pruebas
├── scripts/medir.ts             mediciones de rendimiento
├── docs/                        PLAN, CONTRATOS, DOCUMENTO_FINAL, DESPLIEGUE
├── .github/workflows/ci.yml     pruebas con PostgreSQL + build del panel
├── render.yaml · netlify.toml   despliegue
└── LICENSE
```

## Integrantes

| Nombre | Código | Rol |
|---|---|---|
| Joan Mateo Cardona Lorza | _(por completar)_ | Desarrollo |
| _(por completar)_ | _(por completar)_ | _(por completar)_ |
| _(por completar)_ | _(por completar)_ | _(por completar)_ |

## Enlaces

| Recurso | URL |
|---|---|
| Panel (Netlify) | <URL_NETLIFY> |
| API (Render) | <URL_RENDER> |
| Salud de la API | <URL_RENDER>/salud |
| Documento final | [docs/DOCUMENTO_FINAL.md](docs/DOCUMENTO_FINAL.md) |
| Despliegue | [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md) |

## Licencia

[MIT](LICENSE) © 2026 Joan Mateo Cardona Lorza.

Los datos de muestra son sintéticos e inventados. Las plantillas se basan en
documentación pública y no en archivos reales de ninguna entidad.
