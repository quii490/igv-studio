use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize)]
struct FilePayload {
    name: String,
    text: String,
}

#[derive(Serialize)]
struct SaveResult {
    ok: bool,
    canceled: bool,
    path: Option<String>,
    bytes: usize,
}

fn file_name(p: &PathBuf) -> String {
    p.file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into())
}

/// Native multi-file picker (SVG / XML).
#[tauri::command]
async fn open_files() -> Vec<FilePayload> {
    let picked = rfd::AsyncFileDialog::new()
        .add_filter("IGV exports", &["svg", "xml"])
        .pick_files()
        .await;
    let mut out = Vec::new();
    if let Some(files) = picked {
        for f in files {
            let path = f.path().to_path_buf();
            if let Ok(text) = std::fs::read_to_string(&path) {
                out.push(FilePayload { name: file_name(&path), text });
            }
        }
    }
    out
}

/// Read files by absolute path (used by the native drag & drop handler).
#[tauri::command]
async fn read_files(paths: Vec<String>) -> Vec<FilePayload> {
    let mut out = Vec::new();
    for p in paths {
        let path = PathBuf::from(&p);
        if let Ok(text) = std::fs::read_to_string(&path) {
            out.push(FilePayload { name: file_name(&path), text });
        }
    }
    out
}

#[cfg(feature = "test-hooks")]
fn test_save_dir() -> Option<PathBuf> {
    std::env::var("IGV_TEST_SAVE_DIR").ok().map(PathBuf::from)
}
#[cfg(not(feature = "test-hooks"))]
fn test_save_dir() -> Option<PathBuf> {
    None
}

#[tauri::command]
async fn save_text(default_name: String, text: String) -> SaveResult {
    if let Some(dir) = test_save_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join(&default_name);
        return match std::fs::write(&path, text.as_bytes()) {
            Ok(_) => SaveResult { ok: true, canceled: false, path: Some(path.to_string_lossy().to_string()), bytes: text.len() },
            Err(_) => SaveResult { ok: false, canceled: false, path: None, bytes: 0 },
        };
    }
    let picked = rfd::AsyncFileDialog::new()
        .set_file_name(&default_name)
        .add_filter("SVG", &["svg"])
        .save_file()
        .await;
    let Some(handle) = picked else {
        return SaveResult { ok: false, canceled: true, path: None, bytes: 0 };
    };
    let path = handle.path().to_path_buf();
    match std::fs::write(&path, text.as_bytes()) {
        Ok(_) => SaveResult {
            ok: true,
            canceled: false,
            path: Some(path.to_string_lossy().to_string()),
            bytes: text.len(),
        },
        Err(_) => SaveResult { ok: false, canceled: false, path: None, bytes: 0 },
    }
}

#[tauri::command]
async fn save_binary(default_name: String, base64: String) -> SaveResult {
    if let Some(dir) = test_save_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join(&default_name);
        let Ok(bytes) = B64.decode(base64.as_bytes()) else {
            return SaveResult { ok: false, canceled: false, path: None, bytes: 0 };
        };
        let n = bytes.len();
        return match std::fs::write(&path, bytes) {
            Ok(_) => SaveResult { ok: true, canceled: false, path: Some(path.to_string_lossy().to_string()), bytes: n },
            Err(_) => SaveResult { ok: false, canceled: false, path: None, bytes: 0 },
        };
    }
    let picked = rfd::AsyncFileDialog::new()
        .set_file_name(&default_name)
        .add_filter("ZIP", &["zip"])
        .save_file()
        .await;
    let Some(handle) = picked else {
        return SaveResult { ok: false, canceled: true, path: None, bytes: 0 };
    };
    let path = handle.path().to_path_buf();
    let Ok(bytes) = B64.decode(base64.as_bytes()) else {
        return SaveResult { ok: false, canceled: false, path: None, bytes: 0 };
    };
    let n = bytes.len();
    match std::fs::write(&path, bytes) {
        Ok(_) => SaveResult { ok: true, canceled: false, path: Some(path.to_string_lossy().to_string()), bytes: n },
        Err(_) => SaveResult { ok: false, canceled: false, path: None, bytes: 0 },
    }
}

/// Test/diagnostic channel. Disabled unless the `test-hooks` feature is enabled.
#[tauri::command]
fn write_diag(path: String, content: String) -> bool {
    #[cfg(feature = "test-hooks")]
    {
        return std::fs::write(PathBuf::from(path), content).is_ok();
    }
    #[cfg(not(feature = "test-hooks"))]
    {
        let _ = (path, content);
        false
    }
}

/// Harness configuration. Compiled to a no-op unless the `test-hooks` feature is enabled.
#[tauri::command]
fn bench_config() -> serde_json::Value {
    #[cfg(feature = "test-hooks")]
    {
        return serde_json::json!({
            "enabled": std::env::var("IGV_BENCH").map(|v| v == "1").unwrap_or(false),
            "fixturePath": std::env::var("IGV_BENCH_FIXTURE").ok(),
            "outPath": std::env::var("IGV_BENCH_OUT").ok(),
            "selfTest": std::env::var("IGV_SELFTEST").map(|v| v == "1").unwrap_or(false),
            "selfTestOut": std::env::var("IGV_SELFTEST_OUT").ok(),
            "selfTestBad": std::env::var("IGV_SELFTEST_BAD").ok(),
            "selfTestVariant": std::env::var("IGV_SELFTEST_VARIANT").ok(),
        });
    }
    #[cfg(not(feature = "test-hooks"))]
    {
        serde_json::json!({ "enabled": false, "selfTest": false })
    }
}

#[tauri::command]
fn app_info() -> serde_json::Value {
    serde_json::json!({
        "name": "IGV Studio",
        "version": env!("CARGO_PKG_VERSION"),
        "webkit": std::env::var("WEBKIT_VERSION").unwrap_or_default(),
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            open_files,
            read_files,
            save_text,
            save_binary,
            write_diag,
            bench_config,
            app_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running IGV Studio");
}
