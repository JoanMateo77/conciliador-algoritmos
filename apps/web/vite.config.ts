import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// El panel importa el núcleo y las plantillas desde el código fuente:
// así no hay paso de compilación intermedio y Node y el navegador usan lo mismo.
const ruta = (relativa: string) => fileURLToPath(new URL(relativa, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@conciliador/core': ruta('../../packages/core/src/index.ts'),
      '@conciliador/plantillas': ruta('../../packages/plantillas/index.ts'),
    },
  },
  build: { target: 'es2022' },
});
