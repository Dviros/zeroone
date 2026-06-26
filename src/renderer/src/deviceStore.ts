import { defineStore } from 'pinia'
import { useDebounceFn } from '@vueuse/core'
import { useAppStore } from '@renderer/appStore'
import { randomName } from '@renderer/randomName'

// Generated from https://github.com/katbinaris/NanoD_RatchetH1/blob/runger/communications.md
// Using https://app.quicktype.io/
// WARNING: The tool does 80% of the work, but you need to make sure the types are correct
export interface Profile {
  version: number
  name: string
  desc: string
  profileTag: string
  profileType: number
  profile_type: number
  position_num: number
  attract_distance: number
  feedback_strength: number
  bounce_strength: number
  haptic_click_strength: number
  output_ramp: number
  ledEnable: boolean
  ledBrightness: number
  ledMode: number
  pointer: number
  primary: number
  secondary: number
  buttonAIdle: number
  buttonBIdle: number
  buttonCIdle: number
  buttonDIdle: number
  buttonAPress: number
  buttonBPress: number
  buttonCPress: number
  buttonDPress: number
  guiEnable: boolean
  keys: Key[]
  knob: Value[]
}

export interface Key {
  pressed?: Action[]
  released?: Action[]
  held?: Action[]
}

export interface Action {
  type: string
  keyCodes?: number[]
  channel?: number
  cc?: number
  val?: number
  buttons?: number
  name?: string
}

export interface Value {
  keyState: number
  angleMin: number
  angleMax: number
  valueMin: number
  valueMax: number
  step: number
  wrap: boolean
  type: string
  channel: number
  cc: number
  haptic: HapticSettings
}

export interface HapticSettings {
  mode: number
  startPos: number
  endPos: number
  detentCount: number
  vernier: number
  kxForce: number
  outputRamp: number
  detentStrength: number
}

export interface DeviceSettings {
  debug: boolean
  ledMaxBrightness: number
  maxVelocity: number
  maxVoltage: number
  deviceOrientation: number
  deviceName: string
  serialNumber: string
  firmwareVersion: string
  midiUsb: MidiSettings
  midi2: MidiSettings
  idleTimeout: number
  // WiFi / PD / sprite fields (FW5 contract)
  wifiSsid: string
  wifiPassword: string
  wifiEnabled: boolean
  pdVoltage?: number
  activeSprite?: string
}

// WiFi runtime status pushed by firmware as {"wifi":{status,ip}}
export interface WifiStatus {
  status: 'connected' | 'connecting' | 'disconnected' | 'ap'
  ip?: string
}

// Sprite metadata returned by firmware as {"sprites":[...]}
export interface SpriteInfo {
  name: string
  size?: number
}

export interface MidiSettings {
  in: boolean
  out: boolean
  thru: boolean
  route: boolean
  nano: boolean
}

interface UpdateData {
  idle: number | undefined
  p: number | undefined
  profiles: string[] | undefined
  current: string | undefined
  profile: Profile | undefined
  ks: number | undefined
  kd: number | undefined
  ku: number | undefined
  settings: DeviceSettings | undefined
  error: string | undefined // TODO: Error messages have eventid 'update', change this once it's fixed
  saved: boolean | undefined    // firmware may send {"saved":true} as an update payload
  wifi: WifiStatus | undefined  // runtime wifi status pushed from device
  sprites: SpriteInfo[] | undefined // list of stored sprites
  ack: string | undefined       // ACK command name (FW3 contract)
  ok: boolean | undefined       // ACK result
}

// window.nanoIpc is installed asynchronously by the Tauri bridge (main.ts) AFTER
// this module is first imported. Destructuring here (`const { nanoIpc } = window`)
// froze `undefined`, so initializeDevices() -> nanoIpc.on threw "undefined is not
// an object" and the app rendered black. Resolve window.nanoIpc lazily on every
// access so each call hits the live bridge regardless of import/init order.
const nanoIpc = new Proxy({} as typeof window.nanoIpc, {
  get(_t, prop: string | symbol) {
    const real = window.nanoIpc as unknown as Record<string | symbol, unknown>
    const v = real?.[prop]
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(real) : v
  }
})

const messageCallbacks: ((title: string, message: string) => void)[] = []

// Helper function to create an array with a single value at a specific index
// The idea is to save space by only sending the updated value to the device
// The firmware doesn't appear to handle this correctly atm :(
const createUpdateArray = (index: number, value) => {
  const arr = Array(index + 1).fill({})
  arr[index] = value
  return arr
}

export const useDeviceStore = defineStore('device', {
  state: () => ({
    attachedDeviceIds: [] as string[], // list of attached device ids
    currentDeviceId: null as string | null, // id of the current device
    // mDNS-discovered network devices (populated before any connection)
    discoveredNetDevices: [] as NetDiscoveredDevice[],
    profileNames: [] as string[], // list of profile names
    profiles: [] as Profile[], // list of profiles
    currentProfileName: null as string | null, // name of the current profile
    settings: null as DeviceSettings | null, // settings of the device
    dirtyState: false as boolean, // whether the device state has changed
    position: 0 as number, // current position of the knob
    velocity: 0 as number, // velocity of the knob
    keyLabels: ['a', 'b', 'c', 'd'] as string[], // labels for the keys
    keyStates: {} as Record<string, boolean>, // state of the keys (true if pressed)
    defaultKnobValue: {
      keyState: 0,
      angleMin: 0,
      angleMax: 360,
      valueMin: 0,
      valueMax: 127,
      step: 1,
      wrap: true,
      type: 'midi',
      channel: 1,
      cc: 1,
      haptic: {
        mode: 0,
        startPos: 0,
        endPos: 127,
        detentCount: 127,
        vernier: 0,
        kxForce: 0,
        outputRamp: 200,
        detentStrength: 4
      }
    } as Value,
    defaultKeyAction: { type: 'next_profile' } as Action,
    orientationLabels: [270, 0, 90, 180],
    // WiFi runtime state (populated from incoming {"wifi":{...}} events)
    wifiStatus: null as WifiStatus | null,
    // Sprite list from device
    sprites: [] as SpriteInfo[],
    // Per-pending-ACK callbacks: keyed by command name
    _pendingAcks: {} as Record<string, ((ok: boolean, err?: string) => void)[]>
  }),
  getters: {
    connected: (state) => state.currentDeviceId !== null,
    currentProfile: (state): Profile | null =>
      state.profiles.find((profile) => profile.name === state.currentProfileName) || null,
    profileTags: (state) => [...new Set(state.profiles.map((profile) => profile.profileTag))],
    profilesByTag: (state) =>
      state.profiles.reduce((acc, profile) => {
        if (!acc[profile.profileTag]) {
          acc[profile.profileTag] = []
        }
        acc[profile.profileTag].push(profile)
        return acc
      }, {}),
    keyColor: (state) => (key: string, pressed: boolean) => {
      const propertyName = `button${key.toUpperCase()}${pressed ? 'Press' : 'Idle'}`
      return state.currentProfile ? state.currentProfile[propertyName] : 0
    },
    keyActions: (state) => (key: string) => {
      const keyIndex = state.keyLabels.indexOf(key)
      return (
        state.currentProfile?.keys[keyIndex] ||
        ({
          pressed: [],
          released: [],
          held: []
        } as Key)
      )
    },
    keyState: (state) => {
      // Calculate the key state number from the key states
      let keyState = 0
      if (state.keyStates.a) keyState += 1
      if (state.keyStates.b) keyState += 2
      if (state.keyStates.c) keyState += 4
      if (state.keyStates.d) keyState += 8
      return keyState
    },
    activeValue: (state) => {
      return state.currentProfile?.knob.find((value) => value.keyState === state.keyState) ||
        state.currentProfile?.knob.length > 0
        ? state.currentProfile?.knob[0]
        : null
    }
  },
  actions: {
    setAttachedDeviceIds(deviceIds: string[]) {
      this.attachedDeviceIds = deviceIds
    },
    // ── mDNS net device discovery ─────────────────────────────────────────────
    addDiscoveredNetDevice(device: NetDiscoveredDevice) {
      if (!this.discoveredNetDevices.find((d) => d.deviceId === device.deviceId)) {
        this.discoveredNetDevices.push(device)
      }
    },
    removeDiscoveredNetDevice(deviceId: string) {
      this.discoveredNetDevices = this.discoveredNetDevices.filter((d) => d.deviceId !== deviceId)
    },
    /**
     * Connect to a network device by IP + PSK.
     * Persists the credentials in localStorage keyed by IP so reconnect is one click.
     * Returns the resolved deviceId string on success.
     */
    async connectNetDevice(ip: string, psk: string): Promise<string> {
      const deviceId = await nanoIpc.connectNet(ip, psk)
      // Persist last-used IP+PSK so reconnect is automatic next time
      try {
        const saved: Record<string, string> = JSON.parse(
          localStorage.getItem('net-psk-map') || '{}'
        )
        saved[ip] = psk
        localStorage.setItem('net-psk-map', JSON.stringify(saved))
        // Also store the most-recently-used pair for one-click reconnect
        localStorage.setItem('net-last-ip', ip)
      } catch {
        // localStorage errors are non-fatal
      }
      return deviceId
    },
    /** Return the persisted PSK for a given IP, or '' if not found. */
    getPersistedPsk(ip: string): string {
      try {
        const saved: Record<string, string> = JSON.parse(
          localStorage.getItem('net-psk-map') || '{}'
        )
        return saved[ip] || ''
      } catch {
        return ''
      }
    },
    attachDevice(deviceId: string) {
      if (!this.attachedDeviceIds.includes(deviceId)) {
        this.attachedDeviceIds.push(deviceId)
      }
    },
    selectProfile(profileName: string, updateDevice: boolean = true) {
      this.currentProfileName = profileName
      if (updateDevice) {
        nanoIpc.send(this.currentDeviceId!, JSON.stringify({ current: profileName }))
        this.setDirtyState(true)
      }
    },
    createProfile() {
      let name = randomName()
      let count = 0
      while (this.profileNames.includes(name) && count < 10) {
        name = randomName()
        count++
      }
      if (this.profileNames.includes(name)) {
        let index = 0
        while (this.profileNames.includes(`name (${index})`)) {
          index++
        }
        name = `name (${index})`
      }
      nanoIpc.send(this.currentDeviceId!, JSON.stringify({ profile: name }))
      this.selectProfile(name)
      this.setDirtyState(true)
    },
    addProfile(profile: Profile, updateDevice: boolean = true) {
      if (!this.profileNames.includes(profile.name)) {
        this.profileNames.push(profile.name)
      }
      const existingProfile = this.profiles.find((p) => p.name === profile.name)
      if (existingProfile) {
        Object.assign(existingProfile, profile)
      } else {
        this.profiles.push(profile)
      }
      if (updateDevice) {
        const newProfile = JSON.parse(JSON.stringify(profile))
        delete newProfile.name
        console.log('Sending new profile:', newProfile)
        console.log('with name', profile.name)
        nanoIpc.send(
          this.currentDeviceId!,
          JSON.stringify({ profile: profile.name, updates: newProfile })
        )
        this.setDirtyState(true)
      }
    },
    renameProfile(oldName: string, newName: string, updateDevice: boolean = true) {
      if (this.profileNames.includes(newName)) {
        console.error('Profile name already exists:', newName)
      }
      const profile = this.profiles.find((p) => p.name === oldName)
      if (profile) {
        profile.name = newName
        if (updateDevice) {
          nanoIpc.send(
            this.currentDeviceId!,
            JSON.stringify({ profile: oldName, updates: { name: newName } })
          )
        }
        this.setDirtyState(true)
      }
    },
    deleteProfile(profileName: string, updateDevice: boolean = true) {
      const index = this.profileNames.indexOf(profileName)
      if (index !== -1) {
        this.profileNames.splice(index, 1)
      }
      const profile = this.profiles.find((p) => p.name === profileName)
      if (profile) {
        const profileIndex = this.profiles.indexOf(profile)
        this.profiles.splice(profileIndex, 1)
      }
      if (this.currentProfileName === profileName && this.profileNames.length > 0) {
        this.selectProfile(this.profileNames[0], updateDevice)
      }
      if (updateDevice) {
        nanoIpc.send(this.currentDeviceId!, JSON.stringify({ profiles: this.profileNames }))
        this.setDirtyState(true)
      }
    },
    duplicateProfile(profileName: string, updateDevice: boolean = true) {
      const profile = this.profiles.find((p) => p.name === profileName)
      if (profile) {
        const newProfile = JSON.parse(JSON.stringify(profile))
        newProfile.name = profileName + ' Copy'
        this.addProfile(newProfile, updateDevice)
        if (this.currentProfileName === profileName) {
          this.selectProfile(newProfile.name, updateDevice)
        }
        this.setDirtyState(true)
      }
    },
    updateProfileDescription(
      profileName: string,
      description: string,
      updateDevice: boolean = true
    ) {
      const profile = this.profiles.find((p) => p.name === profileName)
      if (profile) {
        profile.desc = description
        if (updateDevice) {
          nanoIpc.send(
            this.currentDeviceId!,
            JSON.stringify({ profile: profileName, updates: { desc: description } })
          )
          this.setDirtyState(true)
        }
      }
    },
    detachDevice(deviceId: string) {
      const index = this.attachedDeviceIds.indexOf(deviceId)
      if (index !== -1) {
        this.attachedDeviceIds.splice(index, 1)
      }
    },
    connectDevice(deviceId: string | undefined = undefined, updateDevice: boolean = true) {
      if (deviceId) {
        this.currentDeviceId = deviceId
        this.setDirtyState(false)
        if (updateDevice) {
          nanoIpc.connect(deviceId)
        }
      } else if (this.attachedDeviceIds.length > 0) {
        this.connectDevice(this.attachedDeviceIds[0])
      }
    },
    disconnectDevice(deviceId: string, updateDevice: boolean = true) {
      if (this.currentDeviceId === deviceId) this.currentDeviceId = null
      this.setDirtyState(false)
      // Net devices are connections, not attached hardware — drop from the list so
      // the device picker reflects reality. Serial removal is driven by 'device-detached'.
      if (deviceId.startsWith('net:')) {
        const i = this.attachedDeviceIds.indexOf(deviceId)
        if (i !== -1) this.attachedDeviceIds.splice(i, 1)
      }
      if (updateDevice) {
        // Route to the correct transport so the socket actually closes.
        if (deviceId.startsWith('net:')) nanoIpc.disconnectNet(deviceId)
        else nanoIpc.disconnect(deviceId)
      }
    },
    setDirtyState(dirty: boolean) {
      this.dirtyState = dirty
    },
    saveChangesOnDevice() {
      nanoIpc.send(this.currentDeviceId!, JSON.stringify({ save: true }))
      this.setDirtyState(false)
    },
    setSettings(settings: DeviceSettings, updateDevice: boolean = true) {
      this.settings = settings
      if (updateDevice) {
        nanoIpc.send(this.currentDeviceId!, JSON.stringify({ settings }))
        this.setDirtyState(true)
      }
    },
    setProfileNames(profileNames: string[], updateDevice: boolean = true) {
      this.profileNames = profileNames
      if (updateDevice) {
        nanoIpc.send(this.currentDeviceId!, JSON.stringify({ profiles: profileNames }))
        this.setDirtyState(true)
      }
    },
    setCurrentProfile(profileName: string, updateDevice: boolean = true) {
      this.currentProfileName = profileName
      if (updateDevice) {
        nanoIpc.send(this.currentDeviceId!, JSON.stringify({ current: profileName }))
        this.setDirtyState(true)
      }
    },
    setOrientation(orientation: number, updateDevice: boolean = true) {
      this.settings!.deviceOrientation = orientation
      if (updateDevice) {
        sendDebounced(
          this.currentDeviceId!,
          JSON.stringify({ settings: { deviceOrientation: orientation } })
        )
        this.setDirtyState(true)
      }
    },
    cycleOrientation() {
      this.setOrientation((this.settings!.deviceOrientation + 1) % this.orientationLabels.length)
    },
    setIdleTimeout(timeout: number, updateDevice: boolean = true) {
      this.settings!.idleTimeout = timeout
      if (updateDevice) {
        sendDebounced(this.currentDeviceId!, JSON.stringify({ settings: { idleTimeout: timeout } }))
        this.setDirtyState(true)
      }
    },
    cycleIdleTimeout() {
      if (this.settings!.idleTimeout === 999999999) {
        this.setIdleTimeout(10000)
      } else if (this.settings!.idleTimeout === 10000) {
        this.setIdleTimeout(30000)
      } else if (this.settings!.idleTimeout === 30000) {
        this.setIdleTimeout(60000)
      } else {
        this.setIdleTimeout(999999999)
      }
    },
    setPosition(position: number) {
      this.position = position
    },
    setKeyColor(key: string, pressed: boolean, color: number, updateDevice: boolean = true) {
      const propertyName = `button${key.toUpperCase()}${pressed ? 'Press' : 'Idle'}`
      this.currentProfile![propertyName] = color
      if (updateDevice) {
        sendDebounced(
          this.currentDeviceId!,
          JSON.stringify({ profile: this.currentProfileName, updates: { [propertyName]: color } })
        )
        this.setDirtyState(true)
      }
    },
    setPrimaryColor(color: number, updateDevice: boolean = true) {
      this.currentProfile!.primary = color
      if (updateDevice) {
        sendDebounced(
          this.currentDeviceId!,
          JSON.stringify({ profile: this.currentProfileName, updates: { primary: color } })
        )
        this.setDirtyState(true)
      }
    },
    setSecondaryColor(color: number, updateDevice: boolean = true) {
      this.currentProfile!.secondary = color
      if (updateDevice) {
        sendDebounced(
          this.currentDeviceId!,
          JSON.stringify({ profile: this.currentProfileName, updates: { secondary: color } })
        )
        this.setDirtyState(true)
      }
    },
    setPointerColor(color: number, updateDevice: boolean = true) {
      this.currentProfile!.pointer = color
      if (updateDevice) {
        sendDebounced(
          this.currentDeviceId!,
          JSON.stringify({ profile: this.currentProfileName, updates: { pointer: color } })
        )
        this.setDirtyState(true)
      }
    },
    setKeyPressedActions(key: string, actions: Action[], updateDevice: boolean = true) {
      const keyIndex = this.keyLabels.indexOf(key)
      this.currentProfile!.keys[keyIndex].pressed = actions
      if (updateDevice) {
        sendDebounced(
          this.currentDeviceId!,
          JSON.stringify({
            profile: this.currentProfileName,
            updates: { keys: this.currentProfile!.keys }
          })
        )
        this.setDirtyState(true)
      }
    },
    setKeyReleasedActions(key: string, actions: Action[], updateDevice: boolean = true) {
      const keyIndex = this.keyLabels.indexOf(key)
      this.currentProfile!.keys[keyIndex].released = actions
      if (updateDevice) {
        sendDebounced(
          this.currentDeviceId!,
          JSON.stringify({
            profile: this.currentProfileName,
            updates: { keys: this.currentProfile!.keys }
          })
        )
        this.setDirtyState(true)
      }
    },
    setKeyHeldActions(key: string, actions: Action[], updateDevice: boolean = true) {
      const keyIndex = this.keyLabels.indexOf(key)
      this.currentProfile!.keys[keyIndex].held = actions
      if (updateDevice) {
        sendDebounced(
          this.currentDeviceId!,
          JSON.stringify({
            profile: this.currentProfileName,
            updates: { keys: this.currentProfile!.keys }
          })
        )
        this.setDirtyState(true)
      }
    },
    setKnobValues(values: Value[], updateDevice: boolean = true) {
      this.currentProfile!.knob = values
      if (updateDevice) {
        sendDebounced(
          this.currentDeviceId!,
          JSON.stringify({ profile: this.currentProfileName, updates: { knob: values } })
        )
        this.setDirtyState(true)
      }
    },
    addKnobValue(value: Value | null = null, updateDevice: boolean = true) {
      if (!value) {
        value = JSON.parse(JSON.stringify(this.defaultKnobValue)) as Value
        let lowestKeyState = 0
        this.currentProfile!.knob.forEach((v) => {
          if (v.keyState > lowestKeyState) {
            lowestKeyState = v.keyState
          }
        })
        value.keyState = (lowestKeyState + 1) % 16
      }
      this.currentProfile!.knob.push(value)
      if (updateDevice) {
        sendDebounced(
          this.currentDeviceId!,
          JSON.stringify({
            profile: this.currentProfileName,
            updates: { knob: this.currentProfile!.knob }
          })
        )
        this.setDirtyState(true)
      }
    },
    removeKnobValue(index: number, updateDevice: boolean = true) {
      this.currentProfile!.knob.splice(index, 1)
      if (updateDevice) {
        sendDebounced(
          this.currentDeviceId!,
          JSON.stringify({
            profile: this.currentProfileName,
            updates: { knob: this.currentProfile!.knob }
          })
        )
        this.setDirtyState(true)
      }
    },
    updateKnobValueParameter(index: number, updates: object, updateDevice: boolean = true) {
      Object.assign(this.currentProfile!.knob[index], updates)
      if (updateDevice) {
        sendDebounced(
          this.currentDeviceId!,
          JSON.stringify({
            profile: this.currentProfileName,
            updates: { knob: this.currentProfile!.knob }
          })
        )
        this.setDirtyState(true)
      }
    },
    addKeyAction(
      action: Action | null = null,
      key: string,
      trigger: number,
      updateDevice: boolean = true
    ) {
      if (!action) {
        action = JSON.parse(JSON.stringify(this.defaultKeyAction)) as Action
      }
      const keyIndex = this.keyLabels.indexOf(key)
      if (trigger === 0) {
        if (!this.currentProfile!.keys[keyIndex].pressed) {
          this.currentProfile!.keys[keyIndex].pressed = []
        }
        this.currentProfile!.keys[keyIndex].pressed!.push(action)
      } else if (trigger === 1) {
        if (!this.currentProfile!.keys[keyIndex].released) {
          this.currentProfile!.keys[keyIndex].released = []
        }
        this.currentProfile!.keys[keyIndex].released!.push(action)
      } else if (trigger === 2) {
        if (!this.currentProfile!.keys[keyIndex].held) {
          this.currentProfile!.keys[keyIndex].held = []
        }
        this.currentProfile!.keys[keyIndex].held!.push(action)
      }
      if (updateDevice) {
        sendDebounced(
          this.currentDeviceId!,
          JSON.stringify({
            profile: this.currentProfileName,
            updates: { keys: this.currentProfile!.keys }
          })
        )
        this.setDirtyState(true)
      }
    },
    removeKeyAction(index: number, key: string, trigger: number, updateDevice: boolean = true) {
      const keyIndex = this.keyLabels.indexOf(key)
      if (trigger === 0) {
        this.currentProfile!.keys[keyIndex].pressed!.splice(index, 1)
      } else if (trigger === 1) {
        this.currentProfile!.keys[keyIndex].released!.splice(index, 1)
      } else if (trigger === 2) {
        this.currentProfile!.keys[keyIndex].held!.splice(index, 1)
      }
      if (updateDevice) {
        sendDebounced(
          this.currentDeviceId!,
          JSON.stringify({
            profile: this.currentProfileName,
            updates: { keys: this.currentProfile!.keys }
          })
        )
        this.setDirtyState(true)
      }
    },
    updateKeyActionParameter(
      index: number,
      key: string,
      trigger: number,
      updates: object,
      updateDevice: boolean = true
    ) {
      const keyIndex = this.keyLabels.indexOf(key)
      if (trigger === 0) {
        Object.assign(this.currentProfile!.keys[keyIndex].pressed![index], updates)
      } else if (trigger === 1) {
        Object.assign(this.currentProfile!.keys[keyIndex].released![index], updates)
      } else if (trigger === 2) {
        Object.assign(this.currentProfile!.keys[keyIndex].held![index], updates)
      }
      if (updateDevice) {
        sendDebounced(
          this.currentDeviceId!,
          JSON.stringify({
            profile: this.currentProfileName,
            updates: { keys: this.currentProfile!.keys }
          })
        )
        this.setDirtyState(true)
      }
    },
    setHapticOutputRamp(value: number, updateDevice: boolean = true) {
      this.currentProfile!.knob.forEach((v) => {
        v.haptic.outputRamp = value
      })
      if (updateDevice) {
        sendDebounced(
          this.currentDeviceId!,
          JSON.stringify({
            profile: this.currentProfileName,
            updates: {
              knob: this.currentProfile!.knob.map((v) => ({
                haptic: { outputRamp: v.haptic.outputRamp },
                type: v.type
              }))
            }
          })
        )
        this.setDirtyState(true)
      }
    },
    setHapticFeedbackStrength(value: number, updateDevice: boolean = true) {
      this.currentProfile!.knob.forEach((v) => {
        v.haptic.detentStrength = value
      })
      if (updateDevice) {
        sendDebounced(
          this.currentDeviceId!,
          JSON.stringify({
            profile: this.currentProfileName,
            updates: {
              knob: this.currentProfile!.knob.map((v) => ({
                haptic: { detentStrength: v.haptic.detentStrength },
                type: v.type
              }))
            }
          })
        )
        this.setDirtyState(true)
      }
    },

    // ── WiFi ──────────────────────────────────────────────────────────────────
    /** Send WiFi credentials + enabled flag to the firmware. */
    setWifi(ssid: string, password: string, enabled: boolean) {
      if (!this.currentDeviceId) return
      nanoIpc.send(
        this.currentDeviceId,
        JSON.stringify({ wifi: { ssid, password, enabled } })
      )
      // Optimistically reflect in settings so UI stays consistent
      if (this.settings) {
        this.settings.wifiSsid = ssid
        this.settings.wifiPassword = password
        this.settings.wifiEnabled = enabled
      }
    },

    /** Called by event handler when device pushes {"wifi":{...}}. */
    setWifiStatus(status: WifiStatus) {
      this.wifiStatus = status
    },

    // ── Sprites ───────────────────────────────────────────────────────────────
    /** Request sprite list from device. */
    requestSpriteList() {
      if (!this.currentDeviceId) return
      nanoIpc.send(this.currentDeviceId, JSON.stringify({ sprite: { op: 'list' } }))
    },

    /** Update local sprite list (set by event handler from {"sprites":[...]} push). */
    setSpriteList(sprites: SpriteInfo[]) {
      this.sprites = sprites
    },

    /** Select an active sprite (per-profile or global). */
    selectSprite(name: string) {
      if (!this.currentDeviceId) return
      nanoIpc.send(this.currentDeviceId, JSON.stringify({ sprite: { op: 'select', name } }))
      if (this.settings) this.settings.activeSprite = name
    },

    /** Delete a sprite by name. */
    deleteSprite(name: string) {
      if (!this.currentDeviceId) return
      nanoIpc.send(this.currentDeviceId, JSON.stringify({ sprite: { op: 'delete', name } }))
      this.sprites = this.sprites.filter((s) => s.name !== name)
    },

    /**
     * Chunked sprite upload. Reads `file` as base64 in 1KB chunks and emits
     * sprite begin / data / end commands over the serial JSON channel.
     * `onProgress` receives [0..1]. Returns a Promise that resolves when done.
     */
    async uploadSprite(
      file: File,
      onProgress?: (progress: number) => void
    ): Promise<void> {
      if (!this.currentDeviceId) throw new Error('No device connected')
      // 1024 raw bytes → ~1.4KB base64 → JSON frame well under 1.5KB serial limit
      const CHUNK_SIZE = 1024
      const deviceId = this.currentDeviceId
      const name = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')

      const arrayBuffer = await file.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)
      const totalChunks = Math.ceil(bytes.length / CHUNK_SIZE)

      // Encode a Uint8Array slice to base64 without atob/btoa size limits
      const toBase64 = (chunk: Uint8Array): string => {
        let binary = ''
        for (let i = 0; i < chunk.length; i++) binary += String.fromCharCode(chunk[i])
        return btoa(binary)
      }

      // CRC-32 (IEEE 802.3 / zlib): polynomial 0xEDB88320, init 0xFFFFFFFF, final XOR 0xFFFFFFFF.
      // Accumulates incrementally over all raw bytes so we can stream chunks without buffering twice.
      let crcState = 0xffffffff
      const crc32Update = (state: number, data: Uint8Array): number => {
        let c = state
        for (let i = 0; i < data.length; i++) {
          c ^= data[i]
          for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
          }
        }
        return c
      }

      // begin
      nanoIpc.send(
        deviceId,
        JSON.stringify({ sprite: { op: 'begin', name, size: bytes.length } })
      )

      for (let i = 0; i < totalChunks; i++) {
        const slice = bytes.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
        // Accumulate CRC over the raw bytes of this chunk (same bytes being base64-encoded)
        crcState = crc32Update(crcState, slice)
        nanoIpc.send(
          deviceId,
          JSON.stringify({ sprite: { op: 'data', name, seq: i, data: toBase64(slice) } })
        )
        onProgress?.((i + 1) / totalChunks)
        // Yield to the event loop so the UI can update between chunks
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }

      // Finalise CRC-32: XOR with 0xFFFFFFFF and force unsigned 32-bit
      const crc32 = ((crcState ^ 0xffffffff) >>> 0)

      // end — send computed CRC so firmware can verify the received bytes
      nanoIpc.send(deviceId, JSON.stringify({ sprite: { op: 'end', name, crc32 } }))
    },

    // ── Integrations ─────────────────────────────────────────────────────────
    /** Send an integration enable/configure command. */
    setIntegration(integrationId: string, enabled: boolean, params: Record<string, unknown> = {}) {
      if (!this.currentDeviceId) return
      nanoIpc.send(
        this.currentDeviceId,
        JSON.stringify({ integration: { id: integrationId, enabled, params } })
      )
    },

    // ── ACK plumbing ─────────────────────────────────────────────────────────
    /** Register a one-shot callback for an ACK response from the firmware. */
    _onAck(cmd: string, cb: (ok: boolean, err?: string) => void) {
      if (!this._pendingAcks[cmd]) this._pendingAcks[cmd] = []
      this._pendingAcks[cmd].push(cb)
    },

    /** Dispatch an incoming ACK to waiting callbacks. */
    _dispatchAck(cmd: string, ok: boolean, err?: string) {
      const cbs = this._pendingAcks[cmd] || []
      this._pendingAcks[cmd] = []
      cbs.forEach((cb) => cb(ok, err))
    }
  }
})

const sendDebounced = useDebounceFn((deviceid, jsonstr) => nanoIpc.send(deviceid, jsonstr), 10, {
  maxWait: 20
})

export const initializeDevices = () => {
  const deviceStore = useDeviceStore()
  const appStore = useAppStore()

  // register event handlers
  nanoIpc.on((eventid, deviceid, dataString) => {
    //console.log('Received event', eventid, deviceid, dataString)
    if (eventid === 'error' || (eventid === 'update' && dataString.includes('error'))) {
      // TODO: Error messages have eventid 'update', change this once it's fixed
      const data = JSON.parse(dataString) as UpdateData
      if (data.error) {
        messageCallbacks.forEach((callback) => callback('Error', data.error as string))
        console.error('Error:', data.error)
      }
    }
    if (eventid === 'saved') {
      deviceStore.setDirtyState(false)
      messageCallbacks.forEach((callback) => callback('Saved', 'Changes saved to device'))
    }
    // Bug fix: firmware also sends {"saved":true} inside an 'update' payload — handled below
    if (eventid === 'device-attached') {
      deviceStore.attachDevice(deviceid)
      console.log('Attached device', deviceid)
      if (deviceStore.attachedDeviceIds.length === 1) {
        deviceStore.connectDevice(deviceid)
      }
    }
    if (eventid === 'device-detached') {
      deviceStore.detachDevice(deviceid)
      console.log('Detached device', deviceid)
    }
    if (eventid === 'connected') {
      deviceStore.connectDevice(deviceid, false)
      console.log('Connected device', deviceid)
      nanoIpc.send(deviceid, JSON.stringify({ profiles: '#all', settings: '?' }))
    }
    if (eventid === 'disconnected') {
      deviceStore.disconnectDevice(deviceid, false)
      console.log('Disconnected device', deviceid)
    }
    if (eventid === 'update') {
      let update: UpdateData = {} as UpdateData
      if (dataString) {
        try {
          update = JSON.parse(dataString) as UpdateData
        } catch (e) {
          console.error('Failed to parse update data:', e, dataString)
        }
      }
      if (!update.idle && !update.p && !update.ks) {
        console.log('Received update:', update)
      }
      if (update.p !== undefined) {
        deviceStore.setPosition(update.p)
        if (appStore.selectOnInput) appStore.selectConfigFeature('knob')
      }
      if (update.kd !== undefined) {
        const keyLabel = deviceStore.keyLabels[update.kd]
        deviceStore.keyStates[keyLabel] = true
        if (appStore.selectOnInput) appStore.selectKey(keyLabel)
      }
      if (update.ku !== undefined) {
        deviceStore.keyStates[deviceStore.keyLabels[update.ku]] = false
      }
      if (update.profiles !== undefined) {
        deviceStore.setProfileNames(update.profiles, false)
        update.profiles.forEach((profileName, i) => {
          setTimeout(function timer() {
            console.log('Requesting profile', profileName)
            nanoIpc.send(deviceid, JSON.stringify({ profile: profileName }))
          }, i * 30)
        })
      }
      if (update.current !== undefined) {
        deviceStore.setCurrentProfile(update.current, false)
      }
      if (update.profile !== undefined) {
        deviceStore.addProfile(update.profile, false)
      }
      if (update.settings !== undefined) {
        deviceStore.setSettings(update.settings, false)
      }
      // Bug fix: firmware sends {"saved":true} as an update payload, not as eventid='saved'
      if (update.saved === true) {
        deviceStore.setDirtyState(false)
        messageCallbacks.forEach((callback) => callback('Saved', 'Changes saved to device'))
      }
      // WiFi runtime status pushed from device
      if (update.wifi !== undefined) {
        deviceStore.setWifiStatus(update.wifi)
      }
      // Sprite list pushed from device (after a list command or after an upload)
      if (update.sprites !== undefined) {
        deviceStore.setSpriteList(update.sprites)
      }
      // ACK dispatch for config/mutating commands (FW3 contract)
      if (update.ack !== undefined) {
        deviceStore._dispatchAck(update.ack, update.ok ?? false,
          update.ok ? undefined : (update as unknown as { error?: string }).error)
      }
    }
  })

  // Register mDNS discovery handlers so network devices appear before connecting
  nanoIpc.onNetDeviceDiscovered((device) => {
    deviceStore.addDiscoveredNetDevice(device)
    // Auto-connect if we already have a PSK cached for this device (mirrors the
    // Electron one-click reconnect). First-time connect still needs a manual PSK
    // entry via the Devices menu; after that it reconnects automatically.
    if (!deviceStore.connected) {
      const psk = deviceStore.getPersistedPsk(device.ip)
      if (psk) {
        deviceStore
          .connectNetDevice(device.ip, psk)
          .catch((e) => console.error('[net] auto-connect failed:', e))
      }
    }
  })
  nanoIpc.onNetDeviceLost((payload) => {
    deviceStore.removeDiscoveredNetDevice(payload.deviceId)
  })

  // get initial device list
  nanoIpc.listAttachedDevices().then((deviceIds) => {
    deviceStore.setAttachedDeviceIds(deviceIds)
    if (!deviceStore.connected && deviceIds.length > 0) {
      nanoIpc.connect(deviceIds[0]).catch((e) => {
        console.error(e)
        console.log('Serial port might still be open, requesting profiles...')
        deviceStore.connectDevice(deviceIds[0], false)
        nanoIpc.send(deviceIds[0], JSON.stringify({ profiles: '#all', settings: '?' }))
      })
    }
  })
}

export const onDeviceMessage = (callback: (title: string, message: string) => void) => {
  messageCallbacks.push(callback)
}
