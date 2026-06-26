// Tauri command handlers — all functions annotated with #[tauri::command] are
// gathered here so they are not in the same scope as generate_handler!, which
// would cause "macro defined multiple times" compile errors.

use tauri::{AppHandle, State};
use crate::AppState;

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

/// Trigger a fresh mDNS browse cycle (no-op — browser runs continuously).
#[tauri::command]
pub fn mdns_rescan() -> Result<(), String> {
    Ok(())
}
