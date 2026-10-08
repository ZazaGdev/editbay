import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('src/main/index.ts') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    // A sandboxed window only runs a preload that is a plain script, not a module.
    build: {
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    // The tutorials are read out of `docs/tutorials` at build time, which is
    // above the renderer's root, so the dev server has to be allowed to serve
    // from the project root as well.
    server: { fs: { allow: [resolve('.')] } },
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } }
  }
})
