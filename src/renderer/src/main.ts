import './assets/main.css'

import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'
import App from './App.vue'

import { createPinia } from 'pinia'

import en from '@renderer/lang/en.json'

// ── Tauri adapter ─────────────────────────────────────────────────────────────
// When running under Tauri, window.__TAURI__ is injected by the runtime.
// We assign our Tauri-backed nanoIpc adapter to window.nanoIpc before any
// store initialisation so that all subsequent nanoIpc.* calls in deviceStore.ts
// use the Tauri transport.
if (typeof window !== 'undefined' && '__TAURI__' in window) {
  // Dynamic import so the @tauri-apps/api chunk is only loaded under Tauri.
  import('./lib/nanoIpcTauri').then(({ default: tauriAdapter }) => {
    window.nanoIpc = tauriAdapter
  })

  // ── appIpc shim for Tauri ──────────────────────────────────────────────────
  // Navbar.vue reads window.appIpc for window controls, platform, and external
  // links. Wired via @tauri-apps/api/window.
  // This is a best-effort shim; isDevelopment / openDevTools / reload are stubs
  // because Tauri exposes those via the DevTools toggle in the context menu.
  import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
    const win = getCurrentWindow()

    // Track maximized state so Navbar can reflect it.
    const maximizedListeners: Array<(maximized: boolean) => void> = []
    const unmaximizedListeners: Array<() => void> = []

    win.onResized(async () => {
      const maximized = await win.isMaximized()
      if (maximized) {
        maximizedListeners.forEach((cb) => cb(true))
      } else {
        unmaximizedListeners.forEach((cb) => cb())
      }
    })

    // Open external URLs via window.open (Tauri v2 allows this in the webview).
    // If @tauri-apps/plugin-shell is available in the bundle it can be used instead,
    // but window.open is sufficient for launching URLs in the system browser via
    // Tauri's shell open allowlist configured in tauri.conf.json.
    const openExternalFn = (url: string) => {
      window.open(url, '_blank')
    }

    window.appIpc = {
      platform: 'darwin', // macOS is the primary target; adjust if cross-platform
      isDevelopment: import.meta.env.DEV,
      minimizeWindow: () => win.minimize(),
      toggleMaximizeWindow: () => win.toggleMaximize(),
      closeWindow: () => win.close(),
      openExternal: openExternalFn,
      onMaximized: (callback: (maximized: boolean) => void) => {
        maximizedListeners.push(callback)
      },
      onUnmaximized: (callback: () => void) => {
        unmaximizedListeners.push(callback)
      },
      onMenu: (_callback: (key: string) => void) => {
        // No native menu IPC in this Tauri build.
      },
      openDevTools: () => {
        // DevTools in Tauri are toggled via right-click > Inspect (dev builds).
      },
      reload: () => window.location.reload()
    }
  })
}
// ─────────────────────────────────────────────────────────────────────────────

// Create VueI18n instance with locales loaded from /lang directory
const i18n = createI18n({
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en: en }
})

const pinia = createPinia()

const app = createApp(App)

app.use(pinia)
app.use(i18n)

app.mount('#app')
