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
    emptyOutDir: true
    // NOTE: do NOT externalize @tauri-apps/*. Their JS must be BUNDLED — the
    // package code calls window.__TAURI_INTERNALS__ at runtime, but the imports
    // themselves (`@tauri-apps/api/core`, etc.) are bare specifiers a browser
    // cannot resolve. Dev worked because Vite's dev server resolves bare imports;
    // the production bundle left them bare → "does not resolve to a valid URL" →
    // the Tauri bridge import threw → window.nanoIpc never installed → black screen.
  },

  server: {
    port: 5173,
    strictPort: true
  }
})
