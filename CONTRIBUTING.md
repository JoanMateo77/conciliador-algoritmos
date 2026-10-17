# Cómo aportar

Gracias por ayudar. La forma más útil de aportar es una **plantilla** para un
banco o una pasarela que aún no está, con un archivo de muestra anonimizado y
su prueba. No hace falta programar el núcleo para eso.

## Preparar el entorno

Requisitos: Node 24 (desde 22.18 también funciona) y npm. PostgreSQL es
opcional y solo lo usan las pruebas de la API.

```bash
npm install
npm test                 # núcleo, plantillas, excel, dian y API
npm run typecheck        # tipos de todo el monorepo
npm run build:lib        # compila los paquetes publicables a dist/
```

Las pruebas de la API con base de datos se saltan si no existe
`DATABASE_URL_PRUEBA`. Para correrlas, use una base desechable:

```bash
DATABASE_URL_PRUEBA=postgres://postgres@localhost:5432/postgres npm test
```

**Código sin compilar.** En el monorepo Node ejecuta el TypeScript
directamente. Los `exports` de cada paquete tienen una condición
`conciliador-src` que apunta a `src/`, y `.npmrc` la activa en todos los
scripts de npm. Si corre un archivo con `node` sin pasar por npm y ese archivo
importa `@conciliador/...`, agregue la condición:

```bash
node --conditions=conciliador-src --test packages/dian/test/dian.test.ts
```

Sin esa condición Node busca `dist/`, que solo existe después de
`npm run build:lib`.

## Aportar una plantilla

1. **Consiga el archivo tal como lo descarga el portal** del banco o la
   pasarela, sin abrirlo ni guardarlo con Excel, porque Excel cambia fechas y
   decimales.
2. **Anonimícelo** antes de que salga de su equipo:

   ```bash
   node scripts/anonimizar.ts original.csv muestras-nuevo.csv --clave "una-clave-suya"
   # opciones: --plantilla id  --desplazar-dias N  --factor-montos F  --hoja nombre (Excel)
   ```

   Reemplaza nombres, cédulas y NIT, correos, cuentas y referencias por
   valores sintéticos estables, y conserva el formato exacto (columnas,
   separadores, longitudes de ancho fijo). Use la misma clave para el banco y
   las ventas del mismo comercio, así siguen cruzando. Revise el resultado a
   mano: **ningún dato real puede llegar al repositorio**. No envíe archivos de
   su empleador ni formatos internos que no sean públicos.
3. **Escriba la plantilla** en `packages/plantillas/formatos/<id>.json`. El
   README tiene un ejemplo completo y `docs/CONTRATOS.md` §3 y §9 tienen todas
   las opciones (delimitado, ancho fijo, MT940, camt.053, `omitirSi`,
   transformaciones de columnas). La pestaña *Plantillas* del panel arma un
   primer borrador desde el archivo de muestra.
4. **Regístrela.** Impórtela en `packages/plantillas/index.ts` y agréguela a
   `PLANTILLAS`. Guarde la muestra en `packages/plantillas/muestras/` y copie
   su texto en `muestras/index.ts` (la prueba `muestras.test.ts` verifica que
   sean idénticos).
5. **Agregue una prueba** en `packages/core/test/formatos.test.ts` o
   `plantillas.test.ts`: la muestra se lee sin errores, la plantilla se
   detecta sola y los montos y referencias de dos o tres filas son los
   esperados (en centavos).
6. `npm test` y `npm run typecheck` en verde.

Si el formato cambia, no edite la plantilla vieja: suba `version`. Cada
movimiento guarda `plantillaVersion` y así se sabe con qué versión se leyó.

## Estilo

- TypeScript que Node ejecuta sin compilar: solo sintaxis borrable (nada de
  `enum`, `namespace`, propiedades en parámetros del constructor ni
  decoradores), imports con extensión `.ts` e `import type` para los tipos.
- Nombres, comentarios y mensajes de error en español. Comentarios cortos que
  expliquen el porqué, no el qué.
- Dinero siempre en centavos enteros (`Number.isSafeInteger`), nunca
  decimales.
- El núcleo (`packages/core`) no tiene dependencias, no lee archivos, no usa
  red ni `Date.now()` dentro del cruce. Lo que necesite E/S va en un
  adaptador (`excel`, `dian`), la API o el panel.
- Pruebas con `node:test` y `node:assert/strict`. Datos de muestra siempre
  sintéticos.
- Todo lo nuevo es opcional y retrocompatible. Las pruebas existentes no se
  borran ni se debilitan.
- `docs/CONTRATOS.md` es la fuente de verdad de tipos y firmas: si un módulo
  necesita algo que no está ahí, se agrega ahí primero.

## Ramas y cambios

Cada aporte va en una rama propia (`fase-NN-tema` o `plantilla-<id>`) que se
mezcla a `main` con `--no-ff` cuando la integración continua está en verde.
Anote el cambio en `CHANGELOG.md`, sección *Sin publicar*.

## Versionado

Los paquetes `@conciliador/*` siguen [versionado semántico](https://semver.org/lang/es/)
y se publican juntos con la misma versión.

- **Parche** (0.2.0 → 0.2.1): correcciones que no cambian ninguna firma.
- **Menor** (0.2 → 0.3 mientras sea `0.x`): funciones, campos opcionales o
  plantillas nuevas. Mientras la versión sea `0.x`, también un cambio que
  rompa compatibilidad, anunciado en el changelog.
- **Mayor** (desde 1.0.0): cualquier cambio que rompa compatibilidad.

Una plantilla incluida nueva es un cambio menor. Una plantilla existente
corregida sube su propio campo `version` y es un parche del paquete.

Para publicar: actualice la versión en los cuatro `package.json`, pase la
sección *Sin publicar* del changelog a la versión nueva, corra
`npm run build:lib` y revise con `npm pack --dry-run -w packages/<paquete>`
que el paquete solo lleve `dist/`, `README.md` y `package.json`.
