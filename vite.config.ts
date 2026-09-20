import { defineConfig } from 'vite';
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'public/build',
    emptyOutDir: true,
    cssCodeSplit: true,
    lib: {
      entry: { main: 'web/client/main.ts', admin: 'web/client/admin.ts' },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.[hash].js`,
    },
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return '[name].[hash].css';
          }
          return '[name].[hash][extname]';
        },
      },
    },
  },
});
