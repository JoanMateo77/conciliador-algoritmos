// npm run build:lib: compila los paquetes publicables (core, plantillas, excel, dian) a dist/
// con JS + .d.ts. En el monorepo nadie usa dist/ (ver .npmrc); solo sirve para publicar en npm.
//
// Uso: node scripts/compilar-lib.ts
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

// Orden: core primero, porque los demás leen sus tipos ya compilados.
const PAQUETES = ['core', 'excel', 'dian', 'plantillas'];

// plantillas/index.ts importa el tipo Plantilla con una ruta relativa al código de core
// ('../core/src/plantillas/tipos.ts'). Funciona sin compilar, pero en npm esa ruta no existe:
// TypeScript avisa con TS2878 y aquí se reescribe a '@conciliador/core'. Si el import ya usa
// '@conciliador/core', este arreglo no hace nada.
const RUTA_A_CORE = /(['"])(?:\.\.\/)+core\/src\/[^'"]+\1/g;

function compilar(paquete: string): void {
  const config = join(raiz, 'packages', paquete, 'tsconfig.build.json');
  const r = spawnSync(process.execPath, [tsc, '-b', config, '--pretty', 'false'], { encoding: 'utf8' });
  const errores = `${r.stdout}${r.stderr}`.split('\n').filter((l) => l.includes('error TS'));
  const tolerables = paquete === 'plantillas' && usaRutaACore(paquete) ? errores.filter((l) => l.includes('TS2878')) : [];
  const graves = errores.filter((l) => !tolerables.includes(l));
  if (graves.length > 0 || (r.status !== 0 && tolerables.length === 0)) {
    process.stderr.write(`${r.stdout}${r.stderr}`);
    throw new Error(`No compiló packages/${paquete}`);
  }
}

function usaRutaACore(paquete: string): boolean {
  return new RegExp(RUTA_A_CORE.source).test(readFileSync(join(raiz, 'packages', paquete, 'index.ts'), 'utf8'));
}

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    return statSync(ruta).isDirectory() ? archivos(ruta) : [ruta];
  });
}

// Limpia antes: un dist/ viejo con archivos borrados se publicaría igual.
for (const p of PAQUETES) rmSync(join(raiz, 'packages', p, 'dist'), { recursive: true, force: true });
rmSync(join(raiz, 'node_modules/.cache/conciliador-lib'), { recursive: true, force: true });

for (const p of PAQUETES) compilar(p);

for (const p of PAQUETES) {
  const dist = join(raiz, 'packages', p, 'dist');
  for (const archivo of archivos(dist)) {
    if (!/\.(js|ts)$/.test(archivo)) continue;
    const texto = readFileSync(archivo, 'utf8');
    const arreglado = texto.replace(RUTA_A_CORE, (_, comilla: string) => `${comilla}@conciliador/core${comilla}`);
    if (arreglado !== texto) writeFileSync(archivo, arreglado);
    // Nada publicado puede apuntar fuera de su paquete.
    if (/from\s+['"](?:\.\.\/){2,}|from\s+['"]\.\.\/(?:core|plantillas|excel|dian)\//.test(arreglado)) {
      throw new Error(`${archivo} importa algo fuera de su paquete`);
    }
  }
  // Los exports del manifiesto deben existir ya compilados.
  const manifiesto = JSON.parse(readFileSync(join(raiz, 'packages', p, 'package.json'), 'utf8'));
  for (const destino of [manifiesto.exports['.'].types, manifiesto.exports['.'].default]) {
    if (!existsSync(join(raiz, 'packages', p, destino))) throw new Error(`Falta ${destino} en packages/${p}`);
  }
  console.log(`packages/${p}/dist: ${archivos(dist).length} archivos`);
}
