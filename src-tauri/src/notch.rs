//! A Dynamic-Island-style strip around the MacBook notch, drawn by `notch.html`.
//!
//! macOS has no API for the notch, so this is a borderless, transparent window
//! pinned to the top of the notched display, above the menu bar. The page draws
//! a black shape that matches the notch and grows out of it. Pixels under the
//! camera don't exist, so the black blends into the real cut-out.
//!
//! The window is larger than the shape and would block the menu bar, so it
//! ignores the mouse until the pointer is over the shape. A timer reads the
//! pointer, compares it with the shape's current size (the page reports it with
//! `notch_hit`), then turns clicks on or off and tells the page whether it is
//! hovered. Hover comes from here rather than CSS because a webview in a window
//! that is never key doesn't get dependable hover events.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

const LABEL: &str = "notch";
/// The window's size in points. The page's shape grows to at most this.
const WIDTH: f64 = 560.0;
const HEIGHT: f64 = 320.0;
/// How often to check where the pointer is.
const POLL_MS: u64 = 50;
/// Bumped each time the window opens, so a pointer timer from an earlier
/// opening stops instead of running alongside the new one.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Where the window sits and how big the page's shape is right now, all in
/// AppKit points (origin at the bottom left of the main display).
#[derive(Default)]
pub struct NotchState(Mutex<Geometry>);

#[derive(Default, Clone, Copy)]
struct Geometry {
    /// The middle of the notch, at the top edge of its display.
    center_x: f64,
    top: f64,
    /// The shape the page is drawing, hanging from `top`.
    shape_w: f64,
    shape_h: f64,
    hovering: bool,
}

/// The page reports the size of its shape whenever it changes: the notch alone,
/// the notch with status on each side, or the open panel.
#[tauri::command]
pub fn notch_hit(state: tauri::State<NotchState>, width: f64, height: f64) {
    let mut g = state.0.lock().unwrap();
    g.shape_w = width;
    g.shape_h = height;
}

/// An agent in the notch was clicked: bring Workdesk forward and have the main
/// window show that pane.
#[tauri::command]
pub fn notch_jump(app: AppHandle, id: u32) -> Result<(), String> {
    bring_main_forward(&app)?;
    app.emit_to("main", "notch-jump", id).map_err(|e| e.to_string())
}

/// A button in the notch was clicked ("ticket", "teleport"): bring Workdesk
/// forward and have the main window open that modal, so typing happens there.
#[tauri::command]
pub fn notch_action(app: AppHandle, action: String) -> Result<(), String> {
    bring_main_forward(&app)?;
    app.emit_to("main", "notch-action", action).map_err(|e| e.to_string())
}

fn bring_main_forward(app: &AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        main.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Opens the notch window if a display has a notch. Without one, or when it's
/// already open, it does nothing. Must run on the main thread.
#[cfg(target_os = "macos")]
pub fn open(app: &AppHandle) -> Result<(), String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSMainMenuWindowLevel, NSScreen, NSWindow, NSWindowCollectionBehavior};
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }
    let mtm = MainThreadMarker::new().ok_or("notch: not on the main thread")?;
    // A notched display has a top safe-area inset (macOS 12+).
    let Some(screen) = NSScreen::screens(mtm).iter().find(|s| s.safeAreaInsets().top > 0.0) else {
        return Ok(());
    };
    let frame = screen.frame();
    // The menu bar is split into areas left and right of the notch; the notch is the gap.
    let left = screen.auxiliaryTopLeftArea();
    let right = screen.auxiliaryTopRightArea();
    let notch_w = frame.size.width - left.size.width - right.size.width;
    let notch_h = screen.safeAreaInsets().top;
    let center_x = left.origin.x + left.size.width + notch_w / 2.0;
    let top = frame.origin.y + frame.size.height;

    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("notch.html".into()))
        .initialization_script(&format!(
            "window.__NOTCH = {{ width: {notch_w}, height: {notch_h} }};"
        ))
        .title("")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .always_on_top(true)
        .focused(false)
        .focusable(false)
        .accept_first_mouse(true)
        .inner_size(WIDTH, HEIGHT)
        .build()
        .map_err(|e| e.to_string())?;

    let ns_window = window.ns_window().map_err(|e| e.to_string())?;
    // SAFETY: Tauri hands back its live NSWindow, and we're on the main thread.
    let ns_window: &NSWindow = unsafe { &*(ns_window as *const NSWindow) };
    // Above the menu bar, in every Space, beside full-screen apps, and left out of ⌘`.
    ns_window.setLevel(NSMainMenuWindowLevel + 3);
    ns_window.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    ns_window.setHasShadow(false);
    // Set the frame directly so AppKit doesn't move the window below the menu bar.
    ns_window.setFrame_display(
        NSRect::new(NSPoint::new(center_x - WIDTH / 2.0, top - HEIGHT), NSSize::new(WIDTH, HEIGHT)),
        true,
    );
    let _ = window.set_ignore_cursor_events(true);

    {
        let state = app.state::<NotchState>();
        let mut g = state.0.lock().unwrap();
        *g = Geometry { center_x, top, shape_w: notch_w, shape_h: notch_h, hovering: false };
    }

    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(POLL_MS));
        if GENERATION.load(Ordering::SeqCst) != generation {
            break;
        }
        let handle = app.clone();
        if app.run_on_main_thread(move || track_pointer(&handle)).is_err() {
            break;
        }
    });
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn open(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

/// Closes the notch window, if it's open, and stops its pointer timer.
pub fn close(app: &AppHandle) -> Result<(), String> {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    match app.get_webview_window(LABEL) {
        Some(window) => window.destroy().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// Makes the window clickable while the pointer is over the shape (and click-through
/// otherwise), and tells the page when that changes.
#[cfg(target_os = "macos")]
fn track_pointer(app: &AppHandle) {
    use objc2_app_kit::NSEvent;

    let Some(window) = app.get_webview_window(LABEL) else { return };
    let p = NSEvent::mouseLocation();
    let state = app.state::<NotchState>();
    let mut g = state.0.lock().unwrap();
    let inside = (p.x - g.center_x).abs() <= g.shape_w / 2.0 && p.y <= g.top && p.y >= g.top - g.shape_h;
    if inside == g.hovering {
        return;
    }
    g.hovering = inside;
    drop(g);
    let _ = window.set_ignore_cursor_events(!inside);
    let _ = window.emit_to(LABEL, "notch-hover", inside);
}
