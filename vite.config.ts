import { resolve } from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'
import tailwind from 'tailwindcss'
import autoprefixer from 'autoprefixer'

// Standalone Vite config for the Vue renderer (Tauri frontend).
// Used by 'pnpm vite:dev' and 'pnpm vite:build' which are wired into Tauri's
// beforeDevCommand / beforeBuildCommand.
export default defineConfig({
  root: 'src/renderer',

  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },

  plugins: [
    vue(),
    VueI18nPlugin({
      jitCompilation: true // Avoids CSP issues with runtime compilation
    })
  ],

  css: {
    postcss: {
      plugins: [tailwind(), autoprefixer()]
    }
  },

  build: {
    // Output relative to the vite root (src/renderer), so the final path is
    // <project>/dist — which tauri.conf.json references as "../dist".
    outDir: '../../dist',
    emptyOutDir: true,
    rollupOptions: {
      // @tauri-apps/* packages are NOT bundled — Tauri injects them as IPC
      // stubs via the webview runtime. Mark them external so Rollup doesn't
      // try to resolve them from node_modules during the renderer build.
      external: [/^@tauri-apps\//]
    }
  },

  server: {
    port: 5173,
    strictPort: true
  }
})
