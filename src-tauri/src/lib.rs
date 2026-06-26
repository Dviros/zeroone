// ZERO/ONE Tauri v2 backend — transport layer ported from nanoSerialApi.ts and nanoNetApi.ts.
//
// Architecture: a single global AppState holds all active serial and TCP connections, plus
// the mDNS browser handle. Every Tauri command receives a reference to this state via
// Tauri's managed-state injection. Background tasks (serial reader, TCP reader, mDNS browser)
// live as tokio tasks and emit Tauri events back to the window.

pub mod serial_transport;
pub mod net_transport;
pub mod mdns_browser;
pub mod commands;

use std::collections::HashMap;
use parking_lot::Mutex;
use tauri::Manager;
use tauri::menu::Menu;

// ── Shared state ──────────────────────────────────────────────────────────────

pub struct AppState {
    pub serial_conns: Mutex<HashMap<String, serial_transport::SerialConn>>,
    pub net_conns:    Mutex<HashMap<String, net_transport::NetConn>>,
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            serial_conns: Mutex::new(HashMap::new()),
            net_conns:    Mutex::new(HashMap::new()),
        }
    }
}

// ── Tauri event shape (mirrors the Electron IPC event) ───────────────────────
// The renderer listens via nanoIpc.on(callback) which receives (eventid, deviceid, data).
// We emit a single Tauri event called "nano-event" with this payload.
#[derive(serde::Serialize, Clone)]
pub struct NanoEvent {
    pub eventid:  String,
    pub deviceid: String,
    pub data:     Option<String>,
}

// ── App setup ─────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::list_serial_devices,
            commands::connect_serial,
            commands::disconnect,
            commands::send,
            commands::connect_net,
            commands::disconnect_net,
        ])
        .setup(|app| {
            // Set the native OS menu (App/Edit/View/Window/Help) so that standard
            // shortcuts like Cmd+C/V/X/A, Cmd+Q, Cmd+W, and Cmd+M work in input fields.
            let menu = Menu::default(app.handle())?;
            app.set_menu(menu)?;

            // Start the mDNS browser in the background.
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                mdns_browser::run_browser(app_handle);
            });

            // Apply macOS vibrancy (frosted-glass NSVisualEffectView behind the window).
            // This is a no-op on non-macOS targets because the cfg guard excludes it.
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                if let Some(win) = app.get_webview_window("main") {
                    // HudWindow gives a dark frosted-glass look that matches the app palette.
                    // The None, None args use the OS-default corner radius and state.
                    let _ = apply_vibrancy(&win, NSVisualEffectMaterial::HudWindow, None, None);
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
