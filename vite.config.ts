import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: 'dist/renderer',
    rollupOptions: {
      input: {
        main: 'src/renderer/index.html'
      }
    }
  }
});
