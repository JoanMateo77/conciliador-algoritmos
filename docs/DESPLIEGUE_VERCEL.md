# Despliegue en Vercel con base de datos Neon

Todo queda en un solo proyecto de Vercel: el panel, la API y la base de
datos. Es la forma recomendada de poner el conciliador en producción.

| Pieza | Dónde queda | Dirección |
|---|---|---|
| Panel (React) | Archivos estáticos en la CDN de Vercel | `https://<proyecto>.vercel.app/` |
| API | Una función de Vercel que atiende todo `/api/*` | `https://<proyecto>.vercel.app/api/salud` |
| Base de datos | PostgreSQL en Neon, creada desde Vercel | variable `DATABASE_URL` |

El panel y la API comparten dominio, así que no hay que configurar CORS ni
escribir la URL de la API en ningún lado.

## Cómo funciona por dentro

`npm run build:vercel` ejecuta `scripts/construir-vercel.ts`, que arma la
carpeta `.vercel/output` con el formato *Build Output API* de Vercel:

```
.vercel/output/
├── config.json              rutas: /api/* → función; lo demás → panel
├── static/                  panel compilado (Vite, con VITE_API_URL=/api)
└── functions/api.func/
    ├── index.mjs            API empaquetada con esbuild (incluye pg)
    ├── migraciones/         001 a 004 en SQL; se aplican solas al arrancar
    └── .vc-config.json      Node 22, 60 s máximo por petición
```

`vercel.json` le dice a Vercel que instale con `npm ci` y construya con ese
comando. La entrada de la función es `apps/api/src/vercel.ts`, que usa el
mismo enrutador que el servidor de Node.

**Cola de trabajos sin worker.** Vercel no permite procesos que corran
siempre. Por eso, cada vez que el panel consulta el estado de un trabajo
(`GET /api/trabajos/:id`), la función procesa antes un trabajo pendiente.
La cola avanza al ritmo del sondeo del panel, sin servicios extra.

## Antes de empezar

- Una cuenta en <https://vercel.com>. Lo más fácil es entrar con GitHub.
- El proyecto en tu computador, con `npm ci` hecho y las pruebas pasando:

  ```bash
  npm ci
  npm test
  npm run build:vercel   # debe terminar con "Salida de Vercel lista"
  ```

Hay dos caminos para subirlo. Elige uno.

- **Camino A, desde GitHub (recomendado):** cada `git push` a `main` vuelve a
  publicar solo.
- **Camino B, desde tu computador con la CLI:** sirve si todavía no tienes el
  repositorio en GitHub.

## Paso 1. Crear el proyecto en Vercel

### Camino A: desde GitHub

1. Sube el repositorio a GitHub con `package-lock.json` y `vercel.json`
   incluidos.
2. En Vercel: **Add New… → Project**.
3. Elige el repositorio y pulsa **Import**.
4. En la configuración, **no cambies nada**. Vercel lee `vercel.json`:
   - Framework Preset: **Other**
   - Install Command: `npm ci`
   - Build Command: `npm run build:vercel`
   - Root Directory: la raíz del repositorio (déjalo vacío)
5. Pulsa **Deploy**. El primer despliegue funciona aunque todavía no haya
   base de datos: la API arranca en "modo memoria".

### Camino B: desde tu computador

```bash
npx vercel@latest login      # abre el navegador para iniciar sesión
npx vercel@latest link       # crea el proyecto: acepta los valores que propone
npx vercel@latest deploy     # despliegue de prueba (URL de preview)
```

Cuando pregunte *"Want to modify these settings?"* responde **No**: los
valores salen de `vercel.json`.

## Paso 2. Crear la base de datos (Neon)

1. En el proyecto de Vercel abre la pestaña **Storage**.
2. Pulsa **Create Database** y elige **Neon** (Serverless Postgres).
3. Acepta los términos. Elige:
   - Región: **Washington, D.C., USA (iad1)**, la misma de las funciones de
     Vercel por defecto. Así la API y la base quedan cerca.
   - Plan: **Free**.
   - Nombre: `conciliador`.
4. Pulsa **Create**. Luego, en **Connect Project**, elige tu proyecto y marca
   los entornos **Production**, **Preview** y **Development**. Pulsa
   **Connect**.

Vercel agrega solas las variables de conexión al proyecto. Las que usa el
conciliador son:

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Conexión con pooler; la usa la API en cada petición |
| `DATABASE_URL_UNPOOLED` | Conexión directa; úsala para migrar desde tu computador |

No hay que copiarlas a ningún archivo del repositorio.

## Paso 3. Definir el secreto de los tokens

Los inicios de sesión usan tokens firmados con `JWT_SECRETO`.

1. Genera un valor largo y aleatorio en tu computador:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

2. En Vercel: **Settings → Environment Variables → Add**. Nombre
   `JWT_SECRETO`, valor el que generaste, entorno **Production** (y Preview
   si quieres). Pulsa **Save**.

Si lo olvidas, la API deriva uno estable de `DATABASE_URL` y todo funciona
igual, pero es mejor tener uno propio: si cambias la base, los tokens
siguen siendo válidos.

## Paso 4. Volver a desplegar para que la API vea la base

Las variables nuevas solo se aplican a despliegues nuevos.

- Camino A: **Deployments → (el último) → ⋯ → Redeploy**.
- Camino B: `npx vercel@latest deploy --prod`.

Las tablas se crean solas: la primera petición a la API aplica las
migraciones (`apps/api/src/migraciones`). Cada una corre una sola vez, queda
anotada en la tabla `migraciones` y lleva un candado de PostgreSQL, así que
dos instancias que arrancan a la vez no chocan.

### Opcional: crear las tablas desde tu computador

Sirve para comprobar la conexión antes de abrir el panel.

```bash
npx vercel@latest env pull .env.produccion --environment=production
node --env-file=.env.produccion -e "console.log(process.env.DATABASE_URL_UNPOOLED ? 'ok' : 'falta')"
DATABASE_URL="$(node --env-file=.env.produccion -p process.env.DATABASE_URL_UNPOOLED)" npm run migrar
rm .env.produccion           # tiene la contraseña: no lo dejes ni lo subas
```

Debe imprimir `Esquema aplicado. Tablas: coincidencias, conciliaciones, empresas, eventos, migraciones, movimientos, perfiles_empresa, perfiles_versiones, plantillas_empresa, plantillas_versiones, trabajos, usuarios`.

## Paso 5. Verificar que todo está en producción

Reemplaza `<url>` por la dirección que te dio Vercel, por ejemplo
`https://conciliador.vercel.app`.

| Qué abrir | Qué debe salir |
|---|---|
| `<url>/api/salud` | `{"ok":true,"baseDeDatos":true}` |
| `<url>/api/plantillas` | Lista con 7 plantillas |
| `<url>/` | El panel |

En el panel:

1. Pulsa **Usar datos de demo** y luego **Conciliar**.
2. En Resultados confirma o rechaza alguna coincidencia.
3. Pulsa **Guardar en el servidor** y acepta el aviso.
4. Abre `<url>/api/conciliaciones`: aparece la conciliación guardada.
5. Vuelve a **Cargar**, pulsa **Demo B2B con facturas DIAN** y concilia: los
   pagos cruzan con sus facturas y la explicación menciona las retenciones.
6. En **6. Servidor** elige **Empresa nueva**, registra una empresa y pulsa
   **Enviar a la cola**. En pocos segundos el trabajo pasa a **Terminado**.

Si quieres verlo directo en la base: Vercel → **Storage** → tu base →
**Open in Neon** → **Tables**.

## Paso 6. Dejarlo listo para la entrega

- Pon la URL en la tabla **Enlaces** del `README.md` y haz commit.
- Opcional: **Settings → Domains** para un nombre más corto, por ejemplo
  `conciliador-uao.vercel.app`.
- Opcional: si vas a llamar la API desde otro dominio, define `CORS_ORIGEN`
  en **Settings → Environment Variables** con ese dominio.

## Variables de entorno

| Variable | Obligatoria | Valor |
|---|---|---|
| `DATABASE_URL` | Sí, para guardar | La pone Neon al conectar la base |
| `JWT_SECRETO` | Recomendada | Secreto largo y aleatorio para firmar los tokens (paso 3) |
| `CORS_ORIGEN` | No | `*` por defecto; solo hace falta si otro dominio usa la API |
| `PG_MAX_CONEXIONES` | No | Conexiones por instancia; `3` por defecto en Vercel |

## Solución de problemas

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El build falla en `npm ci` | Falta `package-lock.json` o está desactualizado | `npm install` en tu computador, commit del lock y push |
| `/api/salud` dice `"baseDeDatos":false` | La base no está conectada o no se volvió a desplegar | Paso 2 (Connect Project con Production) y paso 4 |
| `/api/salud` responde 500 | `DATABASE_URL` mala o la base no responde | Vercel → proyecto → **Logs**; revisa la variable en Settings → Environment Variables |
| El panel abre pero "Guardar en el servidor" no aparece | El panel se compiló sin `VITE_API_URL` | Asegúrate de que el Build Command sea `npm run build:vercel` (no `npm run build:web`) |
| Al recargar el panel hay que volver a ingresar | La sesión se guarda solo en memoria, a propósito | Normal: el token no queda en el navegador |
| Un trabajo se queda en Pendiente | Nadie está consultando su estado | Abre la pestaña Servidor: el sondeo del panel lo procesa |
| La primera petición tarda 1 o 2 segundos | Arranque en frío de la función y de Neon (se suspende sin uso) | Normal en el plan gratis; las siguientes son rápidas |
| 404 al recargar una página del panel | Rutas mal configuradas | Debe existir `.vercel/output/config.json`; vuelve a correr `npm run build:vercel` localmente y revisa |
| `npx vercel` pide permisos o equipo | Cuenta nueva | Elige tu cuenta personal (Hobby) |

## Alternativa

El despliegue anterior (Neon + Render + Netlify) sigue funcionando y está en
[DESPLIEGUE.md](DESPLIEGUE.md).
