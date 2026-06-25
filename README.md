# ZERO/ONE

Haptic configuration suite for [Binaris Devices](https://store.binaris.io/).

![zeroone-screenshot](https://github.com/katbinaris/zeroone/assets/34353377/7c9f576d-e142-4de2-a58f-ebb83ff6a472)

> Signed builds are coming soon. Until then, build and run the app locally as described below.

---

## How to run from source

**Requirements:** Node.js 20 or later, [pnpm](https://pnpm.io/installation)

```bash
# Install dependencies
pnpm i

# Development mode
pnpm dev

# Production builds
pnpm build:win
pnpm build:mac
pnpm build:linux
```

Built output is placed in `dist/`.

We recommend [VSCode](https://code.visualstudio.com/) with the included recommended extensions.

ZERO/ONE is built with [electron-vite](https://electron-vite.org/), [Vue.js](https://vuejs.org/), and [shadcn-vue](https://www.shadcn-vue.com/).

---

## Transport

ZERO/ONE communicates with the device over **USB serial** using the Binaris JSON protocol (documented in `fw/communications.md`). Each JSON message is newline-delimited.

When the device firmware is built with `-DWIFI_ENABLED`, the same JSON protocol is also available over **WebSocket** at `ws://<device-ip>/ws`. The app connects via serial by default; WiFi/WS support is a planned transport option.

---

## Features

### Profile management

- Create, rename, duplicate, and delete profiles stored on the device.
- Drag-and-drop profile reordering.
- Per-profile haptic, LED, key, and knob configuration.

### Knob configuration

- Map the knob to MIDI CC, gamepad axis, mouse scroll, or profile switching.
- Set angle range, value range, step size, and wrap behaviour.
- Configure haptic detents (mode, count, start/end position, strength, output ramp).

### Key configuration

- Configure pressed, released, and held actions per key (A/B/C/D).
- Action types: MIDI CC, keyboard HID, mouse button, gamepad button, profile switch (next/prev/named).

### LED configuration

- Per-profile ring and button colours (primary, secondary, pointer, per-key idle/press).
- Brightness capped by `ledMaxBrightness` device setting.

### Device settings

- Device name, orientation, LED max brightness, idle timeout, MIDI USB and DIN routing.

### WiFi (`config/wifi/WiFiConfig.vue`)

Requires firmware built with `-DWIFI_ENABLED`.

- Enable/disable WiFi on the device.
- Enter SSID and password; credentials are sent as:
  ```json
  { "wifi": { "ssid": "MyNet", "password": "secret", "enabled": true } }
  ```
- The panel displays live connection status (`connected` / `connecting` / `ap` / `disconnected`) and IP address, pushed from the device as `{ "wifi": { "status": "connected", "ip": "192.168.1.42" } }`.
- The device responds with `{ "ack": "wifi", "ok": true }` or `{ "ack": "wifi", "ok": false, "error": "..." }`.

If no credentials are stored, the device starts a SoftAP named `NanoD-Setup` with a provisioning page at `http://192.168.4.1/`.

### Sprites (`config/sprites/SpriteConfig.vue`)

Upload PNG images to the device's LittleFS filesystem for display on the GC9A01 screen.

- Drag-and-drop or file-picker upload (PNG only).
- Uploads are chunked in 4 KB base64 segments using the sprite protocol:
  ```json
  { "sprite": { "op": "begin", "name": "foo.png", "size": 12345 } }
  { "sprite": { "op": "data",  "name": "foo.png", "seq": 0, "data": "<base64>" } }
  { "sprite": { "op": "end",   "name": "foo.png", "crc32": 1234567890 } }
  ```
  The firmware validates byte count and CRC-32 before committing the file.
- List stored sprites: `{ "sprite": { "op": "list" } }`
- Set active sprite: `{ "sprite": { "op": "select", "name": "foo.png" } }`
- Delete a sprite: `{ "sprite": { "op": "delete", "name": "foo.png" } }`
- Device limits: 16 sprites max, 64 KB per sprite, 512 KB total.

### Integrations (`config/integrations/IntegrationsConfig.vue`)

Enable and configure optional device integrations:

| Integration | ID | Parameters |
|---|---|---|
| MIDI Clock Sync | `midi_clock` | `bpm` |
| HID Extra Keys | `hid_extra` | — |
| HTTP Webhook | `http_webhook` | `url`, `token` |

Commands are sent as:
```json
{ "integration": { "id": "http_webhook", "enabled": true, "params": { "url": "http://..." } } }
```
The device responds with `{ "ack": "integration", "ok": true }`.

---

## JSON protocol — command reference

All mutating commands receive an ACK:

```json
{ "ack": "<command>", "ok": true }
{ "ack": "<command>", "ok": false, "error": "human-readable reason" }
```

Commands implemented in the current firmware and app:

| Command key | Direction | Purpose |
|---|---|---|
| `profiles` | host→device | List all / reorder profiles |
| `profile` | both | Get or update a profile |
| `current` | both | Get or set the active profile |
| `settings` | both | Get or update device settings |
| `save` | host→device | Persist settings + profiles to LittleFS |
| `load` | host→device | Reload from LittleFS |
| `recalibrate` | host→device | Trigger motor recalibration |
| `message` | host→device | Display a message on the device screen |
| `screen` | host→device | Update the default LCD data fields |
| `wifi` | host→device | Set WiFi credentials and enabled state |
| `sprite` | host→device | Upload / list / select / delete sprites |
| `integration` | host→device | Enable/configure an integration |
| `R` | host→device | Raw SimpleFOC motor commander string |

Telemetry pushed by the device:

```json
{ "p": 42, "a": 4.16, "t": -2, "v": -7.78 }
// p = position (legacy uint16), a = shaft angle (rad),
// t = integer turns, v = velocity (rad/s)

{ "kd": 0, "ks": 1 }   // key-down: key index, key-state bitmask
{ "ku": 0, "ks": 0 }   // key-up

{ "idle": 16233 }       // ms since last interaction
{ "saved": true }
{ "error": "..." }
{ "debug": "..." }
{ "wifi": { "status": "connected", "ip": "192.168.1.42" } }
{ "sprites": [{ "name": "foo.png", "size": 8192 }] }
```

Full protocol documentation is in `fw/communications.md`.
