# Despliegue

Son cuatro piezas. Las tres primeras tienen plan gratuito; el worker no:

| Pieza | Servicio | Archivo de configuración |
|---|---|---|
| Base de datos PostgreSQL | **Neon** | (ninguno; las migraciones las aplica la API o el worker al arrancar) |
| API (`apps/api`) | **Render**, servicio web | [`render.yaml`](../render.yaml) |
| Worker de la cola (`apps/api/src/worker.ts`) | **Render**, *background worker* (plan `starter`, de pago) | [`render.yaml`](../render.yaml) |
| Panel (`apps/web`) | **Netlify** | [`netlify.toml`](../netlify.toml) |

El worker solo hace falta para `POST /conciliaciones?asincrono=1` (la cola de
trabajos). Sin él todo lo demás funciona: la conciliación normal sigue siendo
síncrona, y los trabajos encolados quedan `pendiente` hasta que algún worker
los tome (sección 2.1).

Orden recomendado: **Neon → Render → Netlify → volver a Render** para
restringir CORS. El panel funciona sin la API: si solo quiere publicar el
panel, salte al paso 3 y no defina `VITE_API_URL`.

Antes de empezar, suba el repositorio a GitHub con `package-lock.json`
incluido. Render y Netlify instalan con `npm ci`, que lo exige.

## 1. Neon (PostgreSQL)

1. Cree una cuenta en <https://neon.tech> y un proyecto nuevo (región:
   `AWS US East` o la más cercana a la región que elija en Render).
2. En **Connection Details** copie la cadena de conexión. Tiene esta forma:
   ```
   postgres://usuario:clave@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
   Debe terminar en `?sslmode=require`, porque Neon exige SSL.
3. No hay que crear tablas. La API (y el worker) aplican al arrancar las
   **migraciones** de `apps/api/src/migraciones/` (`001_inicial.sql`,
   `002_multiempresa.sql`, `003_trabajos.sql`, `004_cruce_ampliado.sql`):
   - cada archivo corre **una sola vez**, en su propia transacción, y queda
     anotado en la tabla `migraciones` con su suma SHA-256;
   - un *advisory lock* evita que la API y el worker migren a la vez;
   - una base creada por la versión 0.1.0 (con el antiguo `esquema.sql`) se
     migra sin perder datos: lo que tenía queda en la empresa pública `demo`;
   - **no edite una migración ya aplicada**: no se vuelve a correr (el registro
     avisa `migracion_modificada`). Un cambio de esquema es un archivo nuevo
     `005_….sql`.

   Para revisar qué se aplicó, en el **SQL Editor** de Neon:
   ```sql
   SELECT version, nombre, aplicada FROM migraciones ORDER BY version;
   ```

Neon suspende la base tras unos minutos sin uso. La primera consulta después
la despierta (tarda un par de segundos), y la API no se cae por esa conexión
inactiva cerrada.

## 2. Render (API)

1. Cree una cuenta en <https://render.com> y conecte su GitHub.
2. **New → Blueprint** y elija el repositorio. Render lee `render.yaml`, que
   declara **dos servicios**:
   - servicio web `conciliador-api`, plan `free`, Node 24: construye desde la
     **raíz** con `npm ci` (la API importa `@conciliador/core` y
     `@conciliador/plantillas` del monorepo), arranca con `npm run start:api`
     (Node ejecuta el TypeScript directamente; `.npmrc` le pasa la condición
     `conciliador-src`) y revisa la salud en `/salud`;
   - *background worker* `worker`, plan `starter`: misma construcción, arranca
     con `npm run worker -w apps/api`.

   Si no quiere pagar el worker, borre ese servicio del blueprint antes de
   aplicar (o elimínelo después en Render); vea la sección 2.1.
3. Render pide las variables marcadas `sync: false`:

   | Servicio | Variable | Valor |
   |---|---|---|
   | `conciliador-api` | `DATABASE_URL` | La cadena de Neon del paso 1 |
   | `conciliador-api` | `CORS_ORIGEN` | Por ahora `*`. En el paso 4 se cambia por la URL de Netlify |
   | `worker` | `DATABASE_URL` | **La misma** cadena de Neon (API y worker comparten la cola) |

   Ya vienen en el blueprint:

   | Variable | Valor | Para qué |
   |---|---|---|
   | `JWT_SECRETO` | `generateValue: true` | Render genera un secreto aleatorio **una vez** y lo conserva entre despliegues. Firma los tokens de la API multiempresa. El worker no lo necesita |
   | `CONFIAR_PROXY` | `1` | Detrás del proxy de Render la IP del cliente llega en `X-Forwarded-For`; el límite de intentos de `/auth/ingreso` la usa |
   | `WORKER_CONCURRENCIA` | `1` | Trabajos a la vez por proceso worker |
   | `NODE_VERSION`, `NODE_ENV` | `24`, `production` | Con `production`, si la URL de la base no dice `sslmode`, la conexión exige SSL |

   `PORT` lo pone Render y la API lo lee.

   **Sobre `JWT_SECRETO`.** Si falta, la API arranca con un secreto temporal y
   avisa `jwt_sin_secreto` en el registro: los tokens dejan de valer en cada
   reinicio (y el plan gratuito reinicia seguido). Si lo define a mano, use un
   valor largo y aleatorio:
   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```
   Cambiarlo invalida todas las sesiones abiertas (útil si se filtró). Nunca lo
   suba al repositorio.
4. **Apply**. Los registros son JSON, una línea por evento. Cuando el log de
   la API muestre `"evento":"api_iniciada"` con `"baseDeDatos":true` (antes
   aparecen las migraciones aplicadas), anote la URL, por ejemplo
   `https://conciliador-api.onrender.com`.

El plan gratuito de Render apaga el servicio tras 15 minutos sin tráfico. La
primera petición después tarda cerca de un minuto en responder.

**Verificar:**

```bash
curl https://conciliador-api.onrender.com/salud
# {"ok":true,"baseDeDatos":true}

curl https://conciliador-api.onrender.com/plantillas
# lista de 7 plantillas (sin token: las incluidas)

# Multiempresa: crear una empresa de prueba (datos inventados) e ingresar
curl -X POST https://conciliador-api.onrender.com/auth/registro -H 'Content-Type: application/json' \
  -d '{"empresa":"Tienda Ejemplo","nombre":"Ana","correo":"ana@ejemplo.test","contrasena":"una-clave-larga-123"}'
curl -X POST https://conciliador-api.onrender.com/auth/ingreso -H 'Content-Type: application/json' \
  -d '{"correo":"ana@ejemplo.test","contrasena":"una-clave-larga-123"}'
# {"token":"eyJ...","usuario":{...}}
```

### 2.1 Worker de la cola

El log del worker debe mostrar registros JSON (una línea por evento) como
`{"ts":"…","nivel":"info","evento":"worker_iniciado","worker":"…","concurrencia":1}`. Para probarlo:

```bash
# con el token del paso anterior y un cuerpo { banco: {nombre, texto}, ventas: {nombre, texto} }
curl -X POST 'https://conciliador-api.onrender.com/conciliaciones?asincrono=1' \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d @cuerpo.json
# 202 {"trabajoId":"...","estado":"pendiente"}
curl https://conciliador-api.onrender.com/trabajos/<trabajoId> -H "Authorization: Bearer $TOKEN"
# "estado":"hecho" y "conciliacionId" cuando el worker terminó
```

- **Varios workers.** Se puede subir el número de instancias o
  `WORKER_CONCURRENCIA`: la cola usa `FOR UPDATE SKIP LOCKED` y nunca dos
  procesan el mismo trabajo.
- **Despliegues.** Render manda `SIGTERM` y espera 30 s: el worker deja de
  tomar trabajos y termina el que tiene en curso (tope `WORKER_APAGADO_MS`,
  25 s). Si no alcanza, el trabajo vuelve a la cola a los 10 minutos.
- **Sin pagar el worker.** Puede correrlo desde su equipo contra la misma base
  de Neon cuando lo necesite:
  ```bash
  DATABASE_URL='postgres://...neon.tech/neondb?sslmode=require' npm run worker -w apps/api
  ```
- **Métricas.** `GET /metricas` (con token) cuenta los trabajos por estado y
  da los tiempos de proceso y de espera de la cola de la empresa.

Si `baseDeDatos` es `false`, revise `DATABASE_URL` (que tenga
`?sslmode=require`) y el log del servicio. Si una migración falla, la API no
arranca y el log dice cuál; corrija con una migración nueva, no editando la
aplicada.

## 3. Netlify (panel)

1. Cree una cuenta en <https://netlify.com> y elija **Add new site → Import an
   existing project** con el repositorio. Netlify lee `netlify.toml`:
   - `base = "."` construye desde la raíz, porque el panel importa
     `packages/` por alias;
   - `command = "npm ci && npm run build:web"`;
   - `publish = "apps/web/dist"`;
   - `NODE_VERSION = "24"`.
2. Antes de desplegar, en **Site configuration → Environment variables**
   agregue:

   | Variable | Valor |
   |---|---|
   | `VITE_API_URL` | La URL de Render, sin `/` al final (opcional) |

   Vite incrusta esta variable **al compilar**. Si la agrega o la cambia
   después, haga **Deploys → Trigger deploy** para que tome efecto.
3. Despliegue y anote la URL, por ejemplo `https://conciliador.netlify.app`.

**Verificar:**

- Abra la URL. En la pestaña *Cargar* pulse una demo y luego **Conciliar**.
  Deben salir coincidencias automáticas y sugeridas.
- Si definió `VITE_API_URL`, en *Resultados* aparece **Guardar en el
  servidor** y aparece la pestaña *Servidor* (ingreso, plantillas y perfiles
  de la empresa, conciliación por la cola).

## 4. Cerrar CORS

De vuelta en Render, en **Environment**, cambie `CORS_ORIGEN` a la URL exacta
de Netlify (sin `/` final). Si necesita varias, sepárelas con comas:

```
https://conciliador.netlify.app,http://localhost:5173
```

Render redespliega solo.

## 5. Prueba de punta a punta

1. En el panel desplegado, cargue una demo, concilie, confirme una
   coincidencia y rechace otra.
2. Pulse **Guardar en el servidor** y acepte la confirmación. Debe salir
   «Guardada en el servidor con id …».
3. Compruebe en la API:
   ```bash
   curl https://conciliador-api.onrender.com/conciliaciones
   # la conciliación aparece con revision.confirmadas = 1 y rechazadas = 1
   ```
4. Opcional, en el **SQL Editor** de Neon:
   ```sql
   SELECT tipo, estado_anterior, estado_nuevo, creado FROM eventos ORDER BY id DESC LIMIT 5;
   ```

Si el navegador muestra un error de CORS, revise que `CORS_ORIGEN` sea igual,
carácter por carácter, al origen del panel (con `https://` y sin ruta).

## 6. Variables, resumen

| Dónde | Variable | Obligatoria | Ejemplo |
|---|---|---|---|
| Render (API) | `DATABASE_URL` | No (sin ella, modo memoria) | `postgres://...neon.tech/neondb?sslmode=require` |
| Render (API) | `CORS_ORIGEN` | No (por defecto `*`) | `https://conciliador.netlify.app` |
| Render (API) | `JWT_SECRETO` | En `render.yaml` (generado) | 32 bytes aleatorios en base64url |
| Render (API) | `JWT_DURACION_S` | No (por defecto 28800, 8 h) | `3600` |
| Render (API) | `CONFIAR_PROXY` | En `render.yaml` | `1` |
| Render (API) | `TRABAJO_MAX_INTENTOS` | No (por defecto 3) | `5` |
| Render (API) | `PORT` | La pone Render | `10000` |
| Render (worker) | `DATABASE_URL` | Sí | la misma de la API |
| Render (worker) | `WORKER_CONCURRENCIA` | En `render.yaml` | `1` |
| Render (worker) | `WORKER_INTERVALO_MS`, `WORKER_APAGADO_MS` | No (1000 y 25000) | |
| Render (ambos) | `NODE_VERSION`, `NODE_ENV` | En `render.yaml` | `24`, `production` |
| Render (ambos) | `PG_MAX_CONEXIONES` | No (por defecto 10) | `5` |
| Render (ambos) | `LOG_NIVEL` | No (por defecto `info`) | `aviso` |
| Netlify | `VITE_API_URL` | No | `https://conciliador-api.onrender.com` |
| Netlify | `NODE_VERSION` | En `netlify.toml` | `24` |
| CI | `DATABASE_URL_PRUEBA` | La define `ci.yml` | servicio `postgres:16` |

## 7. Integración continua

`.github/workflows/ci.yml` corre en cada push a `main` y en cada pull request.
Usa Node 24 y un servicio `postgres:16`, y ejecuta `npm ci`,
`npm run typecheck`, `npm test` (con `DATABASE_URL_PRUEBA`, así que también
corren las pruebas de la API, la cola y las migraciones contra PostgreSQL),
`npm run build:lib` y `npm run build:web`. Netlify y Render despliegan solos al
mezclar a `main`. Conviene mezclar solo con el CI en verde.
