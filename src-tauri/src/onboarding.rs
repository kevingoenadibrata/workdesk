use tauri::window::{Effect, EffectState, EffectsBuilder};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "onboarding";

/// Opens the tour; async so the window is built off the main thread's command loop.
#[tauri::command]
pub async fn open_onboarding(app: AppHandle) -> Result<(), String> {
    open(&app)
}

/// Opens the tour as a borderless layer over the whole display Workdesk is on:
/// the desktop shows through, frosted, with the tour (`onboarding.html`) on
/// top. The menu bar and Dock still draw above it, so the page is told how far
/// each edge of the work area is in (`window.__SAFE_AREA`) to keep its controls
/// clear of them. Brings it forward instead if it's already open.
pub fn open(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        return window.set_focus().map_err(|e| e.to_string());
    }
    let main = app.get_webview_window("main");
    let monitor = main
        .as_ref()
        .and_then(|w| w.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or("no display found")?;
    let scale = monitor.scale_factor();
    let pos = monitor.position().to_logical::<f64>(scale);
    let size = monitor.size().to_logical::<f64>(scale);
    let area = monitor.work_area();
    let (inner_pos, inner_size) = (area.position.to_logical::<f64>(scale), area.size.to_logical::<f64>(scale));
    let safe = format!(
        "window.__SAFE_AREA = {{ top: {}, right: {}, bottom: {}, left: {} }};",
        inner_pos.y - pos.y,
        (pos.x + size.width) - (inner_pos.x + inner_size.width),
        (pos.y + size.height) - (inner_pos.y + inner_size.height),
        inner_pos.x - pos.x,
    );
    let effects = EffectsBuilder::new()
        .effect(Effect::HudWindow)
        .state(EffectState::Active)
        .build();
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("onboarding.html".into()))
        .initialization_script(&safe)
        .title("Welcome to Workdesk")
        .decorations(false)
        .transparent(true)
        .effects(effects)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(true)
        .position(pos.x, pos.y)
        .inner_size(size.width, size.height)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}
