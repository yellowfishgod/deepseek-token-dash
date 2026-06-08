use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Manager, State, WindowEvent,
};

mod proxy;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub db_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ApiKey {
    pub id: i64,
    pub label: String,
    pub key_hash: String,
    pub key_prefix: String,
    pub color: String,
    pub monthly_budget: Option<f64>,
    pub created_at: i64,
    pub is_active: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RequestRecord {
    pub id: i64,
    pub api_key_id: i64,
    pub timestamp: i64,
    pub model: String,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub cost: f64,
    pub duration_ms: i64,
    pub endpoint: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TokenUsage {
    pub api_key_id: i64,
    pub label: String,
    pub color: String,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub cost: f64,
    pub request_count: i64,
}

fn init_db(conn: &Connection) {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS api_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            label TEXT NOT NULL,
            key_hash TEXT NOT NULL UNIQUE,
            key_prefix TEXT NOT NULL,
            color TEXT NOT NULL DEFAULT '#fbbf24',
            monthly_budget REAL,
            created_at INTEGER NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            api_key_id INTEGER NOT NULL,
            timestamp INTEGER NOT NULL,
            model TEXT NOT NULL,
            prompt_tokens INTEGER NOT NULL,
            completion_tokens INTEGER NOT NULL,
            total_tokens INTEGER NOT NULL,
            cost REAL DEFAULT 0,
            duration_ms INTEGER DEFAULT 0,
            endpoint TEXT DEFAULT '',
            FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS model_pricing (
            model TEXT PRIMARY KEY,
            input_price_per_1m REAL NOT NULL,
            output_price_per_1m REAL NOT NULL,
            updated_at INTEGER
        );

        -- Default model pricing (DeepSeek official prices)
        INSERT OR IGNORE INTO model_pricing (model, input_price_per_1m, output_price_per_1m, updated_at)
        VALUES ('deepseek-chat', 2.0, 8.0, strftime('%s', 'now'));

        INSERT OR IGNORE INTO model_pricing (model, input_price_per_1m, output_price_per_1m, updated_at)
        VALUES ('deepseek-reasoner', 4.0, 16.0, strftime('%s', 'now'));
        ",
    )
    .expect("Failed to initialize database");
}

#[tauri::command]
fn get_api_keys(state: State<AppState>) -> Result<Vec<ApiKey>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare("SELECT id, label, key_hash, key_prefix, color, monthly_budget, created_at, is_active FROM api_keys WHERE is_active = 1")
        .map_err(|e| e.to_string())?;

    let keys = stmt
        .query_map([], |row| {
            Ok(ApiKey {
                id: row.get(0)?,
                label: row.get(1)?,
                key_hash: row.get(2)?,
                key_prefix: row.get(3)?,
                color: row.get(4)?,
                monthly_budget: row.get(5)?,
                created_at: row.get(6)?,
                is_active: row.get::<_, i32>(7)? != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(keys)
}

#[tauri::command]
fn add_api_key(state: State<AppState>, label: String, api_key: String, color: String) -> Result<ApiKey, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let key_hash = format!("{:x}", Sha256::digest(api_key.as_bytes()));
    let key_prefix = if api_key.len() > 10 {
        format!("{}...{}", &api_key[..6], &api_key[api_key.len()-4..])
    } else {
        api_key[..api_key.len().min(10)].to_string()
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    db.execute(
        "INSERT INTO api_keys (label, key_hash, key_prefix, color, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![label, key_hash, key_prefix, color, now],
    )
    .map_err(|e| e.to_string())?;

    let id = db.last_insert_rowid();
    Ok(ApiKey {
        id,
        label,
        key_hash,
        key_prefix,
        color,
        monthly_budget: None,
        created_at: now,
        is_active: true,
    })
}

#[tauri::command]
fn delete_api_key(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("UPDATE api_keys SET is_active = 0 WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_usage_summary(state: State<AppState>, api_key_id: Option<i64>, period: String) -> Result<Vec<TokenUsage>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let time_filter = match period.as_str() {
        "today" => "AND r.timestamp >= strftime('%s', datetime('now', 'localtime', 'start of day')) * 1000",
        "week" => "AND r.timestamp >= strftime('%s', datetime('now', 'localtime', '-7 days')) * 1000",
        "month" => "AND r.timestamp >= strftime('%s', datetime('now', 'localtime', 'start of month')) * 1000",
        _ => "",
    };

    let key_filter = if let Some(kid) = api_key_id {
        format!("AND r.api_key_id = {}", kid)
    } else {
        String::new()
    };

    let query = format!(
        "SELECT r.api_key_id, k.label, k.color,
                SUM(r.prompt_tokens) as pt, SUM(r.completion_tokens) as ct,
                SUM(r.total_tokens) as tt, SUM(r.cost) as total_cost,
                COUNT(*) as cnt
         FROM requests r
         JOIN api_keys k ON r.api_key_id = k.id
         WHERE k.is_active = 1 {} {}
         GROUP BY r.api_key_id
         ORDER BY total_cost DESC",
        time_filter, key_filter
    );

    let mut stmt = db.prepare(&query).map_err(|e| e.to_string())?;
    let usage = stmt
        .query_map([], |row| {
            Ok(TokenUsage {
                api_key_id: row.get(0)?,
                label: row.get(1)?,
                color: row.get(2)?,
                prompt_tokens: row.get(3)?,
                completion_tokens: row.get(4)?,
                total_tokens: row.get(5)?,
                cost: row.get(6)?,
                request_count: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(usage)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelPricing {
    pub model: String,
    pub input_price_per_1m: f64,
    pub output_price_per_1m: f64,
}

#[tauri::command]
fn get_setting(state: State<AppState>, key: String) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_setting(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_model_pricing(state: State<AppState>) -> Result<Vec<ModelPricing>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare("SELECT model, input_price_per_1m, output_price_per_1m FROM model_pricing")
        .map_err(|e| e.to_string())?;
    let pricing = stmt
        .query_map([], |row| {
            Ok(ModelPricing {
                model: row.get(0)?,
                input_price_per_1m: row.get(1)?,
                output_price_per_1m: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(pricing)
}

#[tauri::command]
fn save_model_pricing(state: State<AppState>, model: String, input_price: f64, output_price: f64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    db.execute(
        "INSERT OR REPLACE INTO model_pricing (model, input_price_per_1m, output_price_per_1m, updated_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![model, input_price, output_price, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_model_pricing(state: State<AppState>, model: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM model_pricing WHERE model = ?1", rusqlite::params![model])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn toggle_floating(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("floating") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
    Ok(())
}

#[tauri::command]
fn show_main(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
fn get_recent_requests(state: State<AppState>, limit: i64) -> Result<Vec<RequestRecord>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare(
            "SELECT r.id, r.api_key_id, r.timestamp, r.model, r.prompt_tokens, r.completion_tokens,
                    r.total_tokens, r.cost, r.duration_ms, r.endpoint, k.label
             FROM requests r
             JOIN api_keys k ON r.api_key_id = k.id
             WHERE k.is_active = 1
             ORDER BY r.timestamp DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let records = stmt
        .query_map([limit], |row| {
            Ok(RequestRecord {
                id: row.get(0)?,
                api_key_id: row.get(1)?,
                timestamp: row.get(2)?,
                model: row.get(3)?,
                prompt_tokens: row.get(4)?,
                completion_tokens: row.get(5)?,
                total_tokens: row.get(6)?,
                cost: row.get(7)?,
                duration_ms: row.get(8)?,
                endpoint: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(records)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Determine DB path: use app data directory or fallback to current dir
    let db_path = dirs_next().unwrap_or_else(|| std::path::PathBuf::from("."));
    std::fs::create_dir_all(&db_path).ok();
    let db_file = db_path.join("deepseek_token_dash.db");

    let db_path_str = db_file.to_string_lossy().to_string();
    let conn = Connection::open(&db_file).expect("Failed to open database");
    init_db(&conn);

    let state = AppState {
        db: Mutex::new(conn),
        db_path: db_path_str.clone(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .manage(state)
        .setup(move |app| {
            let handle = app.handle().clone();

            // System tray
            let show_item = MenuItemBuilder::with_id("show", "打开仪表盘").build(app)?;
            let toggle_item = MenuItemBuilder::with_id("toggle", "显示/隐藏悬浮窗").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .item(&toggle_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("DeepSeek Token Dash")
                .menu(&menu)
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            let _ = app.get_webview_window("main").map(|w| {
                                let _ = w.show();
                                let _ = w.set_focus();
                            });
                        }
                        "toggle" => {
                            if let Some(w) = app.get_webview_window("floating") {
                                if w.is_visible().unwrap_or(false) {
                                    let _ = w.hide();
                                } else {
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                }
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            // Minimize main window to tray on close
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { .. } = event {
                        let _ = window_clone.hide();
                        // Prevent actual close
                        // Note: in Tauri v2, close prevention requires different handling
                    }
                });
            }

            // Start proxy
            proxy::start_proxy(handle, db_path_str.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_api_keys,
            add_api_key,
            delete_api_key,
            get_usage_summary,
            get_recent_requests,
            toggle_floating,
            show_main,
            get_setting,
            set_setting,
            get_model_pricing,
            save_model_pricing,
            delete_model_pricing,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn dirs_next() -> Option<std::path::PathBuf> {
    std::env::var("APPDATA")
        .ok()
        .map(|p| std::path::PathBuf::from(p).join("deepseek-token-dash"))
}
