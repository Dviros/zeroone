// Net transport — mirrors nanoNetApi.ts.
//
// Mutual HMAC-SHA256 handshake protocol:
//   1. Device → {"hello":{"nonce":"<32hexchars = 16 raw bytes>","proto":1}}
//   2. Client → {"auth":{"hmac":HMAC-SHA256(psk, deviceNonce_bytes).hex(), "nonce":"<clientNonce_hex>"}}
//   3. Device → {"auth":{"ok":true,"hmac":HMAC-SHA256(psk, clientNonce_bytes).hex()}}
//   Post-handshake: newline-delimited JSON frames.
//
// We avoid tokio::select! (requires tokio/macros) by using a stop flag checked
// before each blocking read. The read itself has a generous timeout so the loop
// stays responsive to stop requests.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::{AppState, NanoEvent};

type HmacSha256 = Hmac<Sha256>;

const DEVICE_PORT: u16 = 3333;
const HANDSHAKE_TIMEOUT_MS: u64 = 6000;
const MAX_DATA_BUFFER_BYTES: usize = 65_536;
/// Timeout on each individual read_line call in the post-handshake loop.
/// Short enough to notice stop requests quickly; long enough to avoid busy-loop.
const READ_TIMEOUT_MS: u64 = 500;

// ── Types ─────────────────────────────────────────────────────────────────────

pub struct NetConn {
    /// Shared write-half for `send`.
    pub writer: Arc<Mutex<tokio::net::tcp::OwnedWriteHalf>>,
    /// Set to true to signal the reader task to stop at its next read timeout.
    pub stop_flag: Arc<AtomicBool>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn compute_hmac(psk: &str, data: &[u8]) -> String {
    let mut mac = HmacSha256::new_from_slice(psk.as_bytes())
        .expect("HMAC accepts any key length");
    mac.update(data);
    hex::encode(mac.finalize().into_bytes())
}

fn constant_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Fill a 16-byte array with cryptographically-secure random bytes from the OS.
/// The handshake's security depends on the client nonce being unpredictable: the
/// device proves PSK knowledge by HMAC'ing this nonce, so a guessable nonce would
/// let an attacker precompute/replay proofs. Never use a non-CSPRNG here.
fn rand_bytes_16() -> [u8; 16] {
    let mut out = [0u8; 16];
    getrandom::getrandom(&mut out).expect("OS CSPRNG (getrandom) failed");
    out
}

// ── Handshake ─────────────────────────────────────────────────────────────────

async fn do_handshake(
    reader: &mut BufReader<tokio::net::tcp::OwnedReadHalf>,
    writer: &mut tokio::net::tcp::OwnedWriteHalf,
    psk: &str,
) -> Result<(), String> {
    use tokio::time::{timeout, Duration};

    let mut line = String::new();

    // Step 1 — read hello with timeout.
    let n = timeout(
        Duration::from_millis(HANDSHAKE_TIMEOUT_MS),
        reader.read_line(&mut line),
    )
    .await
    .map_err(|_| "Handshake timeout waiting for hello".to_string())?
    .map_err(|e| format!("Read hello: {e}"))?;

    if n == 0 {
        return Err("Connection closed before hello".into());
    }

    // Parse {"hello":{"nonce":"<hex>","proto":1}}
    let hello_val: serde_json::Value =
        serde_json::from_str(line.trim()).map_err(|e| format!("Hello parse: {e}"))?;
    let hello = hello_val.get("hello").ok_or("Missing 'hello' key")?;
    let proto = hello
        .get("proto")
        .and_then(|v| v.as_u64())
        .ok_or("Missing 'proto'")?;
    if proto != 1 {
        return Err(format!("Unsupported protocol version {proto}"));
    }
    let device_nonce_hex = hello
        .get("nonce")
        .and_then(|v| v.as_str())
        .ok_or("Missing 'nonce'")?;
    let device_nonce_bytes =
        hex::decode(device_nonce_hex).map_err(|e| format!("Bad device nonce hex: {e}"))?;

    // Step 2 — send our auth.
    let client_nonce_bytes = rand_bytes_16();
    let client_nonce_hex = hex::encode(client_nonce_bytes);
    let client_hmac = compute_hmac(psk, &device_nonce_bytes);
    let auth_msg = format!(
        "{{\"auth\":{{\"hmac\":\"{client_hmac}\",\"nonce\":\"{client_nonce_hex}\"}}}}\n"
    );
    writer
        .write_all(auth_msg.as_bytes())
        .await
        .map_err(|e| format!("Send auth: {e}"))?;
    writer.flush().await.map_err(|e| format!("Flush auth: {e}"))?;

    // Step 3 — read device proof with timeout.
    line.clear();
    let n2 = timeout(
        Duration::from_millis(HANDSHAKE_TIMEOUT_MS),
        reader.read_line(&mut line),
    )
    .await
    .map_err(|_| "Handshake timeout waiting for auth reply".to_string())?
    .map_err(|e| format!("Read auth: {e}"))?;

    if n2 == 0 {
        return Err("Connection closed before auth reply".into());
    }

    let auth_val: serde_json::Value =
        serde_json::from_str(line.trim()).map_err(|e| format!("Auth parse: {e}"))?;
    let auth = auth_val.get("auth").ok_or("Missing 'auth' key")?;
    let ok = auth.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    if !ok {
        return Err("Device rejected credentials (auth.ok = false)".into());
    }
    let device_hmac_hex = auth
        .get("hmac")
        .and_then(|v| v.as_str())
        .ok_or("Device did not provide proof HMAC")?;
    let device_proof =
        hex::decode(device_hmac_hex).map_err(|e| format!("Bad device proof hex: {e}"))?;

    let expected_proof_hex = compute_hmac(psk, &client_nonce_bytes);
    let expected_proof = hex::decode(&expected_proof_hex).unwrap();

    if !constant_eq(&device_proof, &expected_proof) {
        return Err("Device HMAC proof mismatch — possible MITM".into());
    }

    Ok(())
}

// ── Connect ───────────────────────────────────────────────────────────────────

pub async fn connect(
    ip: String,
    psk: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    let device_id = format!("net:{ip}");

    if state.net_conns.lock().contains_key(&device_id) {
        return Ok(device_id);
    }

    let stream = TcpStream::connect(format!("{ip}:{DEVICE_PORT}"))
        .await
        .map_err(|e| format!("TCP connect to {ip}:{DEVICE_PORT}: {e}"))?;

    stream
        .set_nodelay(true)
        .map_err(|e| format!("set_nodelay: {e}"))?;

    let (read_half, mut write_half) = stream.into_split();
    let mut buf_reader = BufReader::new(read_half);

    // Run the handshake.
    do_handshake(&mut buf_reader, &mut write_half, &psk).await?;

    // Handshake passed. Store the connection.
    let stop_flag = Arc::new(AtomicBool::new(false));
    let writer = Arc::new(Mutex::new(write_half));

    let conn = NetConn {
        writer: writer.clone(),
        stop_flag: stop_flag.clone(),
    };
    state.net_conns.lock().insert(device_id.clone(), conn);

    // Emit "connected".
    app.emit("nano-event", NanoEvent {
        eventid:  "connected".into(),
        deviceid: device_id.clone(),
        data:     None,
    }).ok();

    // Spawn post-handshake reader task.
    let app_clone = app.clone();
    let dev_id = device_id.clone();
    tokio::spawn(async move {
        net_read_loop(buf_reader, dev_id, app_clone, stop_flag).await;
    });

    Ok(device_id)
}

// ── Reader task ───────────────────────────────────────────────────────────────

async fn net_read_loop(
    mut reader: BufReader<tokio::net::tcp::OwnedReadHalf>,
    device_id: String,
    app: AppHandle,
    stop_flag: Arc<AtomicBool>,
) {
    use tokio::time::{timeout, Duration};

    let mut buf_len: usize = 0;

    loop {
        if stop_flag.load(Ordering::Relaxed) {
            break;
        }

        let mut line = String::new();
        // Read with a short timeout so we can check stop_flag periodically.
        let result = timeout(
            Duration::from_millis(READ_TIMEOUT_MS),
            reader.read_line(&mut line),
        )
        .await;

        match result {
            Err(_elapsed) => {
                // Timeout — loop back to check stop_flag.
                continue;
            }
            Ok(Ok(0)) => {
                // EOF — device closed the connection.
                break;
            }
            Ok(Ok(n)) => {
                buf_len += n;
                if buf_len > MAX_DATA_BUFFER_BYTES {
                    eprintln!("[net][{device_id}] RX buffer overflow — dropping");
                    app.emit("nano-event", NanoEvent {
                        eventid:  "error".into(),
                        deviceid: device_id.clone(),
                        data:     Some(r#"{"error":"RX buffer overflow"}"#.into()),
                    }).ok();
                    buf_len = 0;
                    continue;
                }

                let trimmed = line.trim().to_string();
                if trimmed.is_empty() {
                    continue;
                }

                if trimmed.starts_with('{') {
                    app.emit("nano-event", NanoEvent {
                        eventid:  "update".into(),
                        deviceid: device_id.clone(),
                        data:     Some(trimmed),
                    }).ok();
                    buf_len = 0;
                } else {
                    eprintln!("[net][{device_id}] Device: {trimmed}");
                }
            }
            Ok(Err(e)) => {
                eprintln!("[net][{device_id}] Read error: {e}");
                app.emit("nano-event", NanoEvent {
                    eventid:  "error".into(),
                    deviceid: device_id.clone(),
                    data:     Some(format!(r#"{{"error":"{e}"}}"#)),
                }).ok();
                break;
            }
        }
    }

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
    let writer = {
        let conns = state.net_conns.lock();
        conns
            .get(&device_id)
            .map(|c| c.writer.clone())
            .ok_or_else(|| format!("Net device not connected: {device_id}"))?
    };

    let mut w = writer.lock().await;
    let frame = format!("{jsonstr}\n");
    w.write_all(frame.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    w.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

// ── Disconnect ────────────────────────────────────────────────────────────────

pub async fn disconnect(
    device_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let conn = state
        .net_conns
        .lock()
        .remove(&device_id)
        .ok_or_else(|| format!("Net device not connected: {device_id}"))?;

    // Signal the reader to stop at its next timeout.
    conn.stop_flag.store(true, Ordering::Relaxed);

    app.emit("nano-event", NanoEvent {
        eventid:  "disconnected".into(),
        deviceid: device_id,
        data:     None,
    }).ok();

    Ok(())
}
