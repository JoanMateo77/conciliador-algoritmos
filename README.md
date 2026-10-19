# Conciliador de pagos

[![CI](https://github.com/JoanMateo77/conciliador-algoritmos/actions/workflows/ci.yml/badge.svg)](https://github.com/JoanMateo77/conciliador-algoritmos/actions/workflows/ci.yml)
[![Licencia MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)
[![Demo](https://img.shields.io/badge/demo-vercel-black.svg)](https://conciliador-algoritmos-web.vercel.app)

**Demo:** <https://conciliador-algoritmos-web.vercel.app> (botón «Usar datos de demo»).

Herramienta en TypeScript para conciliar el extracto bancario de un comercio
colombiano contra su reporte de ventas. Cruza los abonos con las ventas, explica
cada diferencia (comisiones, IVA, retenciones) y deja para revisión manual solo
los casos dudosos.

Se compone de una librería sin dependencias, un panel web que procesa los
archivos en el navegador y una API opcional con PostgreSQL para trabajo
multiempresa.

Proyecto final de Estructuras de Datos II, Universidad Autónoma de Occidente.

![Carga de archivos](docs/img/cargar.png)

| Perfil de cruce | Grafo bipartito |
|---|---|
| ![Perfil](docs/img/perfil.png) | ![Grafo](docs/img/grafo.png) |

## Contexto

Una venta de $520.000 pagada por PSE o tarjeta rara vez llega al banco completa
y el mismo día. La pasarela descuenta su comisión y el IVA de esa comisión,
puede aplicar ReteFuente o ReteICA, agrupa varias ventas en un solo abono y a
veces trunca la referencia. Además cada banco exporta en un formato distinto:
CSV con `;`, montos como `1.234,56`, Excel, archivos de recaudo Asobancaria de
ancho fijo, MT940 o camt.053.

En la práctica alguien cruza dos hojas de cálculo a mano. Este proyecto
automatiza ese cruce y, para lo que no puede resolver solo, dice por qué.

## Funcionalidades

- Lectura de CSV, TXT, Excel (`.xlsx`, `.xls`), Asobancaria 2001, MT940,
  camt.053 y facturas electrónicas DIAN (UBL 2.1).
- Detección automática del formato a partir de los encabezados del archivo.
- Cruce exacto, con tolerancia, agrupado (varias ventas en un abono) y N:M.
- Explicación de cada coincidencia y motivo de cada movimiento sin cruzar.
- Perfiles por empresa: tolerancias, ventana de días, reglas de clasificación
  y tarifas con vigencia y municipio.
- Revisión manual: confirmar, rechazar, emparejar, deshacer y rehacer.
- Asistente para crear la plantilla de un banco nuevo desde un archivo de
  muestra, sin programar.
- API con empresas, usuarios y roles, versiones de plantillas y perfiles, y
  una cola de trabajos para conciliaciones grandes.

## Arquitectura

```
                 ┌───────────────────────────────────────────────┐
                 │ packages/core  (sin dependencias, sin E/S)    │
 archivos ──►    │  plantillas ─► Movimiento ─► cruce ─► sesión  │
                 └───────────────────────────────────────────────┘
                     ▲               ▲                 ▲
     packages/plantillas      packages/excel     packages/dian
     (formatos JSON)          (SheetJS → CSV)    (facturas UBL)
                     │                                 │
          ┌──────────┴──────────┐           ┌──────────┴──────────┐
          │ apps/web            │  opcional │ apps/api            │
          │ React + Vite        │ ────────► │ node:http + pg      │
          │ todo en el navegador│           │ cola + worker       │
          └─────────────────────┘           └─────────────────────┘
```

El flujo dentro del núcleo:

1. **Ingesta.** Cada archivo entra a una cola y se lee con una plantilla JSON
   que describe separador, columnas, formato de fecha y decimales. El resultado
   es una lista de `Movimiento` con fecha ISO, monto en centavos y referencia
   normalizada.
2. **Reglas.** Las reglas del perfil sacan del cruce lo que no es un pago de
   ventas (por ejemplo el GMF o una consignación en efectivo).
3. **Cruce por pases.** Cada pase trabaja solo con lo que el anterior dejó
   libre: exacto, con tolerancia, agrupado N:1 y N:M.
4. **Revisión.** Lo que supera el umbral del perfil queda automático; el resto
   llega como sugerencia para que una persona lo confirme o lo rechace.

## Decisiones técnicas

**Montos en centavos enteros.** Ningún monto se guarda como decimal. Sumar
`0.1 + 0.2` en punto flotante no da `0.3`, y en una conciliación una diferencia
de un centavo cambia el resultado. Todos los parsers convierten a centavos al
leer y el formato COP solo se aplica al mostrar.

**Núcleo puro y sin dependencias.** `packages/core` no lee archivos ni hace
peticiones: recibe texto y devuelve objetos. Por eso el mismo código corre en
el navegador, en la API y en las pruebas sin adaptaciones. Las dependencias
externas (SheetJS para Excel) quedan en paquetes aparte que se cargan solo si
hacen falta.

**Formatos como datos, no como código.** Agregar un banco es escribir un JSON,
no modificar el motor. La plantilla se valida al cargarla y los errores se
reportan en español. Para formatos que no son tablas (MT940, camt.053) hay
lectores registrables con `registrarLector`, y la plantilla solo mapea sus
campos. Cada plantilla tiene versión, y cada movimiento guarda con qué versión
se leyó.

**Cruce en pases de menor a mayor costo.** El pase exacto es un `Map` en O(n).
El de tolerancia busca por rango en un árbol AVL. El agrupado es una búsqueda
de suma de subconjuntos con poda y un presupuesto de 50.000 nodos para no
bloquearse. Así los casos fáciles, que son la mayoría, no pagan el costo de los
difíciles.

**Asignación óptima solo donde importa.** Cuando varios abonos compiten por las
mismas ventas, un algoritmo voraz puede dejar sin pareja a un abono que sí
tenía una. Por eso las candidatas se modelan como grafo bipartito, se separa en
componentes conexas y cada componente de hasta 60 nodos se resuelve con el
algoritmo Húngaro (O(k³)). Las componentes más grandes usan el voraz. El perfil
puede apagar esto con `cruceOptimo: false` y entonces el resultado es idéntico
al de la versión 0.1.0.

**Explicaciones en vez de solo puntajes.** Cada coincidencia lleva un texto
como «Faltan $24.198,20 (4,65 %) ≈ comisión 3,15 % + ReteFuente 1,5 %», y cada
movimiento libre su motivo: fuera de tolerancia por cuánto, sin candidatos en
la ventana o candidato tomado por otra coincidencia. Quien revisa necesita
saber por qué, no solo un número.

**Revisión reversible.** La sesión de revisión usa dos pilas para deshacer y
rehacer, y una bitácora que solo crece: deshacer agrega un registro, nunca
borra uno. En la API cada confirmación o rechazo es una transacción.

**Privacidad por defecto.** El panel procesa los archivos en el navegador; no
salen del equipo salvo que el usuario guarde en el servidor. Esto permite usar
la herramienta con extractos reales sin depender de la infraestructura del
proyecto.

**TypeScript sin paso de compilación.** Node 24 ejecuta TypeScript quitando los
tipos, así que el código solo usa sintaxis borrable (sin `enum` ni
`namespace`). En el monorepo los paquetes se resuelven a `src` mediante la
condición `conciliador-src` declarada en `.npmrc`; los consumidores externos
reciben `dist/` compilado con `npm run build:lib`.

**API sin framework.** La API usa `node:http` y `pg` directamente. El
enrutador es pequeño y no hacía falta más. Las migraciones son archivos SQL
numerados que corren una vez cada uno, en transacción, y quedan registrados.

**Cola en PostgreSQL.** Las conciliaciones grandes se encolan en la tabla
`trabajos` y un worker las toma con `FOR UPDATE SKIP LOCKED`, de modo que
varios workers no toman el mismo trabajo. Se evitó agregar Redis u otro
servicio solo para esto. Un trabajo que falla se reintenta, con un máximo de tres intentos.

**Multiempresa con lo mínimo.** Contraseñas con scrypt de `node:crypto`,
tokens JWT HS256 firmados sin librerías externas y roles `lector`, `analista`
y `admin`. Cada consulta filtra por la empresa del token. Plantillas y perfiles
no se sobrescriben: cada cambio crea una versión.

**Regex de usuario acotadas.** Las reglas y plantillas aceptan expresiones
regulares escritas por el usuario. Para evitar ReDoS se rechazan cuantificadores
anidados y referencias hacia atrás, el texto evaluado se recorta a 256
caracteres y cada evaluación tiene un tiempo máximo.

**Despliegue en una sola plataforma.** En Vercel el panel es estático y toda la
API es una función que atiende `/api/*`, con la base en Neon. Como Vercel no
mantiene procesos vivos, no hay worker: cada consulta a `GET /trabajos/:id`
procesa antes un trabajo pendiente, y la cola avanza mientras el panel espera
el resultado.

## Estructuras de datos

Implementadas a mano en `packages/core/src/estructuras/`, con pruebas en
`packages/core/test/estructuras.test.ts`.

| Estructura | Uso en el proyecto |
|---|---|
| Cola | Ingesta de archivos en orden de llegada; recorrido BFS de las componentes del grafo |
| Pila (dos) | Deshacer y rehacer en la sesión de revisión |
| Árbol AVL | Ventas indexadas por monto; `buscarRango` devuelve las candidatas dentro de la tolerancia |
| Trie | Detección de plantilla por encabezados; referencias truncadas |
| MinHeap / TopK | Los cinco mejores candidatos de cada abono en O(log k) |
| Grafo bipartito | Aristas abono–venta candidata; cada componente conexa se resuelve por separado y el panel la dibuja |

La justificación y el análisis de complejidad de cada una están en
[docs/DOCUMENTO_FINAL.md](docs/DOCUMENTO_FINAL.md).

## Uso

Requiere Node 24 (o 22.18 en adelante) y npm. PostgreSQL es opcional.

```bash
npm install
npm run dev:web      # panel en http://localhost:5173
npm test             # pruebas de núcleo, paquetes y API
npm run typecheck
```

En el panel, la pestaña Cargar trae datos de demostración de una tienda
ficticia. También se pueden arrastrar archivos propios.

Para levantar la API con base de datos:

```bash
DATABASE_URL=postgres://usuario:clave@localhost:5432/conciliador npm run start:api
npm run worker -w apps/api                       # worker de la cola, proceso aparte
VITE_API_URL=http://localhost:3000 npm run dev:web
```

Sin `DATABASE_URL` la API arranca en modo memoria: concilia pero no guarda. Las
variables de entorno están en `apps/api/.env.example` y las rutas en
[docs/CONTRATOS.md](docs/CONTRATOS.md).

Otros comandos:

| Comando | Qué hace |
|---|---|
| `npm run build:lib` | Compila los paquetes a `dist/` con sus tipos |
| `npm run build:vercel` | Arma la salida para Vercel (panel, función y migraciones) |
| `npm run migrar` | Aplica las migraciones a la base de `DATABASE_URL` |
| `npm run medir` | Mide el tiempo de conciliar 10.000 y 100.000 movimientos |
| `npm run carga` | Prueba de carga con un millón de movimientos y la cola |
| `npm run anonimizar -- entrada.csv salida.csv` | Reemplaza datos personales conservando el formato |

### Como librería

```ts
import { RegistroPlantillas, procesarArchivos, conciliar } from '@conciliador/core';
import { PLANTILLAS } from '@conciliador/plantillas';

const registro = new RegistroPlantillas();
PLANTILLAS.forEach((p) => registro.registrar(p));

const [banco, ventas] = procesarArchivos([extracto, reporteVentas], registro);
const resultado = conciliar(banco.movimientos, ventas.movimientos, perfil);
```

`extracto` y `reporteVentas` son objetos `{ nombre, texto }`. El perfil es
opcional.

### Agregar un banco

Se crea un JSON en `packages/plantillas/formatos/` que describe el archivo:

```json
{
  "id": "banco-ejemplo-csv",
  "nombre": "Banco Ejemplo: movimientos CSV",
  "version": 1,
  "lado": "banco",
  "tipo": "delimitado",
  "separador": "|",
  "separadorDecimal": ".",
  "formatoFecha": "yyyy-MM-dd",
  "filasEncabezado": 1,
  "detectar": { "encabezados": ["Fecha Mov", "Concepto", "Credito"] },
  "columnas": {
    "fecha": "Fecha Mov",
    "descripcion": "Concepto",
    "referencia": { "de": "Concepto", "regex": "REF[: ]*(\\S+)" },
    "monto": "Credito"
  }
}
```

Luego se registra en `packages/plantillas/index.ts`. Las opciones completas,
incluido el ancho fijo, están en [CONTRIBUTING.md](CONTRIBUTING.md) y en
[docs/CONTRATOS.md](docs/CONTRATOS.md).

## Estructura del repositorio

```
packages/
  core/         modelo, estructuras, plantillas, cruce, reglas, tarifas, sesión
  plantillas/   formatos JSON incluidos y muestras sintéticas
  excel/        conversión de Excel a CSV
  dian/         lectura de facturas electrónicas UBL 2.1
apps/
  web/          panel React
  api/          API HTTP, migraciones, cola y worker
scripts/        medición, carga, anonimización y compilación
docs/           plan, contratos, documento final y guías de despliegue
```

## Documentación

- [Documento final](docs/DOCUMENTO_FINAL.md): diseño, estructuras y complejidad.
- [Contratos](docs/CONTRATOS.md): tipos, plantillas, perfiles y API.
- [Plan por fases](docs/PLAN.md).
- [Despliegue en Vercel y Neon](docs/DESPLIEGUE_VERCEL.md).
- [Despliegue alternativo en Render y Netlify](docs/DESPLIEGUE.md).
- [Validación con archivos reales](docs/GUIA_VALIDACION.md).
- [Registro de cambios](CHANGELOG.md).

## Autor

Joan Mateo Cardona Lorza, código estudiantil 2243431.

## Licencia

MIT. Los datos de muestra son sintéticos. Las plantillas se basan en
documentación pública, no en archivos de ninguna entidad.
