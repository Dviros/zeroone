# ZeroOne — Install (macOS)

ZeroOne is the desktop config app for the Nano_D++ knob — haptic profiles, LED ring,
button/action mapping, and the music profile.

## Download

Grab `ZeroOne_<version>_aarch64.dmg` from the
[Releases page](https://github.com/Dviros/zeroone/releases) (Apple Silicon build).

## Install

1. Open the `.dmg` and drag **ZeroOne** into **Applications**.
2. The build is **unsigned**, so Gatekeeper blocks the first launch. Either:
   - Right-click **ZeroOne.app** → **Open** → **Open**, or
   - `xattr -dr com.apple.quarantine /Applications/ZeroOne.app`

## Apple Silicon only

The shipped `.dmg` is `aarch64` (M1/M2/M3…). On an Intel Mac, build from source:

```bash
pnpm install
pnpm build      # → src-tauri/target/release/bundle/dmg/
```

## Music profile (album art + seek + volume)

The on-device music profile (album cover, LED-ring seek bar, native volume screen)
is driven by the **macOS bridge**, not this app. See
[NanoD-Integrations / macos](https://github.com/Dviros/NanoD-Integrations/tree/feat/nanod-v1.1.0/macos):
run `nanod-bridge.py`, build `volctl.swift`, and set `~/.config/nanod/bridge.json`
(`"artwork": true`, `"player": "Music"` | `"Spotify"`).
