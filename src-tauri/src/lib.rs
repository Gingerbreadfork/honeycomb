mod sync;

use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

use serde::Serialize;
#[cfg(desktop)]
use tauri::WindowEvent;
use tauri::{Manager, State};

use sync::{DeviceInfo, PairingState, Row, Shared, SyncEngine, SyncSnapshot};

#[derive(Serialize)]
struct AppPaths {
    data_file: String,
    settings_file: String,
}

struct SyncHandle(Mutex<Option<Shared>>);
struct BackgroundMode(AtomicBool);

fn mtime_of(path: &Path) -> Option<u64> {
    std::fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

/// HONEYCOMB_PROFILE=name keeps a separate data set, for running several copies side by side.
fn profile_dir_name() -> String {
    match std::env::var("HONEYCOMB_PROFILE") {
        Ok(p) if !p.trim().is_empty() => format!("honeycomb-{}", p.trim()),
        _ => "honeycomb".into(),
    }
}

/// Default locations: ~/.local/share/honeycomb/readings.csv and ~/.config/honeycomb/settings.json.
#[tauri::command]
fn app_paths(app: tauri::AppHandle) -> Result<AppPaths, String> {
    let data = app.path().data_dir().map_err(|e| e.to_string())?;
    let config = app.path().config_dir().map_err(|e| e.to_string())?;
    let dir = profile_dir_name();
    Ok(AppPaths {
        data_file: data.join(&dir).join("readings.csv").to_string_lossy().into_owned(),
        settings_file: config.join(&dir).join("settings.json").to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn app_profile() -> String {
    std::env::var("HONEYCOMB_PROFILE").unwrap_or_default()
}

/// Returns None when the file does not exist yet.
#[tauri::command]
fn read_text(path: String) -> Result<Option<String>, String> {
    match std::fs::read(&path) {
        Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Writes to a sibling temp file, then renames over the target. Returns the new mtime.
#[tauri::command]
fn write_text(path: String, text: String) -> Result<Option<u64>, String> {
    let path = PathBuf::from(path);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".into());
    let tmp = path.with_file_name(format!(".{name}.tmp"));
    std::fs::write(&tmp, text.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(mtime_of(&path))
}

#[tauri::command]
fn file_mtime(path: String) -> Option<u64> {
    mtime_of(Path::new(&path))
}

#[tauri::command]
fn set_background_mode(state: State<'_, BackgroundMode>, on: bool) {
    state.0.store(on, Ordering::Relaxed);
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn engine(state: &State<'_, SyncHandle>) -> Result<Shared, String> {
    state.0.lock().unwrap().clone().ok_or_else(|| "Sync is still starting".to_string())
}

#[tauri::command]
fn sync_snapshot(state: State<'_, SyncHandle>) -> Option<SyncSnapshot> {
    state.0.lock().unwrap().as_ref().map(|e| e.snapshot())
}

/// Starts the sync engine once the page is up, so the platform runtime is fully initialised first.
#[tauri::command]
async fn sync_start(app: tauri::AppHandle, state: State<'_, SyncHandle>) -> Result<SyncSnapshot, String> {
    if let Some(e) = state.0.lock().unwrap().as_ref() {
        return Ok(e.snapshot());
    }
    let dir = app.path().data_dir().map(|d| d.join(profile_dir_name())).unwrap_or_else(|_| PathBuf::from("."));
    let engine = SyncEngine::start(app.clone(), dir).await?;
    let mut slot = state.0.lock().unwrap();
    if let Some(existing) = slot.as_ref() {
        return Ok(existing.snapshot());
    }
    slot.replace(engine.clone());
    Ok(engine.snapshot())
}

#[tauri::command]
fn sync_set_rows(state: State<'_, SyncHandle>, rows: Vec<Row>) -> Result<(), String> {
    engine(&state)?.set_rows(rows);
    Ok(())
}

#[tauri::command]
fn sync_replace_rows(state: State<'_, SyncHandle>, rows: Vec<Row>) -> Result<(), String> {
    engine(&state)?.replace_rows(rows);
    Ok(())
}

#[tauri::command]
fn sync_now(state: State<'_, SyncHandle>) -> Result<(), String> {
    engine(&state)?.request_sync();
    Ok(())
}

#[tauri::command]
async fn sync_start_pairing(state: State<'_, SyncHandle>) -> Result<PairingState, String> {
    let e = engine(&state)?;
    e.start_pairing().await
}

#[tauri::command]
fn sync_cancel_pairing(state: State<'_, SyncHandle>) -> Result<(), String> {
    engine(&state)?.cancel_pairing();
    Ok(())
}

#[tauri::command]
async fn sync_pair_with(state: State<'_, SyncHandle>, code: String) -> Result<DeviceInfo, String> {
    let e = engine(&state)?;
    e.pair_with_code(&code).await
}

#[tauri::command]
async fn sync_pair_nearby(state: State<'_, SyncHandle>, id: String) -> Result<DeviceInfo, String> {
    let e = engine(&state)?;
    e.pair_nearby(&id).await
}

#[tauri::command]
fn sync_respond_pair(state: State<'_, SyncHandle>, request_id: u64, accept: bool) -> Result<(), String> {
    engine(&state)?.respond_pair(request_id, accept);
    Ok(())
}

#[tauri::command]
fn sync_forget(state: State<'_, SyncHandle>, id: String) -> Result<(), String> {
    engine(&state)?.forget(&id);
    Ok(())
}

#[tauri::command]
fn sync_set_device_name(state: State<'_, SyncHandle>, name: String) -> Result<(), String> {
    engine(&state)?.set_device_name(name);
    Ok(())
}

/// Called once from MainActivity so crates that need the Android context (DNS, network watching) can find it.
#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_app_honeycomb_MainActivity_initAndroidContext(
    env: jni::JNIEnv,
    _class: jni::objects::JObject,
    activity: jni::objects::JObject,
) {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        if let (Ok(vm), Ok(global)) = (env.get_java_vm(), env.new_global_ref(&activity)) {
            let context = global.as_raw() as *mut std::ffi::c_void;
            std::mem::forget(global);
            unsafe { ndk_context::initialize_android_context(vm.get_java_vm_pointer() as *mut std::ffi::c_void, context) };
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "android")]
    {
        android_logger::init_once(android_logger::Config::default().with_max_level(log::LevelFilter::Info).with_tag("honeycomb"));
        std::panic::set_hook(Box::new(|info| log::error!("panic: {info}")));
    }
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        if std::env::var("HONEYCOMB_PROFILE").map(|p| p.trim().is_empty()).unwrap_or(true) {
            builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }));
        }
        builder = builder.plugin(tauri_plugin_window_state::Builder::new().build());
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .manage(SyncHandle(Mutex::new(None)))
        .manage(BackgroundMode(AtomicBool::new(false)))
        .setup(|_app| Ok(()))
        .on_window_event(|window, event| {
            #[cfg(desktop)]
            if let WindowEvent::CloseRequested { api, .. } = event {
                let background = window.state::<BackgroundMode>().0.load(Ordering::Relaxed);
                if background {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            #[cfg(not(desktop))]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            app_paths,
            app_profile,
            read_text,
            write_text,
            file_mtime,
            set_background_mode,
            quit_app,
            sync_snapshot,
            sync_start,
            sync_set_rows,
            sync_replace_rows,
            sync_now,
            sync_start_pairing,
            sync_cancel_pairing,
            sync_pair_with,
            sync_pair_nearby,
            sync_respond_pair,
            sync_forget,
            sync_set_device_name
        ])
        .run(tauri::generate_context!())
        .expect("error while running honeycomb");
}
