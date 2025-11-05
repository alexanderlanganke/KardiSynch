// vite.config.ts

import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  // 1. Teile Vite mit, wo dein Renderer-Code "beginnt".
  root: 'src/renderer',
  base: './',
  
  plugins: [svelte()],

  build: {
    // 2. Passe den Ausgabepfad an. 
    // Er muss jetzt relativ zum neuen 'root' sein.
    // (Zwei Ebenen hoch '..' -> 'src' -> Projektstamm, dann 'dist/renderer')
    outDir: '../../dist/renderer',
    emptyOutDir: true

    // 3. 'rollupOptions.input' wird nicht mehr benötigt.
    // Vite sucht automatisch nach 'index.html' im 'root'-Verzeichnis.
  }
});