import { fileURLToPath } from 'node:url';
import { defineConfig, defaultClientConditions } from 'vite';
import react from '@vitejs/plugin-react';

// El panel importa el núcleo y las plantillas desde el código fuente:
// así no hay paso de compilación intermedio y Node y el navegador usan lo mismo.
const ruta = (relativa: string) => fileURLToPath(new URL(relativa, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Misma condición que .npmrc da a Node: si algo importa @conciliador/* sin pasar por un
    // alias (p. ej. un paquete nuevo), Vite toma src/ y no exige haber corrido build:lib.
    conditions: ['conciliador-src', ...defaultClientConditions],
    alias: {
      '@conciliador/core': ruta('../../packages/core/src/index.ts'),
      '@conciliador/plantillas': ruta('../../packages/plantillas/index.ts'),
      // Adaptadores de las fases 9 y 15: Excel (SheetJS vive solo en ese paquete) y facturas DIAN.
      '@conciliador/excel': ruta('../../packages/excel/src/index.ts'),
      '@conciliador/dian': ruta('../../packages/dian/src/index.ts'),
    },
  },
  build: { target: 'es2022' },
});
