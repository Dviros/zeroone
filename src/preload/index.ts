import { contextBridge, ipcRenderer } from 'electron'

// expose an API to choose available devices
contextBridge.exposeInMainWorld('nanoIpc', {
  listAttachedDevices() {
    return ipcRenderer.invoke('nanoSerialApi:list_devices')
  },
  connect(deviceid) {
    return ipcRenderer.invoke('nanoSerialApi:connect', deviceid)
  },
  disconnect(deviceid) {
    // Routes to nanoNetApi or nanoSerialApi in main process based on deviceId prefix.
    return ipcRenderer.invoke('nanoSerialApi:disconnect', deviceid)
  },
  on(callback) {
    ipcRenderer.on('nanoSerialApi:event', (_event, eventid, deviceid, data) => {
      callback(eventid, deviceid, data)
    })
  },
  send(deviceid, jsonstr) {
    // The renderer already JSON.stringify()s every payload (see deviceStore.ts).
    // Do NOT stringify again — double-encoding sends a quoted string like
    // "{\"settings\":\"?\"}" which the firmware parses as a string, matches no
    // command, and silently never replies. Pass the string through unchanged.
    // Routes to nanoNetApi or nanoSerialApi in main process based on deviceId prefix.
    return ipcRenderer.invoke('nanoSerialApi:send', deviceid, jsonstr)
  },
  connectNet(ip: string, psk: string) {
    // Open a TCP socket to ip:3333, run the HMAC handshake, resolve with deviceId.
    return ipcRenderer.invoke('nanoNet:connect', ip, psk)
  },
  disconnectNet(deviceid: string) {
    return ipcRenderer.invoke('nanoNet:disconnect', deviceid)
  },
  /** Subscribe to mDNS net-device-discovered events. */
  onNetDeviceDiscovered(
    callback: (device: { deviceId: string; ip: string; name: string }) => void
  ) {
    ipcRenderer.on('net-device-discovered', (_event, device) => callback(device))
  },
  /** Subscribe to mDNS net-device-lost events. */
  onNetDeviceLost(callback: (device: { deviceId: string }) => void) {
    ipcRenderer.on('net-device-lost', (_event, device) => callback(device))
  },
  /** Ask the main process to re-run the mDNS browse cycle. */
  mdnsRescan() {
    return ipcRenderer.invoke('nanoNet:mdns-rescan')
  }
})

contextBridge.exposeInMainWorld('appIpc', {
  platform: process.platform,
  isDevelopment: process.env.NODE_ENV !== 'production',
  minimizeWindow: () => ipcRenderer.send('electron:minimizeWindow'),
  toggleMaximizeWindow: () => ipcRenderer.send('electron:toggleMaximizeWindow'),
  closeWindow: () => ipcRenderer.send('electron:closeWindow'),
  openExternal: (url) => ipcRenderer.send('electron:openExternal', url),
  onMaximized: (callback) => ipcRenderer.on('electron:maximized', callback),
  onUnmaximized: (callback) => ipcRenderer.on('electron:unmaximized', callback),
  onMenu: (callback) =>
    ipcRenderer.on('electron:menu', (_event, key) => {
      callback(key)
    }),
  openDevTools: () => ipcRenderer.send('electron:openDevTools'),
  reload: () => ipcRenderer.send('electron:reload')
})
