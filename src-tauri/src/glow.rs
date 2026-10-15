use std::time::Duration;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// How long a glow window lives; `glow.html` finishes its fade a little before.
const LIFETIME: Duration = Duration::from_millis(4200);

/// Lights up the edges of every display for a few seconds: one borderless,
/// transparent, click-through window per monitor, drawn by `glow.html` in
/// `colors` (CSS colors, blended around the edge).
#[tauri::command]
pub async fn edge_glow(app: AppHandle, colors: Vec<String>) -> Result<(), String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let script = format!(
        "window.__GLOW_COLORS = {};",
        serde_json::to_string(&colors).map_err(|e| e.to_string())?
    );
    let mut labels = Vec::new();
    for (i, monitor) in monitors.iter().enumerate() {
        let label = format!("glow-{i}");
        // A glow still fading from last time gives way to the new one.
        if let Some(old) = app.get_webview_window(&label) {
            let _ = old.destroy();
        }
        let scale = monitor.scale_factor();
        let pos = monitor.position().to_logical::<f64>(scale);
        let size = monitor.size().to_logical::<f64>(scale);
        let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("glow.html".into()))
            .initialization_script(&script)
            .title("")
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .skip_taskbar(true)
            .focused(false)
            .focusable(false)
            .position(pos.x, pos.y)
            .inner_size(size.width, size.height)
            .build()
            .map_err(|e| e.to_string())?;
        let _ = window.set_ignore_cursor_events(true);
        labels.push(label);
    }
    std::thread::spawn(move || {
        std::thread::sleep(LIFETIME);
        for label in labels {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.destroy();
            }
        }
    });
    Ok(())
}
