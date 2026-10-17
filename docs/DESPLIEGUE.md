# Despliegue

Son tres piezas, todas con plan gratuito:

| Pieza | Servicio | Archivo de configuración |
|---|---|---|
| Base de datos PostgreSQL | **Neon** | (ninguno; el esquema lo aplica la API al arrancar) |
| API (`apps/api`) | **Render** | [`render.yaml`](../render.yaml) |
| Panel (`apps/web`) | **Netlify** | [`netlify.toml`](../netlify.toml) |

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
3. No hay que crear tablas. La API aplica `apps/api/src/esquema.sql` cada vez
   que arranca, y el esquema es idempotente (`IF NOT EXISTS`).

Neon suspende la base tras unos minutos sin uso. La primera consulta después
la despierta (tarda un par de segundos), y la API no se cae por esa conexión
inactiva cerrada.

## 2. Render (API)

1. Cree una cuenta en <https://render.com> y conecte su GitHub.
2. **New → Blueprint** y elija el repositorio. Render lee `render.yaml`:
   - servicio web `conciliador-api`, plan `free`, Node 24;
   - construye desde la **raíz** con `npm ci`, porque la API importa
     `@conciliador/core` y `@conciliador/plantillas` del monorepo;
   - arranca con `npm run start:api` (Node ejecuta el TypeScript directamente);
   - revisa la salud en `/salud`.
3. Render pide las variables marcadas `sync: false`:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | La cadena de Neon del paso 1 |
   | `CORS_ORIGEN` | Por ahora `*`. En el paso 4 se cambia por la URL de Netlify |

   `NODE_VERSION=24` y `NODE_ENV=production` ya vienen en el blueprint. `PORT`
   lo pone Render y la API lo lee.
4. **Apply**. Cuando el log diga
   `API escuchando en el puerto ... (base de datos: sí)`, anote la URL, por
   ejemplo `https://conciliador-api.onrender.com`.

El plan gratuito de Render apaga el servicio tras 15 minutos sin tráfico. La
primera petición después tarda cerca de un minuto en responder.

**Verificar:**

```bash
curl https://conciliador-api.onrender.com/salud
# {"ok":true,"baseDeDatos":true}

curl https://conciliador-api.onrender.com/plantillas
# lista de 5 plantillas
```

Si `baseDeDatos` es `false`, revise `DATABASE_URL` (que tenga
`?sslmode=require`) y el log del servicio.

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
  servidor**.

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
| Render | `DATABASE_URL` | No (sin ella, modo memoria) | `postgres://...neon.tech/neondb?sslmode=require` |
| Render | `CORS_ORIGEN` | No (por defecto `*`) | `https://conciliador.netlify.app` |
| Render | `PORT` | La pone Render | `10000` |
| Render | `NODE_VERSION`, `NODE_ENV` | En `render.yaml` | `24`, `production` |
| Render | `PG_MAX_CONEXIONES` | No (por defecto 10) | `5` |
| Netlify | `VITE_API_URL` | No | `https://conciliador-api.onrender.com` |
| Netlify | `NODE_VERSION` | En `netlify.toml` | `24` |
| CI | `DATABASE_URL_PRUEBA` | La define `ci.yml` | servicio `postgres:16` |

## 7. Integración continua

`.github/workflows/ci.yml` corre en cada push a `main` y en cada pull request.
Usa Node 24 y un servicio `postgres:16`, y ejecuta `npm ci`, `npm test` (con
`DATABASE_URL_PRUEBA`, así que también corren las pruebas de la API contra
PostgreSQL) y `npm run build:web`. Netlify y Render despliegan solos al
mezclar a `main`. Conviene mezclar solo con el CI en verde.
