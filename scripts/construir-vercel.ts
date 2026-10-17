// Arma la salida para Vercel (Build Output API v3) en .vercel/output:
//   static/              el panel compilado por Vite
//   functions/api.func/  la API empaquetada en un solo archivo con esbuild, más sus migraciones SQL
//   config.json          rutas: /api/* a la función y el resto al panel
// Así Vercel no tiene que entender el monorepo ni el TypeScript sin compilar.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const salida = `${raiz}.vercel/output`;
const funcion = `${salida}/functions/api.func`;

rmSync(salida, { recursive: true, force: true });
mkdirSync(funcion, { recursive: true });

// 1. Panel: misma origen que la API, así que no hace falta CORS ni URL absoluta.
execSync('npm run build -w apps/web', { cwd: raiz, stdio: 'inherit', env: { ...process.env, VITE_API_URL: '/api' } });
cpSync(`${raiz}apps/web/dist`, `${salida}/static`, { recursive: true });

// 2. API: un solo módulo ESM con pg incluido. pg-native es opcional y no se usa.
await build({
  entryPoints: [`${raiz}apps/api/src/vercel.ts`],
  outfile: `${funcion}/index.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['pg-native'],
  // Los paquetes del monorepo se toman desde src (TypeScript), igual que en desarrollo.
  conditions: ['conciliador-src'],
  // Algunas dependencias CommonJS usan require; en ESM hay que crearlo.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
// migraciones.ts lee la carpeta migraciones/ junto al módulo, así que viaja al lado del paquete.
cpSync(`${raiz}apps/api/src/migraciones`, `${funcion}/migraciones`, { recursive: true });

writeFileSync(`${funcion}/.vc-config.json`, JSON.stringify({
  runtime: 'nodejs22.x',
  handler: 'index.mjs',
  launcherType: 'Nodejs',
  shouldAddHelpers: false,
  maxDuration: 60,
}, null, 2));

writeFileSync(`${salida}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { src: '^/api(?:/(.*))?$', dest: '/api?ruta=$1' },
    { handle: 'filesystem' },
    { src: '^/(.*)$', dest: '/index.html' },
  ],
}, null, 2));

console.log(`Salida de Vercel lista en ${salida}`);
