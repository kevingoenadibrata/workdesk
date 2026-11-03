//! Browser panes: native child webviews (Tauri's `unstable` multiwebview)
//! laid over a placeholder element in the main window's DOM.
//!
//! The frontend owns the layout. It creates a webview per browser pane, then
//! keeps it on top of the pane's placeholder (`browser_place`), hiding it
//! whenever the placeholder is covered, off screen or mid-drag, since a native
//! view always draws over the DOM.
//!
//! Pages can't use Tauri's IPC (capabilities only grant it to the main and
//! onboarding webviews). They talk back through a script injected into every
//! page that navigates to `workdesk-bridge://<token>/<kind>?…`: the navigation
//! handler cancels those and turns them into "browser" events. The token is
//! random per webview and only lives in the script's closure, so pages can't
//! forge messages for other panes.

use serde::Serialize;
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, Url, WebviewUrl, Window};

const BRIDGE_SCHEME: &str = "workdesk-bridge";
/// WKWebView's default user agent leaves out "Safari", so some sites serve a
/// stripped-down page. Present as Safari instead.
const USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

/// Key combos that pages hand to Workdesk instead of handling themselves.
#[derive(Default)]
pub struct BrowserState {
    keys: Mutex<Vec<String>>,
}

/// What a browser pane tells the frontend.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum BrowserEvent {
    /// A page started (`loading`) or finished loading.
    Load { label: String, url: String, loading: bool },
    /// The page's URL changed without a load (history.pushState, a #hash).
    Url { label: String, url: String },
    Title { label: String, title: String },
    /// The page took keyboard focus.
    Focus { label: String },
    /// A Workdesk shortcut was pressed in the page.
    Key { label: String, combo: String },
}

fn emit(app: &AppHandle, event: BrowserEvent) {
    let _ = app.emit_to("main", "browser", event);
}

/// 128 random-enough bits as hex. Unforgeable by the page is all it needs.
fn token() -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    (0..2)
        .map(|i| {
            let mut h = RandomState::new().build_hasher();
            h.write_u128(nanos ^ i);
            format!("{:016x}", h.finish())
        })
        .collect()
}

/// Only web pages: no file://, javascript: and the like.
fn web_url(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|e| format!("{url}: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        other => Err(format!("Can't open {other}: URLs in a browser pane")),
    }
}

fn keys_script(keys: &[String]) -> String {
    format!("window.__workdeskKeys && window.__workdeskKeys({});", serde_json::to_string(keys).unwrap_or_else(|_| "[]".into()))
}

/// Runs at the start of every page (main frame only) in a browser pane.
fn bridge_script(token: &str, keys: &[String]) -> String {
    format!(
        r#"(() => {{
  if (window.top !== window || window.__workdeskKeys) return;
  const send = (kind, params) => {{
    const q = params ? "?" + new URLSearchParams(params) : "";
    try {{ window.location.href = "{BRIDGE_SCHEME}://{token}/" + kind + q; }} catch {{}}
  }};
  let keys = new Set({initial});
  Object.defineProperty(window, "__workdeskKeys", {{ value: (list) => {{ keys = new Set(list); }} }});
  const CODES = {{ BracketLeft: "[", BracketRight: "]", Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", Backquote: "`", Minus: "-", Equal: "=", Backslash: "\\" }};
  const keyOf = (c) => c.startsWith("Key") ? c.slice(3).toLowerCase() : c.startsWith("Digit") ? c.slice(5) : (CODES[c] ?? c.toLowerCase());
  window.addEventListener("keydown", (e) => {{
    if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) return;
    const mods = [e.ctrlKey && "ctrl", e.metaKey && "mod", e.altKey && "alt", e.shiftKey && "shift"].filter(Boolean);
    if (!mods.length) return;
    const combo = [...mods, keyOf(e.code)].join("+");
    if (keys.has(combo)) {{
      e.preventDefault();
      e.stopImmediatePropagation();
      send("key", {{ combo }});
    }} else if (combo === "mod+r") {{
      e.preventDefault();
      location.reload();
    }}
  }}, true);
  let focused = false;
  const focus = () => {{ if (!focused) {{ focused = true; send("focus"); }} }};
  window.addEventListener("focus", focus);
  window.addEventListener("mousedown", focus, true);
  window.addEventListener("blur", () => {{ focused = false; }});
  let lastUrl = location.href, timer = 0;
  const urlChanged = () => {{
    clearTimeout(timer);
    timer = setTimeout(() => {{
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      send("url", {{ url: lastUrl }});
    }}, 150);
  }};
  for (const name of ["pushState", "replaceState"]) {{
    const original = history[name];
    history[name] = function (...args) {{ const r = original.apply(this, args); urlChanged(); return r; }};
  }}
  window.addEventListener("popstate", urlChanged);
  window.addEventListener("hashchange", urlChanged);
}})();"#,
        initial = serde_json::to_string(keys).unwrap_or_else(|_| "[]".into()),
    )
}

/// A bridge message from the page, if `url` is one for this webview.
fn bridge_event(url: &Url, token: &str, label: &str) -> Option<Option<BrowserEvent>> {
    if url.scheme() != BRIDGE_SCHEME {
        return None;
    }
    if url.host_str() != Some(token) {
        // Someone else's (or a forged) message: drop it.
        return Some(None);
    }
    let param = |name: &str| url.query_pairs().find(|(k, _)| k == name).map(|(_, v)| v.into_owned());
    let label = label.to_string();
    Some(match url.path().trim_start_matches('/') {
        "focus" => Some(BrowserEvent::Focus { label }),
        "key" => param("combo").map(|combo| BrowserEvent::Key { label, combo }),
        "url" => param("url").map(|url| BrowserEvent::Url { label, url }),
        _ => None,
    })
}

fn webview(app: &AppHandle, label: &str) -> Result<tauri::Webview, String> {
    if !label.starts_with("browser-") {
        return Err(format!("{label} isn't a browser pane"));
    }
    app.get_webview(label).ok_or_else(|| format!("No browser pane {label}"))
}

/// Opens `url` in a new webview labeled `label`, placed at the given logical
/// rect of the calling window and shown or hidden.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn browser_open(
    app: AppHandle,
    window: Window,
    state: State<'_, BrowserState>,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
) -> Result<(), String> {
    if !label.starts_with("browser-") {
        return Err(format!("{label} isn't a browser pane label"));
    }
    let url = web_url(&url)?;
    let token = token();
    let keys = state.keys.lock().map(|k| k.clone()).unwrap_or_default();

    let nav_app = app.clone();
    let nav_label = label.clone();
    let nav_token = token.clone();
    let load_app = app.clone();
    let title_app = app.clone();
    let popup_app = app.clone();
    let popup_label = label.clone();
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .user_agent(USER_AGENT)
        // The frontend decides when a page gets the keyboard (not while Home covers it, say).
        .focused(false)
        .initialization_script(bridge_script(&token, &keys))
        .on_navigation(move |url| match bridge_event(url, &nav_token, &nav_label) {
            Some(event) => {
                if let Some(event) = event {
                    emit(&nav_app, event);
                }
                false
            }
            None => true,
        })
        .on_page_load(move |webview, payload| {
            let loading = matches!(payload.event(), PageLoadEvent::Started);
            if !loading {
                let keys = load_app.state::<BrowserState>().keys.lock().map(|k| k.clone()).unwrap_or_default();
                let _ = webview.eval(keys_script(&keys));
            }
            emit(&load_app, BrowserEvent::Load { label: webview.label().to_string(), url: payload.url().to_string(), loading });
        })
        .on_document_title_changed(move |webview, title| {
            emit(&title_app, BrowserEvent::Title { label: webview.label().to_string(), title });
        })
        // Links that open a new window (target=_blank, window.open) open in the pane itself.
        .on_new_window(move |url, _features| {
            if let (Ok(webview), Ok(url)) = (webview(&popup_app, &popup_label), web_url(url.as_str())) {
                let _ = webview.navigate(url);
            }
            NewWindowResponse::Deny
        });

    let webview = window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(width.max(1.0), height.max(1.0)))
        .map_err(|e| e.to_string())?;
    crate::keystop::contain_keys(&webview);
    if !visible {
        webview.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Moves a pane's webview to the given logical rect and shows it, or hides it.
#[tauri::command]
pub fn browser_place(app: AppHandle, label: String, x: f64, y: f64, width: f64, height: f64, visible: bool) -> Result<(), String> {
    let webview = webview(&app, &label)?;
    if !visible {
        return webview.hide().map_err(|e| e.to_string());
    }
    webview.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    webview.set_size(LogicalSize::new(width.max(1.0), height.max(1.0))).map_err(|e| e.to_string())?;
    webview.show().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_navigate(app: AppHandle, label: String, url: String) -> Result<(), String> {
    webview(&app, &label)?.navigate(web_url(&url)?).map_err(|e| e.to_string())
}

/// Goes back (-1) or forward (1) in the pane's history.
#[tauri::command]
pub fn browser_go(app: AppHandle, label: String, delta: i32) -> Result<(), String> {
    webview(&app, &label)?.eval(format!("history.go({delta})")).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_reload(app: AppHandle, label: String) -> Result<(), String> {
    webview(&app, &label)?.reload().map_err(|e| e.to_string())
}

/// Gives the pane's page keyboard focus.
#[tauri::command]
pub fn browser_focus(app: AppHandle, label: String) -> Result<(), String> {
    webview(&app, &label)?.set_focus().map_err(|e| e.to_string())
}

/// Hands keyboard focus back to Workdesk's own webview, away from any page.
#[tauri::command]
pub fn browser_focus_main(app: AppHandle) -> Result<(), String> {
    app.get_webview("main").ok_or("No main webview")?.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_close(app: AppHandle, label: String) -> Result<(), String> {
    webview(&app, &label)?.close().map_err(|e| e.to_string())
}

/// Sets which key combos pages hand to Workdesk, in every open pane and every page loaded from now on.
#[tauri::command]
pub fn browser_set_keys(app: AppHandle, state: State<'_, BrowserState>, keys: Vec<String>) -> Result<(), String> {
    let script = keys_script(&keys);
    *state.keys.lock().map_err(|e| e.to_string())? = keys;
    for (label, webview) in app.webviews() {
        if label.starts_with("browser-") {
            let _ = webview.eval(&script);
        }
    }
    Ok(())
}
