// Tauri command handlers — all functions annotated with #[tauri::command] are
// gathered here so they are not in the same scope as generate_handler!, which
// would cause "macro defined multiple times" compile errors.

use tauri::{AppHandle, State};
use crate::AppState;

// ── Bridge config (~/.config/nanod/bridge.json) ───────────────────────────────

fn bridge_config_path() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME env not set".to_string())?;
    Ok(std::path::PathBuf::from(home).join(".config").join("nanod").join("bridge.json"))
}

/// Write the bridge config JSON string to ~/.config/nanod/bridge.json.
/// Creates the directory if it does not exist.
#[tauri::command]
pub fn write_bridge_config(json: String) -> Result<(), String> {
    let path = bridge_config_path()?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, json.as_bytes()).map_err(|e| e.to_string())
}

/// Read the bridge config JSON string from ~/.config/nanod/bridge.json.
/// Returns an empty string if the file does not exist yet.
#[tauri::command]
pub fn read_bridge_config() -> Result<String, String> {
    let path = bridge_config_path()?;
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// List serial devices that match the Nano VID/PID heuristics.
#[tauri::command]
pub fn list_serial_devices() -> Vec<String> {
    crate::serial_transport::list_nano_devices()
}

/// Open the serial port for `device_id` and start reading lines.
#[tauri::command]
pub async fn connect_serial(
    device_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    crate::serial_transport::connect(device_id, state, app).await
}

/// Close the serial port (or net socket) for `device_id`.
#[tauri::command]
pub async fn disconnect(
    device_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    if device_id.starts_with("net:") {
        crate::net_transport::disconnect(device_id.clone(), state, app)
            .await
            .map(|_| device_id)
    } else {
        crate::serial_transport::disconnect(device_id, state, app).await
    }
}

/// Write `jsonstr + '\n'` to the device. Routes by prefix (net: → TCP, else serial).
#[tauri::command]
pub async fn send(
    device_id: String,
    jsonstr: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if device_id.starts_with("net:") {
        crate::net_transport::send(device_id, jsonstr, state).await
    } else {
        crate::serial_transport::send(device_id, jsonstr, state).await
    }
}

/// TCP connect to `ip:3333`, run the mutual HMAC-SHA256 handshake, and register
/// the connection. Returns deviceId = "net:<ip>" on success.
#[tauri::command]
pub async fn connect_net(
    ip: String,
    psk: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    crate::net_transport::connect(ip, psk, state, app).await
}

/// Disconnect a net device by deviceId.
#[tauri::command]
pub async fn disconnect_net(
    device_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    crate::net_transport::disconnect(device_id, state, app).await
}
