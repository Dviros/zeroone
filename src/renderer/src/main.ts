import './assets/main.css'

import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'
import App from './App.vue'

import { createPinia } from 'pinia'

import en from '@renderer/lang/en.json'

// ── Tauri adapter ─────────────────────────────────────────────────────────────
// Electron is gone — the app always runs under Tauri. Install window.nanoIpc
// (device transport) and window.appIpc (window controls) BEFORE mounting Vue so
// deviceStore/Navbar never observe them undefined (no startup race).
async function installTauriBridge(): Promise<void> {
  // App is Tauri-only (Electron removed). Always install — @tauri-apps/api talks
  // to the runtime via window.__TAURI_INTERNALS__, which is present even when
  // withGlobalTauri doesn't expose the __TAURI__ global. Guarding on '__TAURI__'
  // left window.nanoIpc undefined and broke App setup ('nanoipc.on' of undefined).
  if (typeof window === 'undefined') return
  try {
    const { default: tauriAdapter } = await import('./lib/nanoIpcTauri')
    window.nanoIpc = tauriAdapter

    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    const maximizedListeners: Array<(maximized: boolean) => void> = []
    const unmaximizedListeners: Array<() => void> = []
    win.onResized(async () => {
      const maximized = await win.isMaximized()
      if (maximized) maximizedListeners.forEach((cb) => cb(true))
      else unmaximizedListeners.forEach((cb) => cb())
    })
    window.appIpc = {
      platform: 'darwin', // macOS is the primary target; adjust if cross-platform
      isDevelopment: import.meta.env.DEV,
      minimizeWindow: () => win.minimize(),
      toggleMaximizeWindow: () => win.toggleMaximize(),
      closeWindow: () => win.close(),
      openExternal: (url: string) => window.open(url, '_blank'),
      onMaximized: (cb: (maximized: boolean) => void) => maximizedListeners.push(cb),
      onUnmaximized: (cb: () => void) => unmaximizedListeners.push(cb),
      onMenu: (_cb: (key: string) => void) => {},
      openDevTools: () => {},
      reload: () => window.location.reload()
    }
  } catch (e) {
    // Never let bridge setup block the UI — log and mount anyway.
    console.error('[tauri-bridge] setup failed:', e)
  }
}

async function bootstrap(): Promise<void> {
  await installTauriBridge()

  const i18n = createI18n({ locale: 'en', fallbackLocale: 'en', messages: { en } })
  const app = createApp(App)
  app.use(createPinia())
  app.use(i18n)
  app.mount('#app')
}

bootstrap()
