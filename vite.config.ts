import { defineConfig } from 'vite';
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'public/build',
    emptyOutDir: true,
    lib: {
      entry: 'web/client/main.ts',
      formats: ['es'],
      fileName: () => 'main.js',
      cssFileName: 'main',
    },
  },
});
