// Serial transport — mirrors nanoSerialApi.ts.
//
// VID/PID filter matches the same pairs as the TypeScript original:
//   239A:8010  and  303A:1001
// Additionally, device names containing "usbmodemNano" pass the filter (same heuristic).

use std::io::{BufRead, BufReader, Write};
use std::time::Duration;
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, State};

use crate::{AppState, NanoEvent};

// ── Constants ─────────────────────────────────────────────────────────────────

const NANO_VID_PID_PAIRS: &[(u16, u16)] = &[
    (0x239A, 0x8010),
    (0x303A, 0x1001),
];
const NANO_BAUD_RATE: u32 = 115_200;
const MAX_DATA_BUFFER_BYTES: usize = 65_536;

// ── Types ─────────────────────────────────────────────────────────────────────

/// A connected serial port with a write-half held behind a mutex.
/// The read-half lives inside a tokio blocking thread for its lifetime.
pub struct SerialConn {
    /// Path stored for diagnostics / disconnect.
    pub path: String,
    /// Boxed write-half behind a mutex so `send` can write from any task.
    pub writer: Mutex<Box<dyn serialport::SerialPort>>,
    /// Signal the reader thread to stop.
    pub stop_tx: tokio::sync::oneshot::Sender<()>,
}

// ── Device enumeration ────────────────────────────────────────────────────────

pub fn list_nano_devices() -> Vec<String> {
    let ports = match serialport::available_ports() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[serial] list error: {e}");
            return vec![];
        }
    };

    let mut result = Vec::new();
    for p in &ports {
        if let serialport::SerialPortType::UsbPort(info) = &p.port_type {
            let vid = info.vid;
            let pid = info.pid;
            let serial_ok = NANO_VID_PID_PAIRS.iter().any(|&(v, pr)| v == vid && pr == pid);
            let name_ok = p.port_name.contains("usbmodemNano");
            if serial_ok || name_ok {
                // Use serial number if available, fall back to port name.
                let id = info
                    .serial_number
                    .as_deref()
                    .filter(|s| !s.is_empty())
                    .unwrap_or(&p.port_name)
                    .to_string();
                result.push(id);
            }
        }
    }
    result
}

/// Resolve a device-id (serial number or port name) to the serial port path.
fn resolve_path(device_id: &str) -> Option<String> {
    let ports = serialport::available_ports().ok()?;
    for p in &ports {
        if let serialport::SerialPortType::UsbPort(info) = &p.port_type {
            let id = info
                .serial_number
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or(&p.port_name);
            if id == device_id || p.port_name == device_id {
                return Some(p.port_name.clone());
            }
        }
    }
    None
}

// ── Connect ───────────────────────────────────────────────────────────────────

pub async fn connect(
    device_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    // Short-circuit if already connected.
    if state.serial_conns.lock().contains_key(&device_id) {
        return Ok(device_id);
    }

    let path = resolve_path(&device_id)
        .ok_or_else(|| format!("Device not attached: {device_id}"))?;

    let port = serialport::new(&path, NANO_BAUD_RATE)
        .timeout(Duration::from_millis(10))
        .open()
        .map_err(|e| format!("Cannot open {path}: {e}"))?;

    // Clone the port for the reader thread. serialport ports implement try_clone.
    let reader_port = port.try_clone().map_err(|e| format!("Cannot clone port: {e}"))?;

    let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();

    let conn = SerialConn {
        path: path.clone(),
        writer: Mutex::new(port),
        stop_tx,
    };

    state.serial_conns.lock().insert(device_id.clone(), conn);

    // Spawn a blocking reader thread. It reads lines and emits nano-event.
    let app_clone = app.clone();
    let dev_id = device_id.clone();
    tokio::task::spawn_blocking(move || {
        read_loop(reader_port, dev_id, app_clone, stop_rx);
    });

    // Emit "connected" event.
    app.emit("nano-event", NanoEvent {
        eventid:  "connected".into(),
        deviceid: device_id.clone(),
        data:     None,
    }).ok();

    Ok(device_id)
}

fn read_loop(
    port: Box<dyn serialport::SerialPort>,
    device_id: String,
    app: AppHandle,
    mut stop_rx: tokio::sync::oneshot::Receiver<()>,
) {
    let mut reader = BufReader::new(port);
    let mut buf_len: usize = 0;
    let mut line = String::new();

    loop {
        // Check stop signal (non-blocking).
        if stop_rx.try_recv().is_ok() {
            break;
        }

        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => {
                // EOF / port closed.
                break;
            }
            Ok(n) => {
                buf_len += n;
                if buf_len > MAX_DATA_BUFFER_BYTES {
                    eprintln!("[serial][{device_id}] RX buffer overflow — dropping");
                    app.emit("nano-event", NanoEvent {
                        eventid:  "error".into(),
                        deviceid: device_id.clone(),
                        data:     Some(r#"{"error":"RX buffer overflow"}"#.into()),
                    }).ok();
                    buf_len = 0;
                    continue;
                }

                let trimmed = line.trim_end_matches(['\n', '\r']);
                if trimmed.is_empty() {
                    continue;
                }

                // Belt-and-suspenders guard for legacy "undefined" prefix (same as TS).
                let payload = trimmed.strip_prefix("undefined").unwrap_or(trimmed);

                if payload.starts_with('{') {
                    app.emit("nano-event", NanoEvent {
                        eventid:  "update".into(),
                        deviceid: device_id.clone(),
                        data:     Some(payload.to_string()),
                    }).ok();
                    buf_len = 0; // reset counter after a successful frame
                } else {
                    eprintln!("[serial][{device_id}] Device: {payload}");
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                // Non-fatal — serialport uses timeouts as polling, not errors.
                continue;
            }
            Err(e) => {
                eprintln!("[serial][{device_id}] Read error: {e}");
                app.emit("nano-event", NanoEvent {
                    eventid:  "error".into(),
                    deviceid: device_id.clone(),
                    data:     Some(format!(r#"{{"error":"{e}"}}"#)),
                }).ok();
                break;
            }
        }
    }

    // Emit disconnected when the reader exits.
    app.emit("nano-event", NanoEvent {
        eventid:  "disconnected".into(),
        deviceid: device_id,
        data:     None,
    }).ok();
}

// ── Send ──────────────────────────────────────────────────────────────────────

pub async fn send(
    device_id: String,
    jsonstr: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conns = state.serial_conns.lock();
    let conn = conns.get(&device_id)
        .ok_or_else(|| format!("Device not connected: {device_id}"))?;

    let mut writer = conn.writer.lock();
    let frame = format!("{jsonstr}\n");
    writer.write_all(frame.as_bytes()).map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

// ── Disconnect ────────────────────────────────────────────────────────────────

pub async fn disconnect(
    device_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    let conn = state.serial_conns.lock().remove(&device_id)
        .ok_or_else(|| format!("Device not connected: {device_id}"))?;

    // Signal the reader thread to stop. The drop of stop_tx closes the channel.
    let _ = conn.stop_tx.send(());

    app.emit("nano-event", NanoEvent {
        eventid:  "disconnected".into(),
        deviceid: device_id.clone(),
        data:     None,
    }).ok();

    Ok(device_id)
}
