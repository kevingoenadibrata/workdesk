//! Phone mirror (WD-24): a copy of Workdesk's tabs, agents and terminals for
//! your phone, over Tailscale, that can also type into a terminal (WD-32).
//!
//! A small HTTP server listens on 127.0.0.1 only. `tailscale serve` forwards
//! `https://<this-mac>.<tailnet>.ts.net:8443` to it, so the phone gets a real
//! HTTPS origin and nothing is reachable from outside the tailnet. Every request
//! must carry the `Tailscale-User-Login` that serve adds, and it must be the
//! person signed in to Tailscale on this Mac, so other people on a shared
//! tailnet can't look in. POSTs must also come from the mirror's own origin.
//! The only thing the phone can send a terminal is `/api/pty/<id>/input`:
//! a message (typed and submitted, as at the Mac's keyboard) or one of a few
//! named keys (`KEYS`). The Mac's pane shows it like any other typing.
//!
//! The webview sends the tab list (`phone_state`) and, when a phone opens a
//! terminal, that terminal's current screen (`phone_snapshot`). Live output
//! comes straight from the PTY reader (`pty::watch`). Both go to the phone as
//! server-sent events.

use std::{
    collections::HashMap,
    convert::Infallible,
    path::PathBuf,
    pin::Pin,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    task::{Context, Poll},
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD, Engine};
use bytes::Bytes;
use http_body::{Body, Frame};
use http_body_util::{combinators::UnsyncBoxBody, BodyExt, Full, Limited};
use hyper::{body::Incoming, header, server::conn::http1, service::service_fn, Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{broadcast, mpsc, oneshot, watch};

use crate::{
    pty::{self, PtyState, Tap},
    tailscale, webpush,
};

/// The server's port on 127.0.0.1.
pub const PORT: u16 = 47390;
/// The HTTPS port `tailscale serve` opens on the tailnet.
pub const HTTPS_PORT: u16 = 8443;
/// Phone requests that can't be answered in time give up after this.
const SNAPSHOT_WAIT: Duration = Duration::from_secs(3);
/// Streams send a comment this often so idle connections aren't dropped.
const PING: Duration = Duration::from_secs(15);

fn target() -> String {
    format!("http://127.0.0.1:{PORT}")
}

type Resp = Response<UnsyncBoxBody<Bytes, Infallible>>;

#[derive(Clone)]
struct Owner {
    login: String,
    host: String,
}

struct Phone {
    app: AppHandle,
    /// Set while the server runs; sending on it stops the server and its streams.
    stop: Mutex<Option<broadcast::Sender<()>>>,
    /// Whose phone may connect, and this Mac's tailnet name.
    owner: Mutex<Option<Owner>>,
    /// This person's phones as Tailscale last listed them, to name who's connected.
    phones: Mutex<Vec<tailscale::Device>>,
    /// The latest tab list from the webview, as JSON.
    state: watch::Sender<String>,
    /// Phones with the app open, by stream id.
    viewers: Mutex<HashMap<u64, String>>,
    next_id: AtomicU64,
    /// Screens asked of the webview and not yet answered, by request id.
    snapshots: Mutex<HashMap<u64, oneshot::Sender<Snapshot>>>,
    /// Each agent's status at the last `phone_state`, by PTY id, to notice changes.
    agents: Mutex<HashMap<u64, String>>,
    subscriptions: Mutex<Vec<webpush::Subscription>>,
    error: Mutex<Option<String>>,
}

static PHONE: OnceLock<Phone> = OnceLock::new();
static VAPID: OnceLock<webpush::Vapid> = OnceLock::new();

fn phone() -> &'static Phone {
    PHONE.get().expect("phone::init runs at startup")
}

fn dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    PathBuf::from(home).join(".workdesk").join("phone")
}

fn subscriptions_path() -> PathBuf {
    dir().join("push.json")
}

fn vapid() -> Result<&'static webpush::Vapid, String> {
    if let Some(v) = VAPID.get() {
        return Ok(v);
    }
    let v = webpush::Vapid::load_or_create(&dir().join("vapid.pk8"))?;
    Ok(VAPID.get_or_init(|| v))
}

pub fn init(app: &AppHandle) {
    let subscriptions = std::fs::read(subscriptions_path())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    let _ = PHONE.set(Phone {
        app: app.clone(),
        stop: Mutex::new(None),
        owner: Mutex::new(None),
        phones: Mutex::new(Vec::new()),
        state: watch::channel("{}".to_string()).0,
        viewers: Mutex::new(HashMap::new()),
        next_id: AtomicU64::new(1),
        snapshots: Mutex::new(HashMap::new()),
        agents: Mutex::new(HashMap::new()),
        subscriptions: Mutex::new(subscriptions),
        error: Mutex::new(None),
    });
    // Development only: serve without Tailscale, letting in requests that claim
    // to be "<login>" at "<host>", to test the server with curl.
    #[cfg(debug_assertions)]
    if let Some((login, host)) = std::env::var("WORKDESK_PHONE_DEV_OWNER").ok().as_deref().and_then(|v| v.split_once(' ')) {
        *phone().owner.lock().unwrap() = Some(Owner { login: login.into(), host: host.into() });
        if let Err(e) = start_server() {
            eprintln!("phone: {e}");
        }
        return;
    }
    watch_tailscale();
}

fn save_subscriptions(subs: &[webpush::Subscription]) {
    let path = subscriptions_path();
    let _ = std::fs::create_dir_all(dir());
    if let Ok(json) = serde_json::to_vec_pretty(subs) {
        let _ = std::fs::write(path, json);
    }
}

// ---- commands ----

/// Everything Settings shows about the mirror.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// The server is running.
    on: bool,
    installed: bool,
    node: Option<tailscale::Node>,
    /// Where the phone opens it, once Tailscale is running.
    url: Option<String>,
    /// `tailscale serve` forwards to the mirror.
    serving: bool,
    /// The mirror's port on the tailnet is used by something else.
    taken: bool,
    /// Phones with the app open right now.
    viewers: Vec<String>,
    /// Phones that get notifications.
    notifying: Vec<String>,
    error: Option<String>,
}

fn status_now() -> Status {
    let p = phone();
    let on = p.stop.lock().unwrap().is_some();
    let installed = tailscale::cli().is_some();
    let mut error = p.error.lock().unwrap().clone();
    let node = match installed.then(tailscale::status) {
        Some(Ok(n)) => Some(n),
        Some(Err(e)) => {
            error.get_or_insert(e);
            None
        }
        None => None,
    };
    let mut serve = tailscale::Serve::default();
    let mut url = None;
    if let Some(n) = &node {
        *p.phones.lock().unwrap() = n.phones.clone();
        if let (Some(login), Some(host), "Running") = (&n.login, &n.host, n.state.as_str()) {
            url = Some(format!("https://{host}:{HTTPS_PORT}/"));
            serve = tailscale::serve_status(host, HTTPS_PORT, &target()).unwrap_or_default();
            if on {
                // Follows a switch of Tailscale account; the new person's phones only.
                *p.owner.lock().unwrap() = Some(Owner { login: login.clone(), host: host.clone() });
            }
        }
    }
    if on && serve.funnel {
        disable();
        error = Some(format!(
            "Port {HTTPS_PORT} was opened to the internet with Tailscale Funnel, so the phone mirror turned itself off."
        ));
        *p.error.lock().unwrap() = error.clone();
    }
    let mut viewers: Vec<String> = p.viewers.lock().unwrap().values().cloned().collect();
    viewers.sort();
    viewers.dedup();
    let notifying = p
        .subscriptions
        .lock()
        .unwrap()
        .iter()
        .map(|s| s.device.clone().unwrap_or_else(|| "A phone".into()))
        .collect();
    Status {
        on: p.stop.lock().unwrap().is_some(),
        installed,
        node,
        url,
        serving: serve.ours,
        taken: serve.taken,
        viewers,
        notifying,
        error,
    }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    tauri::async_runtime::spawn_blocking(f).await.expect("phone task")
}

#[tauri::command]
pub async fn phone_status() -> Status {
    blocking(status_now).await
}

/// How often the mirror checks whether Tailscale came up.
const WATCH: Duration = Duration::from_secs(10);

/// There's no switch: the mirror is on whenever this Mac is on Tailscale.
/// Checks every few seconds and starts it once Tailscale is running and
/// signed in. Why it couldn't start (HTTPS certificates off, port taken…) is
/// kept for Settings → Phone; Tailscale being off or signed out isn't an error.
fn watch_tailscale() {
    std::thread::spawn(|| loop {
        let p = phone();
        if p.stop.lock().unwrap().is_none() && tailscale::cli().is_some() {
            let up = tailscale::status().is_ok_and(|n| n.state == "Running" && n.login.is_some());
            *p.error.lock().unwrap() = if up { enable().err() } else { None };
        }
        std::thread::sleep(WATCH);
    });
}

fn enable() -> Result<(), String> {
    let node = tailscale::status()?;
    match node.state.as_str() {
        "Running" => {}
        "Stopped" => return Err("Tailscale is off. Turn it on from the Tailscale menu, then try again.".into()),
        "NeedsLogin" | "NoState" => return Err("Sign in to Tailscale first.".into()),
        other => return Err(format!("Tailscale is {other}. Try again in a moment.")),
    }
    let (Some(login), Some(host)) = (node.login, node.host) else {
        return Err("Tailscale didn't say who's signed in.".into());
    };
    if !node.https {
        return Err("Turn on HTTPS Certificates for your tailnet (Tailscale admin console → DNS), then try again.".into());
    }
    let serve = tailscale::serve_status(&host, HTTPS_PORT, &target())?;
    if serve.funnel {
        return Err(format!("Port {HTTPS_PORT} is open to the internet with Tailscale Funnel. Turn that off first."));
    }
    if serve.taken {
        return Err(format!(
            "Port {HTTPS_PORT} on your tailnet already serves something else. Remove it with `tailscale serve --https={HTTPS_PORT} off` to use the phone mirror."
        ));
    }
    *phone().owner.lock().unwrap() = Some(Owner { login, host });
    start_server()?;
    if !serve.ours {
        if let Err(e) = tailscale::serve_on(HTTPS_PORT, &target()) {
            stop_server();
            return Err(e);
        }
    }
    Ok(())
}

fn disable() {
    stop_server();
    let owner = phone().owner.lock().unwrap().take();
    // Only remove what's ours.
    if let Some(Owner { host, .. }) = owner {
        if tailscale::serve_status(&host, HTTPS_PORT, &target()).is_ok_and(|s| s.ours) {
            let _ = tailscale::serve_off(HTTPS_PORT);
        }
    }
}

/// The tab list, from the webview after every agent poll and layout change.
#[tauri::command]
pub fn phone_state(state: Value) {
    let p = phone();
    let pushes = changes(&state, &mut p.agents.lock().unwrap());
    let text = state.to_string();
    p.state.send_if_modified(|s| {
        let changed = *s != text;
        if changed {
            *s = text;
        }
        changed
    });
    // At the desk, the desktop's own notifications are enough.
    let away = !state["focused"].as_bool().unwrap_or(false);
    if away && p.stop.lock().unwrap().is_some() {
        for payload in pushes {
            push_all(payload);
        }
    }
}

/// Notifications for agents whose status changed since `seen`, which is updated.
fn changes(state: &Value, seen: &mut HashMap<u64, String>) -> Vec<Value> {
    let mut now = HashMap::new();
    let mut out = Vec::new();
    for tab in state["tabs"].as_array().into_iter().flatten() {
        let title = tab["title"].as_str().unwrap_or("A tab");
        for pane in tab["panes"].as_array().into_iter().flatten() {
            let (Some(pty), Some(status)) = (pane["pty"].as_u64(), pane["agent"]["status"].as_str()) else { continue };
            now.insert(pty, status.to_string());
            let Some(before) = seen.get(&pty) else { continue };
            if before == status {
                continue;
            }
            let busy = matches!(before.as_str(), "working" | "thinking");
            let harness = pane["agent"]["harness"].as_str().unwrap_or("The agent");
            let detail = pane["agent"]["detail"].as_str().filter(|d| !d.is_empty());
            let (head, body) = match status {
                "waiting" => (format!("{title} needs you"), detail.map(str::to_string).unwrap_or(format!("{harness} is waiting for you."))),
                "idle" if busy => (format!("{title}: done"), format!("{harness} finished.")),
                "error" => (format!("{title}: error"), detail.map(str::to_string).unwrap_or(format!("{harness} hit an error."))),
                _ => continue,
            };
            out.push(json!({ "title": head, "body": body, "pty": pty, "tag": format!("pty-{pty}") }));
        }
    }
    *seen = now;
    out
}

/// A terminal's screen, as `@xterm/addon-serialize` writes it out.
#[derive(Deserialize, Serialize, Clone)]
pub struct Snapshot {
    cols: u16,
    rows: u16,
    data: String,
    /// Bytes of output the screen includes, to skip them in the live stream.
    #[serde(default, skip_serializing)]
    offset: u64,
}

/// The webview's answer to a `phone-snapshot` event.
#[tauri::command]
pub fn phone_snapshot(req: u64, snapshot: Snapshot) {
    if let Some(tx) = phone().snapshots.lock().unwrap().remove(&req) {
        let _ = tx.send(snapshot);
    }
}

/// The URL as a QR code, for the phone's camera.
#[tauri::command]
pub fn phone_qr(text: String) -> Result<String, String> {
    use qrcode::render::svg;
    let code = qrcode::QrCode::new(text.as_bytes()).map_err(|e| e.to_string())?;
    Ok(code
        .render::<svg::Color>()
        .min_dimensions(176, 176)
        .quiet_zone(true)
        .dark_color(svg::Color("#000000"))
        .light_color(svg::Color("#ffffff"))
        .build())
}

/// Brings up the Tailscale app, so you can turn it on or sign in.
#[tauri::command]
pub fn open_tailscale() -> Result<(), String> {
    let ok = std::process::Command::new("open").args(["-a", "Tailscale"]).status().map_err(|e| e.to_string())?.success();
    if ok { Ok(()) } else { Err("Couldn't open Tailscale.".into()) }
}

/// Forgets every phone that gets notifications.
#[tauri::command]
pub fn phone_forget_push() {
    let p = phone();
    p.subscriptions.lock().unwrap().clear();
    save_subscriptions(&[]);
}

// ---- server ----

fn start_server() -> Result<(), String> {
    let p = phone();
    let mut stop = p.stop.lock().unwrap();
    if stop.is_some() {
        return Ok(());
    }
    let listener = std::net::TcpListener::bind(("127.0.0.1", PORT)).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AddrInUse {
            format!("Port {PORT} is in use on this Mac, maybe by another copy of Workdesk.")
        } else {
            e.to_string()
        }
    })?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let (tx, _) = broadcast::channel(1);
    let mut quit = tx.subscribe();
    let stop_conn = tx.clone();
    *stop = Some(tx);
    tauri::async_runtime::spawn(async move {
        let Ok(listener) = tokio::net::TcpListener::from_std(listener) else { return };
        loop {
            tokio::select! {
                _ = quit.recv() => break,
                accepted = listener.accept() => {
                    let Ok((stream, _)) = accepted else { continue };
                    let mut quit = stop_conn.subscribe();
                    tokio::spawn(async move {
                        let conn = http1::Builder::new().serve_connection(TokioIo::new(stream), service_fn(handle));
                        tokio::select! {
                            _ = conn => {}
                            _ = quit.recv() => {}
                        }
                    });
                }
            }
        }
    });
    Ok(())
}

fn stop_server() {
    let p = phone();
    if let Some(stop) = p.stop.lock().unwrap().take() {
        let _ = stop.send(());
    }
    p.viewers.lock().unwrap().clear();
    let _ = p.app.emit_to("main", "phone-viewers", Vec::<String>::new());
}

fn stopped() -> Option<broadcast::Receiver<()>> {
    phone().stop.lock().unwrap().as_ref().map(|s| s.subscribe())
}

fn full(status: StatusCode, kind: &str, body: impl Into<Bytes>) -> Resp {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, kind)
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(Full::new(body.into()).boxed_unsync())
        .unwrap()
}

fn text(status: StatusCode, msg: &str) -> Resp {
    full(status, "text/plain; charset=utf-8", msg.to_string())
}

fn json_resp(v: Value) -> Resp {
    full(StatusCode::OK, "application/json", v.to_string())
}

/// Who's asking, by name, if they may: the Mac's own Tailscale user, through serve.
fn authorize(req: &Request<Incoming>) -> Result<String, Resp> {
    let p = phone();
    let Some(owner) = p.owner.lock().unwrap().clone() else {
        return Err(text(StatusCode::SERVICE_UNAVAILABLE, "The phone mirror is off."));
    };
    let get = |name: &str| req.headers().get(name).and_then(|v| v.to_str().ok()).unwrap_or("");
    let host = get("host");
    let hosts = [
        format!("{}:{HTTPS_PORT}", owner.host),
        owner.host.clone(),
        format!("127.0.0.1:{PORT}"),
        format!("localhost:{PORT}"),
    ];
    // Stops pages on other sites from reaching the server by rebinding their name to 127.0.0.1.
    if !hosts.iter().any(|h| h.eq_ignore_ascii_case(host)) {
        return Err(text(StatusCode::FORBIDDEN, "Unknown host."));
    }
    if !get("tailscale-user-login").eq_ignore_ascii_case(&owner.login) {
        return Err(text(
            StatusCode::FORBIDDEN,
            "This Workdesk belongs to someone else. Sign in to Tailscale on this phone with the same account as the Mac.",
        ));
    }
    if req.method() == Method::POST && get("origin") != format!("https://{}:{HTTPS_PORT}", owner.host) {
        return Err(text(StatusCode::FORBIDDEN, "Wrong origin."));
    }
    let ip = get("x-forwarded-for").split(',').next().unwrap_or("").trim().to_string();
    let name = p.phones.lock().unwrap().iter().find(|d| d.ips.contains(&ip)).map(|d| d.name.clone());
    Ok(name.unwrap_or_else(|| "A phone".into()))
}

async fn handle(req: Request<Incoming>) -> Result<Resp, Infallible> {
    let device = match authorize(&req) {
        Ok(d) => d,
        Err(r) => return Ok(r),
    };
    let path = req.uri().path().to_string();
    let res = match (req.method().clone(), path.as_str()) {
        (Method::GET, "/api/state") => state_stream(device),
        (Method::GET, p) if p.starts_with("/api/pty/") => match p["/api/pty/".len()..].parse() {
            Ok(id) => pty_stream(id),
            Err(_) => text(StatusCode::NOT_FOUND, "No such terminal."),
        },
        (Method::GET, "/api/push/key") => match vapid() {
            Ok(v) => json_resp(json!({ "key": v.public_key() })),
            Err(e) => text(StatusCode::INTERNAL_SERVER_ERROR, &e),
        },
        (Method::POST, p) if p.starts_with("/api/pty/") && p.ends_with("/input") => {
            match p["/api/pty/".len()..p.len() - "/input".len()].parse() {
                Ok(id) => input(req, id, device).await,
                Err(_) => text(StatusCode::NOT_FOUND, "No such terminal."),
            }
        }
        (Method::POST, "/api/push/subscribe") => subscribe(req, device).await,
        (Method::POST, "/api/push/unsubscribe") => unsubscribe(req).await,
        (Method::POST, "/api/push/test") => push_test(req).await,
        (Method::GET, _) => asset(&path).await,
        _ => text(StatusCode::METHOD_NOT_ALLOWED, "Not allowed."),
    };
    Ok(res)
}

// ---- streams ----

/// A server-sent event stream fed by a channel; ends when the channel does.
struct Sse(mpsc::Receiver<Bytes>);

impl Body for Sse {
    type Data = Bytes;
    type Error = Infallible;
    fn poll_frame(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Result<Frame<Bytes>, Infallible>>> {
        self.0.poll_recv(cx).map(|b| b.map(|b| Ok(Frame::data(b))))
    }
}

fn sse(rx: mpsc::Receiver<Bytes>) -> Resp {
    Response::builder()
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Accel-Buffering", "no")
        .body(Sse(rx).boxed_unsync())
        .unwrap()
}

fn event(name: &str, data: &str) -> Bytes {
    Bytes::from(format!("event: {name}\ndata: {data}\n\n"))
}

fn ping() -> Bytes {
    Bytes::from_static(b": ping\n\n")
}

/// Counts a phone as watching while its tab-list stream is open.
struct Viewer(u64);

impl Viewer {
    fn new(device: String) -> Self {
        let p = phone();
        let id = p.next_id.fetch_add(1, Ordering::Relaxed);
        let names = {
            let mut viewers = p.viewers.lock().unwrap();
            viewers.insert(id, device);
            viewer_names(&viewers)
        };
        let _ = p.app.emit_to("main", "phone-viewers", names);
        Self(id)
    }
}

impl Drop for Viewer {
    fn drop(&mut self) {
        let p = phone();
        let names = {
            let mut viewers = p.viewers.lock().unwrap();
            viewers.remove(&self.0);
            viewer_names(&viewers)
        };
        let _ = p.app.emit_to("main", "phone-viewers", names);
    }
}

fn viewer_names(viewers: &HashMap<u64, String>) -> Vec<String> {
    let mut names: Vec<String> = viewers.values().cloned().collect();
    names.sort();
    names.dedup();
    names
}

fn state_stream(device: String) -> Resp {
    let Some(mut quit) = stopped() else { return text(StatusCode::SERVICE_UNAVAILABLE, "The phone mirror is off.") };
    let (tx, rx) = mpsc::channel(16);
    let mut state = phone().state.subscribe();
    let viewer = Viewer::new(device);
    tokio::spawn(async move {
        let _viewer = viewer;
        let first = state.borrow_and_update().clone();
        if tx.send(event("state", &first)).await.is_err() {
            return;
        }
        let mut tick = tokio::time::interval(PING);
        tick.tick().await;
        loop {
            let msg = tokio::select! {
                changed = state.changed() => {
                    if changed.is_err() { break }
                    let s = state.borrow_and_update().clone();
                    event("state", &s)
                }
                _ = tick.tick() => ping(),
                _ = quit.recv() => break,
            };
            if tx.send(msg).await.is_err() {
                break;
            }
        }
    });
    sse(rx)
}

/// Asks the webview for terminal `pty`'s screen.
async fn snapshot(pty: u32) -> Option<Snapshot> {
    let p = phone();
    let req = p.next_id.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    p.snapshots.lock().unwrap().insert(req, tx);
    let _ = p.app.emit_to("main", "phone-snapshot", json!({ "req": req, "pty": pty }));
    let got = tokio::time::timeout(SNAPSHOT_WAIT, rx).await;
    p.snapshots.lock().unwrap().remove(&req);
    got.ok()?.ok()
}

/// Sends the screen; returns how much output it covers.
async fn send_snapshot(tx: &mpsc::Sender<Bytes>, pty: u32) -> Option<u64> {
    let snap = snapshot(pty).await.unwrap_or(Snapshot { cols: 80, rows: 24, data: String::new(), offset: 0 });
    let msg = serde_json::to_string(&snap).ok()?;
    tx.send(event("snapshot", &msg)).await.ok()?;
    Some(snap.offset)
}

/// Part of `bytes` (output starting at byte `at`) past `seen`, if any.
fn unseen(at: u64, bytes: &Bytes, seen: u64) -> Option<Bytes> {
    let end = at + bytes.len() as u64;
    (end > seen).then(|| bytes.slice(seen.saturating_sub(at) as usize..))
}

fn pty_stream(id: u32) -> Resp {
    let Some(mut quit) = stopped() else { return text(StatusCode::SERVICE_UNAVAILABLE, "The phone mirror is off.") };
    // Subscribe before asking for the screen, so nothing printed in between is missed.
    let Some(mut output) = pty::watch(&phone().app.state::<PtyState>(), id) else {
        return text(StatusCode::NOT_FOUND, "No such terminal.");
    };
    let (tx, rx) = mpsc::channel(64);
    tokio::spawn(async move {
        let Some(mut seen) = send_snapshot(&tx, id).await else { return };
        let mut tick = tokio::time::interval(PING);
        tick.tick().await;
        loop {
            let msg = tokio::select! {
                got = output.recv() => match got {
                    Ok(Tap::Data { at, bytes }) => {
                        let Some(new) = unseen(at, &bytes, seen) else { continue };
                        seen = at + bytes.len() as u64;
                        event("data", &STANDARD.encode(&new))
                    }
                    Ok(Tap::Resize(cols, rows)) => event("resize", &json!({ "cols": cols, "rows": rows }).to_string()),
                    // The phone fell behind: start over from the current screen.
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        output = output.resubscribe();
                        match send_snapshot(&tx, id).await {
                            Some(offset) => { seen = offset; continue }
                            None => break,
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        let _ = tx.send(event("exit", "{}")).await;
                        break;
                    }
                },
                _ = tick.tick() => ping(),
                _ = quit.recv() => break,
            };
            if tx.send(msg).await.is_err() {
                break;
            }
        }
    });
    sse(rx)
}

// ---- typing from the phone ----

/// Keys the phone's key row can press, by name, and what each sends.
const KEYS: &[(&str, &str)] = &[
    ("enter", "\r"),
    ("esc", "\x1b"),
    ("tab", "\t"),
    ("shift-tab", "\x1b[Z"),
    ("up", "\x1b[A"),
    ("down", "\x1b[B"),
    ("right", "\x1b[C"),
    ("left", "\x1b[D"),
    ("backspace", "\x7f"),
    ("ctrl-c", "\x03"),
];

/// Wait between a message and the Enter that submits it, so TUIs like Claude
/// Code don't take the Enter as part of a paste.
const SUBMIT_DELAY: Duration = Duration::from_millis(80);

#[derive(Deserialize)]
struct Input {
    /// A message to type, then submit with Enter.
    #[serde(default)]
    text: Option<String>,
    /// Or one key from `KEYS`.
    #[serde(default)]
    key: Option<String>,
}

fn key_bytes(name: &str) -> Option<&'static str> {
    KEYS.iter().find(|(k, _)| *k == name).map(|(_, b)| *b)
}

/// A message as it's typed: line breaks as Option+Enter (a new line in an agent's
/// prompt, rather than sending it), and no other control characters, so a message
/// can't smuggle in escape sequences.
fn typed(text: &str) -> String {
    let text = text.replace("\r\n", "\n");
    let mut out = String::with_capacity(text.len());
    for c in text.trim_end().chars() {
        match c {
            '\n' | '\r' => out.push_str("\x1b\r"),
            '\t' => out.push(' '),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    out
}

/// Types a message or presses a key in terminal `id`, and tells the Mac who did.
async fn input(req: Request<Incoming>, id: u32, device: String) -> Resp {
    let body: Input = match read_json(req).await {
        Ok(b) => b,
        Err(r) => return r,
    };
    let p = phone();
    let state = p.app.state::<PtyState>();
    let what = match (body.text.as_deref(), body.key.as_deref()) {
        (Some(t), None) => {
            let t = typed(t);
            if t.trim().is_empty() {
                return text(StatusCode::BAD_REQUEST, "Nothing to send.");
            }
            if let Err(e) = pty::write(&state, id, t.as_bytes()) {
                return text(StatusCode::NOT_FOUND, &e);
            }
            tokio::time::sleep(SUBMIT_DELAY).await;
            "message"
        }
        (None, Some(k)) => {
            if key_bytes(k).is_none() {
                return text(StatusCode::BAD_REQUEST, "Unknown key.");
            }
            k
        }
        _ => return text(StatusCode::BAD_REQUEST, "Send a message or a key."),
    };
    let bytes = if what == "message" { "\r" } else { key_bytes(what).unwrap_or_default() };
    if let Err(e) = pty::write(&state, id, bytes.as_bytes()) {
        return text(StatusCode::NOT_FOUND, &e);
    }
    let _ = p.app.emit_to("main", "phone-input", json!({ "pty": id, "device": device, "message": what == "message" }));
    full(StatusCode::NO_CONTENT, "text/plain", "")
}

// ---- push ----

async fn read_json<T: for<'de> Deserialize<'de>>(req: Request<Incoming>) -> Result<T, Resp> {
    let body = Limited::new(req.into_body(), 16 * 1024)
        .collect()
        .await
        .map_err(|_| text(StatusCode::PAYLOAD_TOO_LARGE, "Too big."))?
        .to_bytes();
    serde_json::from_slice(&body).map_err(|_| text(StatusCode::BAD_REQUEST, "Malformed."))
}

async fn subscribe(req: Request<Incoming>, device: String) -> Resp {
    let mut sub: webpush::Subscription = match read_json(req).await {
        Ok(s) => s,
        Err(r) => return r,
    };
    if !sub.endpoint.starts_with("https://") {
        return text(StatusCode::BAD_REQUEST, "Not a push service.");
    }
    sub.device = Some(device);
    let p = phone();
    let mut subs = p.subscriptions.lock().unwrap();
    subs.retain(|s| s.endpoint != sub.endpoint);
    subs.push(sub);
    save_subscriptions(&subs);
    full(StatusCode::NO_CONTENT, "text/plain", "")
}

#[derive(Deserialize)]
struct Endpoint {
    endpoint: String,
}

async fn unsubscribe(req: Request<Incoming>) -> Resp {
    let e: Endpoint = match read_json(req).await {
        Ok(e) => e,
        Err(r) => return r,
    };
    let p = phone();
    let mut subs = p.subscriptions.lock().unwrap();
    subs.retain(|s| s.endpoint != e.endpoint);
    save_subscriptions(&subs);
    full(StatusCode::NO_CONTENT, "text/plain", "")
}

fn forget(endpoint: &str) {
    let p = phone();
    let mut subs = p.subscriptions.lock().unwrap();
    subs.retain(|s| s.endpoint != endpoint);
    save_subscriptions(&subs);
}

/// Sends a notification to the phone that asks, and says whether it went.
async fn push_test(req: Request<Incoming>) -> Resp {
    let e: Endpoint = match read_json(req).await {
        Ok(e) => e,
        Err(r) => return r,
    };
    let sub = phone().subscriptions.lock().unwrap().iter().find(|s| s.endpoint == e.endpoint).cloned();
    let Some(sub) = sub else { return text(StatusCode::NOT_FOUND, "This phone isn't signed up for notifications.") };
    let vapid = match vapid() {
        Ok(v) => v,
        Err(e) => return text(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };
    let payload = json!({ "title": "Workdesk", "body": "Notifications work. You'll hear when an agent needs you or finishes.", "tag": "test" });
    match webpush::send(crate::tickets::client(), vapid, &sub, payload.to_string().as_bytes()).await {
        webpush::Sent::Ok => full(StatusCode::NO_CONTENT, "text/plain", ""),
        webpush::Sent::Gone => {
            forget(&sub.endpoint);
            text(StatusCode::GONE, "The push service no longer knows this phone. Turn notifications on again.")
        }
        webpush::Sent::Failed(e) => text(StatusCode::BAD_GATEWAY, &e),
    }
}

fn push_all(payload: Value) {
    let subs = phone().subscriptions.lock().unwrap().clone();
    if subs.is_empty() {
        return;
    }
    let vapid = match vapid() {
        Ok(v) => v,
        Err(e) => return eprintln!("phone push: {e}"),
    };
    let body = payload.to_string();
    tauri::async_runtime::spawn(async move {
        for sub in subs {
            match webpush::send(crate::tickets::client(), vapid, &sub, body.as_bytes()).await {
                webpush::Sent::Ok => {}
                webpush::Sent::Gone => forget(&sub.endpoint),
                webpush::Sent::Failed(e) => eprintln!("phone push: {e}"),
            }
        }
    });
}

// ---- the web app ----

/// Files the phone may load: the page, its bundle, and what's in public/ for it.
fn servable(file: &str) -> bool {
    !file.contains("..") && (file.starts_with("phone") || file.starts_with("assets/"))
}

async fn asset(path: &str) -> Resp {
    let file = match path {
        "/" | "/index.html" => "phone.html".to_string(),
        p => p.trim_start_matches('/').to_string(),
    };
    // In development the page comes from Vite's dev server, as the app's does.
    #[cfg(debug_assertions)]
    if let Some(r) = from_dev_server(path).await {
        return r;
    }
    if !servable(&file) {
        return text(StatusCode::NOT_FOUND, "Not found.");
    }
    let Some(found) = phone().app.asset_resolver().get(file.clone()) else {
        return text(StatusCode::NOT_FOUND, "Not found.");
    };
    // Hashed bundle files never change; everything else is checked each time.
    let cache = if file.starts_with("assets/") { "public, max-age=31536000, immutable" } else { "no-cache" };
    Response::builder()
        .header(header::CONTENT_TYPE, found.mime_type)
        .header(header::CACHE_CONTROL, cache)
        .header("X-Content-Type-Options", "nosniff")
        .header("X-Frame-Options", "DENY")
        .header("Referrer-Policy", "no-referrer")
        .header(
            "Content-Security-Policy",
            "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
        )
        .body(Full::new(Bytes::from(found.bytes)).boxed_unsync())
        .unwrap()
}

#[cfg(debug_assertions)]
async fn from_dev_server(path: &str) -> Option<Resp> {
    let path = if path == "/" { "/phone.html" } else { path };
    let res = crate::tickets::client().get(format!("http://localhost:1420{path}")).send().await.ok()?;
    let status = StatusCode::from_u16(res.status().as_u16()).ok()?;
    let kind = res.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("application/octet-stream").to_string();
    let body = res.bytes().await.ok()?;
    Some(full(status, &kind, body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_output_the_screen_already_has() {
        let b = Bytes::from_static(b"hello");
        assert_eq!(unseen(0, &b, 0).as_deref(), Some(&b"hello"[..]));
        assert_eq!(unseen(10, &b, 12).as_deref(), Some(&b"llo"[..]));
        assert_eq!(unseen(10, &b, 15), None);
        assert_eq!(unseen(10, &b, 20), None);
    }

    #[test]
    fn notices_agents_that_need_you_or_finish() {
        let state = |s: &str| json!({ "tabs": [{ "title": "api", "panes": [{ "pty": 3, "agent": { "status": s, "harness": "Claude Code", "detail": null } }] }] });
        let mut seen = HashMap::new();
        // The first sighting is the baseline, not news.
        assert!(changes(&state("working"), &mut seen).is_empty());
        let waiting = changes(&state("waiting"), &mut seen);
        assert_eq!(waiting.len(), 1);
        assert_eq!(waiting[0]["title"], "api needs you");
        assert!(changes(&state("waiting"), &mut seen).is_empty());
        // Waiting → idle isn't "done": nothing was running.
        assert!(changes(&state("idle"), &mut seen).is_empty());
        changes(&state("thinking"), &mut seen);
        let done = changes(&state("idle"), &mut seen);
        assert_eq!(done[0]["title"], "api: done");
        // A closed pane is forgotten.
        changes(&json!({ "tabs": [] }), &mut seen);
        assert!(seen.is_empty());
    }

    #[test]
    fn types_messages_without_control_characters() {
        assert_eq!(typed("fix the tests"), "fix the tests");
        assert_eq!(typed("one\r\ntwo\nthree\n\n"), "one\x1b\rtwo\x1b\rthree");
        assert_eq!(typed("a\x1b[31mb\x03c\td"), "a[31mbc d");
        assert_eq!(typed("  \n "), "");
    }

    #[test]
    fn presses_only_named_keys() {
        assert_eq!(key_bytes("enter"), Some("\r"));
        assert_eq!(key_bytes("shift-tab"), Some("\x1b[Z"));
        assert_eq!(key_bytes("rm -rf"), None);
    }

    #[test]
    fn serves_only_the_phone_app() {
        assert!(servable("phone.html"));
        assert!(servable("assets/phone-abc.js"));
        assert!(servable("phone-sw.js"));
        assert!(servable("phone.webmanifest"));
        assert!(!servable("index.html"));
        assert!(!servable("assets/../../etc/passwd"));
    }
}
