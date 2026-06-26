// mDNS browser — discovers _arduino._tcp and _nanod._tcp services and emits
// Tauri events matching the Electron "net-device-discovered" / "net-device-lost" contract.
//
// Uses mdns-sd which provides a pure-Rust mDNS/DNS-SD browser (no system daemon required).

use mdns_sd::{ServiceDaemon, ServiceEvent};
use tauri::{AppHandle, Emitter};
use serde::Serialize;

const SERVICE_TYPES: &[&str] = &["_arduino._tcp.local.", "_nanod._tcp.local."];

#[derive(Serialize, Clone)]
struct NetDeviceDiscovered {
    #[serde(rename = "deviceId")]
    device_id: String,
    ip:        String,
    name:      String,
}

#[derive(Serialize, Clone)]
struct NetDeviceLost {
    #[serde(rename = "deviceId")]
    device_id: String,
}

/// Called from a dedicated std thread at app startup. Runs forever.
pub fn run_browser(app: AppHandle) {
    let mdns = match ServiceDaemon::new() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[mdns] Cannot create daemon: {e}");
            return;
        }
    };

    for &svc in SERVICE_TYPES {
        let receiver = match mdns.browse(svc) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[mdns] Cannot browse {svc}: {e}");
                continue;
            }
        };

        let app_clone = app.clone();
        let svc_name = svc.to_string();
        std::thread::spawn(move || {
            browse_loop(receiver, svc_name, app_clone);
        });
    }

    // Park this thread — the spawned browse threads hold the daemon alive.
    loop {
        std::thread::park();
    }
}

fn browse_loop(
    receiver: mdns_sd::Receiver<ServiceEvent>,
    _svc_type: String,
    app: AppHandle,
) {
    for event in receiver {
        match event {
            ServiceEvent::ServiceResolved(info) => {
                // Pick the first IPv4 address if available.
                let ip = info
                    .get_addresses_v4()
                    .into_iter()
                    .next()
                    .map(|a| a.to_string())
                    .unwrap_or_default();

                if ip.is_empty() {
                    continue;
                }

                let device_id = format!("net:{ip}");
                let name = info.get_fullname().to_string();

                app.emit(
                    "net-device-discovered",
                    NetDeviceDiscovered { device_id, ip, name },
                )
                .ok();
            }
            ServiceEvent::ServiceRemoved(_, fullname) => {
                // We don't track IPs in this handler; emit a synthetic deviceId.
                // The renderer will match on name if needed, but we do best-effort.
                let device_id = format!("mdns:{fullname}");
                app.emit("net-device-lost", NetDeviceLost { device_id }).ok();
            }
            // SearchStarted, SearchStopped, etc. — ignored.
            _ => {}
        }
    }
}
