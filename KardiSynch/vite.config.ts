import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  root: 'src/renderer',
  base: './',

  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    sourcemap: true
  }
})
