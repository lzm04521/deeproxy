use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
mod proxy;
mod tray;

#[cfg(target_os = "macos")]
mod macos;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app
                .get_webview_window("main")
                .expect("no main window")
                .set_focus();
        }))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            proxy::start_server,
            is_running,
            proxy::stop,
            proxy::restart,
            tray::tray_quit,
            tray::tray_start_server,
            tray::tray_stop_server,
            tray::tray_restart_server,
            tray::tray_show_setup,
            proxy::fetch_models,
        ])
        .manage(Arc::new(Mutex::new(None)) as proxy::SharedServerState)
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            macos::set_activation_policy(macos::ActivationPolicy::Accessory);
            let win_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("deeproxy")
                .resizable(false)
                .visible(false)
                .minimizable(false)
                .maximizable(false)
                .inner_size(400.0, 320.0);
            #[cfg(target_os = "macos")]
            let win_builder = win_builder.hidden_title(true);

            let _window = win_builder.build().unwrap();
            #[cfg(not(debug_assertions))]
            {
                let disable_context_menu_script = r#"
                    document.addEventListener('contextmenu', function(e) {
                        e.preventDefault(); 
                    });
                "#;
                _window.eval(disable_context_menu_script).unwrap();
            }
            let napp = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(2)).await;
                let status = proxy::start_api_server(napp).await;
                if let Err(_) = status {
                    _window.show().unwrap();
                    _window.set_focus().unwrap();
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn is_running(handle: tauri::AppHandle) -> Result<bool, String> {
    let server_state_arc = handle.state::<proxy::SharedServerState>();
    let server_state = server_state_arc.lock().await;
    Ok(server_state.is_some())
}
