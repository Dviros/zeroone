export interface INanoSerialApi {
  listAttachedDevices(): Promise<string[]>
  connect(deviceid: string): Promise<string>
  disconnect(deviceid: string): Promise<string>
  on(callback: (eventid: string, deviceid: string, data: string) => void): void
  send(deviceid: string, jsonstr: string): Promise<void>
  save(deviceid: string): Promise<void>
  /** Open a TCP connection to ip:3333, run mutual-auth HMAC handshake, resolve with deviceId. */
  connectNet(ip: string, psk: string): Promise<string>
  /** Gracefully close a net connection. */
  disconnectNet(deviceid: string): Promise<void>
}

export interface IElectronApi {
  platform: NodeJS.Platform
  isDevelopment: boolean
  minimizeWindow: () => void
  toggleMaximizeWindow: () => void
  closeWindow: () => void
  openExternal: (url: string) => void
  onMaximized: (callback: () => void) => void
  onUnmaximized: (callback: () => void) => void
  onMenu: (callback: (key: string) => void) => void
  openDevTools: () => void
  reload: () => void
}

declare global {
  interface Window {
    nanoIpc: INanoSerialApi
    appIpc: IElectronApi
  }
}
