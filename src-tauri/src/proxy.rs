use axum::{
    body::Body,
    extract::{Request, State},
    http::{HeaderValue, Method},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use http_body_util::BodyExt;
use hyper::{StatusCode, Uri};
use hyper_tls::HttpsConnector;
use hyper_util::{client::legacy::connect::HttpConnector, rt::TokioExecutor};
use serde_json::json;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri_plugin_store::StoreExt;
use tokio::{
    net::TcpListener,
    sync::{oneshot, Mutex},
    task::JoinHandle,
};
type Client = hyper_util::client::legacy::Client<HttpsConnector<HttpConnector>, Body>;

#[allow(dead_code)]
pub struct ServerState {
    server_task_handle: JoinHandle<Result<(), axum::BoxError>>,
    shutdown_sender: oneshot::Sender<()>,
    bound_addr: SocketAddr,
}

pub type SharedServerState = Arc<Mutex<Option<ServerState>>>;

struct ServerContext {
    client: Client,
    conf: Config,
    cached_models: Vec<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct Config {
    addr: String,
    port: i32,
    apikey: String,
    api_addr: String,
    skills: Vec<String>,
    selected_models: Vec<String>,
}

impl ServerState {
    async fn start_server(conf: Config) -> Result<Self, String> {
        let listen_addr = format!("{}:{}", conf.addr, conf.port);
        println!("{}", listen_addr);
        let listener = TcpListener::bind(&listen_addr)
            .await
            .map_err(|e| format!("Failed to bind to address: {}", e))?;
        let bound_addr = listener
            .local_addr()
            .map_err(|e| format!("Failed to get local address: {}", e))?;
        let (shutdown_sender, shutdown_receiver) = oneshot::channel::<()>();
        let https = HttpsConnector::new();
        let mut client_builder = hyper_util::client::legacy::Client::builder(TokioExecutor::new());
        // Configure connection pool: idle connections expire after 10s to reduce stale connection errors
        client_builder.pool_idle_timeout(Duration::from_secs(10));
        // Limit max idle connections per host to reduce resource usage
        client_builder.pool_max_idle_per_host(2);
        // Retry requests that fail because the pooled connection was closed by the server
        client_builder.retry_canceled_requests(true);
        let client: Client = client_builder.build(https);
        let mut skills = conf.skills.clone();
        skills.push("completion".to_string());

        // Fetch models from upstream API on startup
        let cached_models = fetch_models_from_api(&conf.api_addr, &conf.apikey).await;
        println!("Cached {} models on startup", cached_models.len());

        let app = Router::new()
            .route("/", get(|| async { Json(json!({"hello":"world"})) }))
            .route(
                "/api/version",
                get(|| async {
                    Json(json!({
                        "version":"0.11.0"
                    }))
                }),
            )
            .route(
                "/api/tags",
                get(|State(ctx): State<Arc<ServerContext>>| async move {
                    println!("get api tags");
                    let models_to_return = if ctx.conf.selected_models.is_empty() {
                        ctx.cached_models.clone()
                    } else {
                        ctx.cached_models
                            .iter()
                            .filter(|m| ctx.conf.selected_models.contains(m))
                            .cloned()
                            .collect()
                    };
                    let models: Vec<serde_json::Value> = models_to_return
                        .iter()
                        .map(|m| json!({"model": m, "name": m}))
                        .collect();
                    Json(json!({"models": models}))
                }),
            )
            .route("/v1/chat/completions", post(post_chat_completions))
            .route(
                "/api/show",
                post(async move || {
                    Json(json!({
                        "model_info": { "general.architecture": "qwen2" },
                        "capabilities":skills,
                    }))
                }),
            )
            .with_state(Arc::new(ServerContext {
                client: client,
                conf: conf,
                cached_models,
            }));

        let server_task_handle = tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    shutdown_receiver.await.ok();
                    println!("Server shutting down");
                })
                .await
                .map_err(|e| e.into())
        });
        Ok(ServerState {
            server_task_handle: server_task_handle,
            shutdown_sender: shutdown_sender,
            bound_addr: bound_addr,
        })
    }
}

#[tauri::command]
pub async fn start_server(handle: tauri::AppHandle) -> Result<(), String> {
    handle
        .emit_to("main", "connect_status", "connecting")
        .unwrap();
    let result = start_api_server(handle.clone()).await;
    if result.is_err() {
        handle
            .emit_to("main", "connect_status", "disconnected")
            .unwrap();
    }
    result
}

pub async fn start_api_server(handle: tauri::AppHandle) -> Result<(), String> {
    let server_state_arc = handle.state::<SharedServerState>();
    let mut server_state = server_state_arc.lock().await;
    if server_state.is_some() {
        return Err("Server already running".to_string());
    }
    let stores = handle.store("config.json");
    if let Ok(store) = stores {
        let conf = store.get("config");
        if let Some(conf) = conf {
            let conf = serde_json::from_value::<Config>(conf)
                .map_err(|e| format!("Invalid config format: {}", e))?;
            println!(
                "Starting server with config - addr: {}, port: {}",
                conf.addr, conf.port
            );
            match ServerState::start_server(conf).await {
                Ok(state) => {
                    *server_state = Some(state);
                    handle
                        .emit_to("main", "connect_status", "connected")
                        .unwrap();
                    println!("Server started ");
                    return Ok(());
                }
                Err(e) => {
                    eprintln!("Failed to start server: {}", e);
                    return Err(format!("Failed to start server: {}", e));
                }
            }
        }
    }

    Err("No valid config found".to_string())
}

async fn post_chat_completions(
    State(ctx): State<Arc<ServerContext>>,
    mut req: Request,
) -> Result<Response, StatusCode> {
    // Strip hop-by-hop headers that should not be forwarded
    // See: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers#hop-by-hop_headers
    req.headers_mut().remove("Connection");
    req.headers_mut().remove("Keep-Alive");
    req.headers_mut().remove("Proxy-Authenticate");
    req.headers_mut().remove("Proxy-Authorization");
    req.headers_mut().remove("TE");
    req.headers_mut().remove("Trailers");
    req.headers_mut().remove("Transfer-Encoding");
    req.headers_mut().remove("Upgrade");
    // Remove Content-Length since we may have modified the body
    req.headers_mut().remove("Content-Length");

    // Set upstream Authorization header (use insert to avoid duplicates)
    req.headers_mut().insert(
        "Authorization",
        HeaderValue::from_str(format!("Bearer {}", ctx.conf.apikey).as_str()).unwrap(),
    );
    let mut url = ctx.conf.api_addr.clone();
    if url.ends_with("/") {
        url.pop();
    }

    let dst_uri = Uri::try_from(format!("{}/chat/completions", url)).unwrap();
    println!("dst host:{}", dst_uri.host().unwrap());
    // Use insert instead of append to avoid duplicate Host headers
    req.headers_mut().insert(
        "Host",
        HeaderValue::from_str(dst_uri.host().unwrap()).unwrap(),
    );
    *req.uri_mut() = dst_uri.clone();

    // Collect the request body bytes upfront so we can reconstruct the request on retry
    let body_bytes = req
        .into_body()
        .collect()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?
        .to_bytes();

    // Retry on connection errors (e.g. stale pooled connection closed by server)
    let max_retries = 2;
    for attempt in 0..=max_retries {
        let retry_req = hyper::Request::builder()
            .method(Method::POST)
            .uri(dst_uri.clone())
            .header("Content-Type", "application/json")
            .header(
                "Authorization",
                HeaderValue::from_str(format!("Bearer {}", ctx.conf.apikey).as_str()).unwrap(),
            )
            .header(
                "Host",
                HeaderValue::from_str(dst_uri.host().unwrap()).unwrap(),
            )
            .body(Body::from(body_bytes.clone()))
            .map_err(|_| StatusCode::BAD_GATEWAY)?;

        match ctx.client.request(retry_req).await {
            Ok(resp) => return Ok(resp.into_response()),
            Err(e) => {
                let is_connection_err = e.is_connect()
                    || e.to_string().contains("closed")
                    || e.to_string().contains("reset")
                    || e.to_string().contains("broken pipe");
                eprintln!(
                    "Upstream request failed (attempt {}/{}): {}",
                    attempt + 1,
                    max_retries + 1,
                    e
                );
                if !is_connection_err || attempt == max_retries {
                    return Err(StatusCode::BAD_GATEWAY);
                }
                // Brief pause before retrying to allow connection pool cleanup
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
    }
    Err(StatusCode::BAD_GATEWAY)
}

pub async fn stop_server(handle: tauri::AppHandle) -> Result<String, String> {
    let server_state_arc = handle.state::<SharedServerState>();
    let mut server_state = server_state_arc.lock().await;
    if let Some(state) = server_state.take() {
        let _ = state
            .shutdown_sender
            .send(())
            .map_err(|_| "Failed to send shutdown signal")?;
        tokio::spawn(async move {
            println!("waiting server stopped");
            if let Err(e) = state.server_task_handle.await {
                eprintln!("Server task failed: {}", e);
            }
        });
        handle
            .emit_to("main", "connect_status", "disconnected")
            .unwrap();
        return Ok("Server stopped".to_string());
    }
    Ok("Server not running".to_string())
}

#[tauri::command]
pub async fn stop(handle: tauri::AppHandle) -> Result<String, String> {
    return stop_server(handle).await;
}

#[tauri::command]
pub async fn restart(handle: tauri::AppHandle) -> Result<(), String> {
    let _ = stop_server(handle.clone()).await;
    return start_server(handle).await;
}

async fn fetch_models_from_api(api_addr: &str, apikey: &str) -> Vec<String> {
    let https = HttpsConnector::new();
    let mut client_builder = hyper_util::client::legacy::Client::builder(TokioExecutor::new());
    client_builder.pool_idle_timeout(Duration::from_secs(10));
    client_builder.pool_max_idle_per_host(2);
    client_builder.retry_canceled_requests(true);
    let client = client_builder.build(https);

    let mut url = api_addr.to_string();
    if url.ends_with('/') {
        url.pop();
    }
    let uri = format!("{}/models", url);
    let uri = match uri.parse::<Uri>() {
        Ok(u) => u,
        Err(_) => return Vec::new(),
    };

    let req = match hyper::Request::builder()
        .method(Method::GET)
        .uri(uri)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", apikey))
        .body(Body::empty())
    {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    let resp = match client.request(req).await {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    if !resp.status().is_success() {
        return Vec::new();
    }

    let body = match resp.into_body().collect().await {
        Ok(b) => b,
        Err(_) => return Vec::new(),
    };
    let text = match String::from_utf8(body.to_bytes().to_vec()) {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };
    let json: serde_json::Value = match serde_json::from_str(&text) {
        Ok(j) => j,
        Err(_) => return Vec::new(),
    };

    json.get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    item.get("id")
                        .and_then(|id| id.as_str())
                        .map(|s| s.to_string())
                })
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub async fn fetch_models(api_addr: String, apikey: String) -> Result<Vec<String>, String> {
    let models = fetch_models_from_api(&api_addr, &apikey).await;
    if models.is_empty() {
        return Err("Failed to fetch models".to_string());
    }
    Ok(models)
}
