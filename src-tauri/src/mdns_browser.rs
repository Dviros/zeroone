// mDNS browser — discovers _arduino._tcp and _nanod._tcp services and emits
// Tauri events matching the Electron "net-device-discovered" / "net-device-lost" contract.
//
// Uses mdns-sd which provides a pure-Rust mDNS/DNS-SD browser (no system daemon required).
//
// One physical Nano_D++ advertises BOTH services (ArduinoOTA's _arduino._tcp and
// our dedicated _nanod._tcp), and a service can re-resolve to different address
// orderings — so naive per-resolution emits produce duplicate list entries. We
// dedup by the device's INSTANCE NAME (the stable hostname, identical across both
// services and every re-resolution) using a shared set across the browse threads.

use mdns_sd::{ServiceDaemon, ServiceEvent};
use tauri::{AppHandle, Emitter};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

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

/// The instance name is the leaf label of the mDNS fullname, e.g.
/// "Nano_e455f07554dc" from "Nano_e455f07554dc._nanod._tcp.local.". It is stable
/// across both service types and every re-resolution, so it's our dedup key.
fn instance_name(fullname: &str) -> String {
    fullname.split("._").next().unwrap_or(fullname).to_string()
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

    // instance name -> emitted device_id (shared across both browse threads).
    let seen: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new(HashMap::new()));

    for &svc in SERVICE_TYPES {
        let receiver = match mdns.browse(svc) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[mdns] Cannot browse {svc}: {e}");
                continue;
            }
        };
        let app_clone = app.clone();
        let seen_clone = seen.clone();
        std::thread::spawn(move || browse_loop(receiver, app_clone, seen_clone));
    }

    // Park this thread — the spawned browse threads hold the daemon alive.
    loop {
        std::thread::park();
    }
}

fn browse_loop(
    receiver: mdns_sd::Receiver<ServiceEvent>,
    app: AppHandle,
    seen: Arc<Mutex<HashMap<String, String>>>,
) {
    for event in receiver {
        match event {
            ServiceEvent::ServiceResolved(info) => {
                let ip = info
                    .get_addresses_v4()
                    .into_iter()
                    .next()
                    .map(|a| a.to_string())
                    .unwrap_or_default();
                if ip.is_empty() {
                    continue;
                }

                let instance = instance_name(info.get_fullname());
                let device_id = format!("net:{ip}");

                // Dedup by stable instance name: emit at most once per physical
                // device, regardless of which service or re-resolution surfaced it.
                {
                    let mut map = seen.lock().unwrap();
                    if map.contains_key(&instance) {
                        continue;
                    }
                    map.insert(instance.clone(), device_id.clone());
                }

                app.emit(
                    "net-device-discovered",
                    NetDeviceDiscovered {
                        device_id,
                        ip,
                        name: instance, // clean hostname, not the raw fullname
                    },
                )
                .ok();
            }
            ServiceEvent::ServiceRemoved(_, fullname) => {
                let instance = instance_name(&fullname);
                // Drop from the seen set so it can be rediscovered, and emit the
                // matching device_id (net:<ip>) so the renderer can remove it.
                let device_id = seen.lock().unwrap().remove(&instance);
                if let Some(device_id) = device_id {
                    app.emit("net-device-lost", NetDeviceLost { device_id }).ok();
                }
            }
            // SearchStarted, SearchStopped, etc. — ignored.
            _ => {}
        }
    }
}
