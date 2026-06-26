// nanoIpcTauri.ts — implements the window.nanoIpc (INanoSerialApi) interface using
// the Tauri v2 invoke() / listen() APIs.
//
// Usage: imported and wired in main.ts when window.__TAURI__ is detected.
// Event shape from Rust: { eventid, deviceid, data }
// These map 1:1 to the nanoIpc.on(callback) signature: (eventid, deviceid, data).

import type { INanoSerialApi, NetDiscoveredDevice } from '../../../../types/nanoIpc'

// Tauri v2 imports — these are only evaluated when running under Tauri.
// The @tauri-apps/api package must be added to devDependencies (see package.json script).
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

// ── Event payload types from Rust ─────────────────────────────────────────────

interface NanoEventPayload {
  eventid:  string
  deviceid: string
  data?:    string
}

// ── Adapter ───────────────────────────────────────────────────────────────────

class NanoIpcTauri implements INanoSerialApi {
  /**
   * Return all attached serial devices by querying the Rust backend.
   * Mimics nanoSerialApi.list_devices() which scans VID/PID pairs.
   */
  async listAttachedDevices(): Promise<string[]> {
    return invoke<string[]>('list_serial_devices')
  }

  /**
   * Connect to a serial device by ID (serial number or port path).
   * The Rust backend opens the port and starts a reader task.
   */
  async connect(deviceid: string): Promise<string> {
    return invoke<string>('connect_serial', { deviceId: deviceid })
  }

  /**
   * Disconnect a device (serial or net) by ID.
   * Routes to the correct transport on the Rust side based on the "net:" prefix.
   */
  async disconnect(deviceid: string): Promise<string> {
    return invoke<string>('disconnect', { deviceId: deviceid })
  }

  /**
   * Register a listener for all nano events.
   * The Rust backend emits "nano-event" with { eventid, deviceid, data }.
   * We fan out to the single callback the renderer supplies.
   *
   * Registers a listener for nano-event payloads emitted by the Rust backend.
   */
  on(callback: (eventid: string, deviceid: string, data: string) => void): void {
    // listen() is async but we fire-and-forget: the unlisten handle is not
    // needed here because the listener lives for the app lifetime.
    listen<NanoEventPayload>('nano-event', (event) => {
      const { eventid, deviceid, data } = event.payload
      callback(eventid, deviceid, data ?? '')
    }).catch((err) => {
      console.error('[nanoIpcTauri] Failed to listen for nano-event:', err)
    })

    // Also listen to legacy-named events if needed (device-attached etc. come
    // from the Rust backend as nano-event with eventid='device-attached').
    // No extra listeners needed — everything is multiplexed over nano-event.
  }

  /**
   * Send a JSON string to a device.
   * The Rust backend writes jsonstr + '\n' to the port.
   * NO double-encoding — the renderer already calls JSON.stringify once.
   */
  async send(deviceid: string, jsonstr: string): Promise<void> {
    return invoke<void>('send', { deviceId: deviceid, jsonstr })
  }

  /** save() is a no-op stub; the renderer calls nanoIpc.send with {save:true} directly. */
  async save(_deviceid: string): Promise<void> {}

  /**
   * Open a TCP connection to ip:3333, run the mutual HMAC handshake, and
   * return deviceId = "net:<ip>".
   */
  async connectNet(ip: string, psk: string): Promise<string> {
    return invoke<string>('connect_net', { ip, psk })
  }

  /** Gracefully close a net connection. */
  async disconnectNet(deviceid: string): Promise<void> {
    return invoke<void>('disconnect_net', { deviceId: deviceid })
  }

  /**
   * Subscribe to mDNS-discovered network devices.
   * The Rust mDNS browser emits "net-device-discovered" events.
   */
  onNetDeviceDiscovered(callback: (device: NetDiscoveredDevice) => void): void {
    listen<NetDiscoveredDevice>('net-device-discovered', (event) => {
      callback(event.payload)
    }).catch((err) => {
      console.error('[nanoIpcTauri] Failed to listen for net-device-discovered:', err)
    })
  }

  /** Subscribe to mDNS-lost network devices. */
  onNetDeviceLost(callback: (device: { deviceId: string }) => void): void {
    listen<{ deviceId: string }>('net-device-lost', (event) => {
      callback(event.payload)
    }).catch((err) => {
      console.error('[nanoIpcTauri] Failed to listen for net-device-lost:', err)
    })
  }

}

// Singleton — constructed once when the adapter module is first imported.
const nanoIpcTauri: INanoSerialApi = new NanoIpcTauri()
export default nanoIpcTauri
