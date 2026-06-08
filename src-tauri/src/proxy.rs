use reqwest::Client;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::Emitter;

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct ProxyEvent {
    pub api_key_label: String,
    pub api_key_color: String,
    pub model: String,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub cost: f64,
    pub duration_ms: i64,
}

pub fn start_proxy(app_handle: tauri::AppHandle, db_path: String) {

    // We'll use a simple approach: start the proxy in a background thread
    // using tokio. The proxy will listen on 127.0.0.1:8800.
    let app_handle = app_handle.clone();

    tokio::spawn(async move {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:8800").await;
        match listener {
            Ok(listener) => {
                println!("Proxy listening on 127.0.0.1:8800");
                loop {
                    if let Ok((stream, _)) = listener.accept().await {
                        let client = Client::new();
                        let db_path = db_path.clone();
                        let app_handle = app_handle.clone();

                        tokio::spawn(async move {
                            handle_connection(stream, client, &db_path, &app_handle).await;
                        });
                    }
                }
            }
            Err(e) => {
                eprintln!("Failed to bind proxy: {}", e);
            }
        }
    });
}

async fn handle_connection(
    mut stream: tokio::net::TcpStream,
    client: Client,
    db_path: &str,
    app_handle: &tauri::AppHandle,
) {
    use tokio::io::AsyncReadExt;

    let mut buf = [0u8; 65536];
    let n = match stream.read(&mut buf).await {
        Ok(n) if n > 0 => n,
        _ => return,
    };

    let request_str = String::from_utf8_lossy(&buf[..n]);

    // Parse the HTTP request to extract method, path, headers, body
    let lines: Vec<&str> = request_str.split("\r\n").collect();
    if lines.is_empty() {
        return;
    }

    let first_line: Vec<&str> = lines[0].split(' ').collect();
    if first_line.len() < 2 {
        return;
    }

    let method = first_line[0].to_string();
    let path = first_line[1].to_string();

    // Extract headers
    let mut api_key_raw = String::new();
    let mut content_type = String::new();
    let mut body_start = 0;

    for (i, line) in lines.iter().enumerate() {
        if line.is_empty() {
            body_start = i + 1;
            break;
        }
        let lower = line.to_lowercase();
        if lower.starts_with("authorization: bearer ") {
            api_key_raw = line[22..].trim().to_string();
        }
        if lower.starts_with("content-type: ") {
            content_type = line[14..].trim().to_string();
        }
    }

    // Find the body
    let body = if body_start > 0 && body_start < lines.len() {
        lines[body_start..].join("\r\n")
    } else {
        // Try to find double CRLF for body
        if let Some(pos) = request_str.find("\r\n\r\n") {
            request_str[pos + 4..].to_string()
        } else {
            String::new()
        }
    };

    let target_url = format!("https://api.deepseek.com{}", path);
    let start_time = std::time::Instant::now();

    // Forward request to DeepSeek
    let mut req = match method.as_str() {
        "POST" => client.post(&target_url),
        "GET" => client.get(&target_url),
        _ => client.post(&target_url),
    };

    req = req.header("Authorization", format!("Bearer {}", api_key_raw));
    if !content_type.is_empty() {
        req = req.header("Content-Type", &content_type);
    }

    // Pass through other important headers
    for line in &lines[1..] {
        if line.is_empty() { break; }
        let lower = line.to_lowercase();
        if !lower.starts_with("authorization:") && !lower.starts_with("content-type:") && !lower.starts_with("host:") {
            if let Some(colon_pos) = line.find(':') {
                let key = &line[..colon_pos].trim();
                let value = &line[colon_pos + 1..].trim();
                req = req.header(key.to_string(), value.to_string());
            }
        }
    }

    if !body.is_empty() {
        req = req.body(body);
    }

    // Send and get response
    let response = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            let err_msg = format!("HTTP/1.1 502 Bad Gateway\r\nContent-Length: {}\r\n\r\nProxy error: {}",
                e.to_string().len() + 13, e);
            let _ = tokio::io::AsyncWriteExt::write_all(&mut stream, err_msg.as_bytes()).await;
            return;
        }
    };

    let status = response.status();
    let resp_headers = response.headers().clone();

    // Extract DeepSeek token usage header
    let usage_header = resp_headers
        .get("x-ds-usage")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let resp_body = response.text().await.unwrap_or_default();
    let duration_ms = start_time.elapsed().as_millis() as i64;

    // Process token data in background
    if let Some(usage_str) = usage_header {
        if let Ok(usage) = serde_json::from_str::<Value>(&usage_str) {
            let model = extract_model_from_request(&request_str);
            let prompt_tokens = usage["prompt_tokens"].as_i64().unwrap_or(0);
            let completion_tokens = usage["completion_tokens"].as_i64().unwrap_or(0);
            let total_tokens = usage["total_tokens"].as_i64().unwrap_or(0);

            let key_hash = format!("{:x}", Sha256::digest(api_key_raw.as_bytes()));

            // Store in DB
            if let Ok(db) = rusqlite::Connection::open(db_path) {
                // Find or create API key
                let key_id: i64 = db
                    .query_row(
                        "SELECT id FROM api_keys WHERE key_hash = ?1",
                        rusqlite::params![key_hash],
                        |row| row.get(0),
                    )
                    .unwrap_or_else(|_| {
                        // Auto-register unknown key
                        let prefix = if api_key_raw.len() > 10 {
                            format!("{}...{}", &api_key_raw[..6], &api_key_raw[api_key_raw.len()-4..])
                        } else {
                            api_key_raw.clone()
                        };
                        db.execute(
                            "INSERT INTO api_keys (label, key_hash, key_prefix, color, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                            rusqlite::params![prefix, key_hash, prefix, "#fbbf24",
                                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64],
                        ).ok();
                        db.last_insert_rowid()
                    });

                // Calculate cost
                let cost = calculate_cost(&db, &model, prompt_tokens, completion_tokens);

                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as i64;

                db.execute(
                    "INSERT INTO requests (api_key_id, timestamp, model, prompt_tokens, completion_tokens, total_tokens, cost, duration_ms, endpoint)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    rusqlite::params![key_id, now, model, prompt_tokens, completion_tokens, total_tokens, cost, duration_ms, path],
                ).ok();

                // Get key label and color for event
                let (label, color): (String, String) = db
                    .query_row(
                        "SELECT label, color FROM api_keys WHERE id = ?1",
                        rusqlite::params![key_id],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .unwrap_or((String::from("Unknown"), String::from("#fbbf24")));

                // Send event to frontend
                let event = ProxyEvent {
                    api_key_label: label,
                    api_key_color: color,
                    model,
                    prompt_tokens,
                    completion_tokens,
                    total_tokens,
                    cost,
                    duration_ms,
                };
                let _ = app_handle.emit("token-usage", event);
            }
        }
    }

    // Build and send response back to client
    let mut response_str = format!("HTTP/1.1 {} {}\r\n", status.as_u16(), status.canonical_reason().unwrap_or("OK"));
    for (key, value) in resp_headers.iter() {
        if key.as_str() != "transfer-encoding" {
            response_str.push_str(&format!("{}: {}\r\n", key.as_str(), value.to_str().unwrap_or("")));
        }
    }
    response_str.push_str(&format!("Content-Length: {}\r\n\r\n", resp_body.len()));
    response_str.push_str(&resp_body);

    let _ = tokio::io::AsyncWriteExt::write_all(&mut stream, response_str.as_bytes()).await;
}

fn extract_model_from_request(request: &str) -> String {
    // Try to parse the JSON body to get model name
    if let Some(body_start) = request.find("\r\n\r\n") {
        let body = &request[body_start + 4..];
        if let Ok(json) = serde_json::from_str::<Value>(body) {
            if let Some(model) = json["model"].as_str() {
                return model.to_string();
            }
        }
    }
    String::from("unknown")
}

fn calculate_cost(db: &rusqlite::Connection, model: &str, prompt_tokens: i64, completion_tokens: i64) -> f64 {
    let pricing: Option<(f64, f64)> = db
        .query_row(
            "SELECT input_price_per_1m, output_price_per_1m FROM model_pricing WHERE model = ?1",
            rusqlite::params![model],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();

    if let Some((input_price, output_price)) = pricing {
        (prompt_tokens as f64 / 1_000_000.0) * input_price
            + (completion_tokens as f64 / 1_000_000.0) * output_price
    } else {
        0.0
    }
}
