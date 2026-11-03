//! The dock extender: glass cards in the empty strip beside the macOS Dock, each
//! its own window drawing `dock.html` (the card is picked by the URL's hash):
//! - left of the Dock, filling it: usage limits;
//! - right of the Dock: a Create ticket button, then a drop zone filling the
//!   rest, which opens the composer with the dropped files in the description.
//!
//! macOS keeps app windows out of the Dock's strip (the gap between a screen's
//! frame and its visible frame), so the corners beside the Dock are free. The
//! cards take their height from the strip. They sit one level below the Dock so
//! magnified icons pass over them, and stay out of full-screen Spaces like the
//! Dock does.
//!
//! Where the Dock starts: with the Accessibility permission, its exact frame
//! (`ax::dock_span`); without, an estimate from its settings and the running
//! apps (`dock_width`).
//!
//! When it's re-read: the moment an app launches or quits (the Dock gains or
//! loses a tile then), a few more times while the Dock animates, and on a timer
//! for everything else (minimized windows, a Dock moved to another display,
//! auto-hide, the Dock moved to the left or right edge). Width changes animate.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::AppHandle;

/// The cards: window label and the page's hash.
const USAGE: (&str, &str) = ("dock-usage", "usage");
const TICKET: (&str, &str) = ("dock-ticket", "ticket");
const DROP: (&str, &str) = ("dock-drop", "drop");
const CARDS: [(&str, &str); 3] = [USAGE, TICKET, DROP];
/// Narrower than this, a filling card has no room beside the Dock: hide it.
const MIN_WIDTH: f64 = 160.0;
/// The Create ticket button's width.
const TICKET_WIDTH: f64 = 150.0;
/// Space between two cards on the same side.
const CARD_GAP: f64 = 8.0;
/// Space kept between the panel and the Dock when its frame is known exactly.
const DOCK_GAP: f64 = 8.0;
/// Extra room when the Dock's width is only estimated, so it rarely overlaps.
const ESTIMATE_SLOP: f64 = 4.0;
/// How long the Dock's settings are trusted before reading them again.
const PREFS_TTL: Duration = Duration::from_secs(5);
/// Space between the panel and the screen's bottom and left edges, roughly the
/// Dock's own gap from the bottom.
const GAP: f64 = 5.0;
/// How much shorter than the Dock the panel is, split evenly above and below
/// so it stays centred on the Dock (the extra 1pt below centres it exactly).
const SHORTER: f64 = 10.0;
/// Below this, the strip isn't a Dock (auto-hide leaves a few points).
const MIN_STRIP: f64 = 30.0;
/// The panel's corner radius, matched to the Dock's (src/dock.css uses the same).
const RADIUS: f64 = 18.0;
/// How often to re-read where the Dock is, for changes no notification covers.
const POLL_MS: u64 = 500;
/// After an app launches or quits, re-read at these delays (ms) to follow the
/// Dock as it adds or removes the tile and animates.
const FOLLOW_UP_MS: [u64; 4] = [0, 150, 400, 900];

/// Opens the cards beside the Dock. Must run on the main thread (from `setup`).
#[cfg(target_os = "macos")]
pub fn open(app: &AppHandle) -> Result<(), String> {
    use tauri::Manager;

    for (label, hash) in CARDS {
        card(app, label, hash)?;
    }
    place(app);
    watch_apps(app);
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(POLL_MS));
        let handle = app.clone();
        if app.get_webview_window(USAGE.0).is_none() || app.run_on_main_thread(move || place(&handle)).is_err() {
            break;
        }
    });
    Ok(())
}

/// One card: a borderless glass window, hidden until `place` finds it a spot.
#[cfg(target_os = "macos")]
fn card(app: &AppHandle, label: &str, hash: &str) -> Result<(), String> {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
    use tauri::window::{Effect, EffectState, EffectsBuilder};
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(format!("dock.html#{hash}").into()))
        .title("")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .focusable(false)
        .accept_first_mouse(true)
        .inner_size(MIN_WIDTH, 60.0);
    // Only the drop zone takes dropped files (with their paths, through Tauri).
    if label != DROP.0 {
        builder = builder.disable_drag_drop_handler();
    }
    let window = builder.build().map_err(|e| e.to_string())?;

    let ns_window = window.ns_window().map_err(|e| e.to_string())?;
    // SAFETY: Tauri hands back its live NSWindow, and we're on the main thread.
    let ns_window: &NSWindow = unsafe { &*(ns_window as *const NSWindow) };
    // kCGDockWindowLevel is 20: stay just under it so the Dock draws over us.
    ns_window.setLevel(19);
    // In every Space, but not beside full-screen apps (the Dock hides there too).
    ns_window.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    ns_window.setHasShadow(false);
    // SAFETY: a live NSWindow, on the main thread.
    if !unsafe { add_glass(ns_window) } {
        // Before macOS 26 there's no Liquid Glass: the frosted HUD blur is the nearest.
        let effects = EffectsBuilder::new()
            .effect(Effect::HudWindow)
            .state(EffectState::Active)
            .radius(RADIUS)
            .build();
        let _ = window.set_effects(effects);
    }
    Ok(())
}

/// Re-places the panel whenever an app launches or quits, then a few more times
/// while the Dock settles. Must run on the main thread.
#[cfg(target_os = "macos")]
fn watch_apps(app: &AppHandle) {
    use block2::RcBlock;
    use objc2_app_kit::{NSWorkspace, NSWorkspaceDidLaunchApplicationNotification, NSWorkspaceDidTerminateApplicationNotification};
    use objc2_foundation::{NSNotification, NSOperationQueue};
    use std::ptr::NonNull;

    let center = NSWorkspace::sharedWorkspace().notificationCenter();
    let queue = NSOperationQueue::mainQueue();
    // SAFETY: the statics are AppKit's notification names.
    for name in unsafe { [NSWorkspaceDidLaunchApplicationNotification, NSWorkspaceDidTerminateApplicationNotification] } {
        let app = app.clone();
        let block = RcBlock::new(move |_: NonNull<NSNotification>| {
            for ms in FOLLOW_UP_MS {
                let app = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(ms));
                    let handle = app.clone();
                    let _ = app.run_on_main_thread(move || place(&handle));
                });
            }
        });
        // SAFETY: the block only clones a Send handle and spawns threads; it runs on the main queue.
        let observer = unsafe { center.addObserverForName_object_queue_usingBlock(Some(name), None, Some(&queue), &block) };
        // Observe for the life of the app.
        std::mem::forget(observer);
    }
}

/// Puts a Liquid Glass view (macOS 26's `NSGlassEffectView`, what the Dock is
/// made of) behind the webview, filling the window. Returns false when the class
/// doesn't exist (older macOS). Looked up by name so it builds on any SDK.
///
/// # Safety
/// `window` must be a live NSWindow, and this must run on the main thread.
#[cfg(target_os = "macos")]
unsafe fn add_glass(window: &objc2_app_kit::NSWindow) -> bool {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_foundation::NSRect;

    let Some(class) = AnyClass::get(c"NSGlassEffectView") else { return false };
    // Wry's content view holds the webview as a subview.
    let content: *mut AnyObject = msg_send![window, contentView];
    if content.is_null() {
        return false;
    }
    let bounds: NSRect = msg_send![content, bounds];
    let glass: *mut AnyObject = msg_send![class, alloc];
    let glass: *mut AnyObject = msg_send![glass, initWithFrame: bounds];
    if glass.is_null() {
        return false;
    }
    // NSViewWidthSizable | NSViewHeightSizable: follow the window as it resizes.
    let _: () = msg_send![glass, setAutoresizingMask: 2usize | 16usize];
    // The glass only lays out (and draws its rim) around a content view. The
    // webview stays a sibling above it, where Wry manages it; this one is empty.
    let Some(view_class) = AnyClass::get(c"NSView") else { return false };
    let inner: *mut AnyObject = msg_send![view_class, alloc];
    let inner: *mut AnyObject = msg_send![inner, initWithFrame: bounds];
    let _: () = msg_send![glass, setContentView: inner];
    let _: () = msg_send![glass, setCornerRadius: RADIUS];
    // NSWindowBelow, relative to nothing: below every other subview, so behind the webview.
    let _: () = msg_send![content, addSubview: glass, positioned: -1isize, relativeTo: std::ptr::null_mut::<AnyObject>()];
    true
}

#[cfg(not(target_os = "macos"))]
pub fn open(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

/// Where each card goes, in AppKit points, on the screen with a Dock along its
/// bottom; None for a card with no room (or when no screen has such a Dock).
#[cfg(target_os = "macos")]
struct Slots {
    usage: Option<objc2_foundation::NSRect>,
    ticket: Option<objc2_foundation::NSRect>,
    drop: Option<objc2_foundation::NSRect>,
}

#[cfg(target_os = "macos")]
fn slots() -> Slots {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSScreen;
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    let none = Slots { usage: None, ticket: None, drop: None };
    let Some(mtm) = MainThreadMarker::new() else { return none };
    NSScreen::screens(mtm)
        .iter()
        .find_map(|s| {
            let frame = s.frame();
            let visible = s.visibleFrame();
            let strip = visible.origin.y - frame.origin.y;
            // A Dock on the left or right edge narrows the visible frame instead.
            let side = visible.origin.x > frame.origin.x || visible.size.width < frame.size.width;
            if strip < MIN_STRIP || side {
                return None;
            }
            let (screen_l, screen_r) = (frame.origin.x, frame.origin.x + frame.size.width);
            // The space each side keeps clear of the Dock.
            let (dock_l, dock_r) = match ax::dock_span().filter(|&(l, r)| l >= screen_l && r <= screen_r) {
                Some((l, r)) => (l - DOCK_GAP, r + DOCK_GAP),
                None => {
                    // The Dock is centred on its screen.
                    let half = dock_width(frame.size.width) / 2.0 + DOCK_GAP + ESTIMATE_SLOP;
                    let mid = screen_l + frame.size.width / 2.0;
                    (mid - half, mid + half)
                }
            };
            let y = frame.origin.y + GAP + 1.0 + SHORTER / 2.0;
            let h = strip - GAP - 3.0 - SHORTER;
            let rect = |x: f64, w: f64| NSRect::new(NSPoint::new(x, y), NSSize::new(w, h));

            let usage_w = dock_l - screen_l - GAP;
            let usage = (usage_w >= MIN_WIDTH).then(|| rect(screen_l + GAP, usage_w));
            let right_w = screen_r - GAP - dock_r;
            let ticket = (right_w >= TICKET_WIDTH).then(|| rect(dock_r, TICKET_WIDTH));
            let drop_w = right_w - TICKET_WIDTH - CARD_GAP;
            let drop = (drop_w >= MIN_WIDTH).then(|| rect(dock_r + TICKET_WIDTH + CARD_GAP, drop_w));
            Some(Slots { usage, ticket, drop })
        })
        .unwrap_or(none)
}

/// What the Dock shows, from `defaults read com.apple.dock`.
#[derive(Clone, Default)]
struct DockPrefs {
    tile: f64,
    /// Bundle ids of the pinned apps (Finder isn't listed; it's always first).
    pinned: Vec<String>,
    /// Folders and stacks after the apps.
    others: usize,
    /// Bundle ids of recent apps, shown in their own section when not running.
    recents: Vec<String>,
    show_recents: bool,
}

static PREFS: Mutex<Option<(Instant, DockPrefs)>> = Mutex::new(None);

fn dock_prefs() -> DockPrefs {
    let mut cache = PREFS.lock().unwrap();
    if let Some((at, prefs)) = cache.as_ref() {
        if at.elapsed() < PREFS_TTL {
            return prefs.clone();
        }
    }
    let prefs = read_dock_prefs();
    *cache = Some((Instant::now(), prefs.clone()));
    prefs
}

/// Parses the old-style plist `defaults read` prints. Top-level keys sit at four
/// spaces of indent; tiles nest deeper.
fn read_dock_prefs() -> DockPrefs {
    let out = std::process::Command::new("/usr/bin/defaults")
        .args(["read", "com.apple.dock"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    let mut prefs = DockPrefs { tile: 48.0, show_recents: true, ..Default::default() };
    let mut section = String::new();
    for line in out.lines() {
        if line.len() > 4 && line.starts_with("    ") && !line[4..].starts_with(' ') {
            let (key, value) = line[4..].split_once(" = ").unwrap_or((&line[4..], ""));
            section = key.trim_matches('"').to_string();
            let value = value.trim_end_matches(';');
            match section.as_str() {
                "tilesize" => prefs.tile = value.parse().unwrap_or(prefs.tile),
                "show-recents" => prefs.show_recents = value != "0",
                _ => {}
            }
            continue;
        }
        let quoted = |l: &str| l.split_once(" = ").map(|(_, v)| v.trim_end_matches(';').trim_matches('"').to_string());
        match section.as_str() {
            "persistent-apps" if line.contains("\"bundle-identifier\" =") => prefs.pinned.extend(quoted(line)),
            "recent-apps" if line.contains("\"bundle-identifier\" =") => prefs.recents.extend(quoted(line)),
            "persistent-others" if line.contains("\"tile-type\" =") => prefs.others += 1,
            _ => {}
        }
    }
    prefs
}

/// The Dock's estimated width in points: Finder, pinned apps, running apps that
/// aren't pinned, recent apps that aren't running, folders, and the trash, with
/// a separator between each section. Minimized windows (which also get tiles)
/// aren't counted. The Dock shrinks its icons to fit the screen, so this does too.
#[cfg(target_os = "macos")]
fn dock_width(screen_w: f64) -> f64 {
    use objc2_app_kit::{NSApplicationActivationPolicy, NSWorkspace};

    let prefs = dock_prefs();
    let running: Vec<String> = NSWorkspace::sharedWorkspace()
        .runningApplications()
        .iter()
        // A quitting app is gone from the Dock before it's gone from this list.
        .filter(|a| a.activationPolicy() == NSApplicationActivationPolicy::Regular && !a.isTerminated())
        // An app without a bundle id (like `tauri dev`) still gets a tile.
        .map(|a| a.bundleIdentifier().map(|b| b.to_string()).unwrap_or_default())
        .filter(|b| b != "com.apple.finder")
        .collect();
    let extra = running.iter().filter(|b| !prefs.pinned.contains(b)).count();
    let recents = if prefs.show_recents {
        prefs.recents.iter().filter(|b| !prefs.pinned.contains(b) && !running.contains(b)).count()
    } else {
        0
    };
    let tiles = 1 + prefs.pinned.len() + extra + recents + prefs.others + 1;
    let separators = 1 + usize::from(extra + recents > 0);
    // Measured against a 53pt Dock: each separator and each end take about half a tile.
    let width = (tiles as f64 + 0.5 * separators as f64 + 1.0) * prefs.tile;
    width.min(screen_w)
}

/// Moves each card to its spot beside the Dock, or hides it when it has none.
#[cfg(target_os = "macos")]
fn place(app: &AppHandle) {
    let s = slots();
    for (label, rect) in [(USAGE.0, s.usage), (TICKET.0, s.ticket), (DROP.0, s.drop)] {
        place_card(app, label, rect);
    }
}

#[cfg(target_os = "macos")]
fn place_card(app: &AppHandle, label: &str, rect: Option<objc2_foundation::NSRect>) {
    use objc2_app_kit::NSWindow;
    use tauri::Manager;

    let Some(window) = app.get_webview_window(label) else { return };
    let Ok(ns_window) = window.ns_window() else { return };
    // SAFETY: Tauri hands back its live NSWindow, and we're on the main thread.
    let ns_window: &NSWindow = unsafe { &*(ns_window as *const NSWindow) };
    match rect {
        Some(rect) => {
            let f = ns_window.frame();
            let moved = (f.origin.x - rect.origin.x).abs() > 0.5
                || (f.origin.y - rect.origin.y).abs() > 0.5
                || (f.size.width - rect.size.width).abs() > 0.5
                || (f.size.height - rect.size.height).abs() > 0.5;
            if moved {
                // Slide along with the Dock when only its edge moved; jump when first
                // shown or moved to another display.
                let animate = ns_window.isVisible()
                    && (f.origin.y - rect.origin.y).abs() < 0.5
                    && (f.size.height - rect.size.height).abs() < 0.5;
                if animate {
                    // Through the window's animator proxy, which animates without blocking.
                    // (`setFrame:display:animate:` runs a nested loop that never returns
                    // inside Tauri's event loop, freezing the app.)
                    // SAFETY: a live NSWindow on the main thread; `animator` returns a proxy for it.
                    unsafe {
                        use objc2::msg_send;
                        use objc2::runtime::AnyObject;
                        let proxy: *mut AnyObject = msg_send![ns_window, animator];
                        let _: () = msg_send![proxy, setFrame: rect, display: true];
                    }
                } else {
                    ns_window.setFrame_display(rect, true);
                }
            }
            if !ns_window.isVisible() {
                ns_window.orderFrontRegardless();
            }
        }
        None => {
            if ns_window.isVisible() {
                ns_window.orderOut(None);
            }
        }
    }
}

/// Files dropped on the drop zone: images are copied in with the ticket's
/// other images (so Claude reads them like pasted ones), other files are linked
/// where they are. Brings Workdesk forward and has the main window open the
/// composer with them in the description.
#[tauri::command]
pub fn dock_drop(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    use tauri::{Emitter, Manager};

    let mut lines = Vec::new();
    for path in &paths {
        let p = std::path::Path::new(path);
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or(path).to_string();
        if crate::files::is_image(p) {
            let saved = crate::files::copy_ticket_image(p)?;
            lines.push(format!("![{}]({saved})", saved.rsplit('/').next().unwrap_or(&name)));
        } else {
            // Angle brackets keep a path with spaces in one Markdown link.
            lines.push(format!("[{name}](<{path}>)"));
        }
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
    app.emit_to("main", "dock-new-ticket", lines.join("\n")).map_err(|e| e.to_string())
}

/// The Dock's exact frame through the Accessibility API, which the Dock answers
/// for any app the user has allowed to control the computer (Privacy & Security
/// → Accessibility). Without that permission every call here returns None and
/// the panel uses the estimate.
#[cfg(target_os = "macos")]
mod ax {
    use std::ffi::{c_char, c_void};

    type CFTypeRef = *const c_void;
    const UTF8: u32 = 0x0800_0100;
    const POINT: u32 = 1;
    const SIZE: u32 = 2;
    /// Seconds to wait for the Dock. This runs on the main thread, so never the
    /// default (six seconds) if the Dock is busy.
    const TIMEOUT: f32 = 0.2;

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrusted() -> u8;
        fn AXUIElementCreateApplication(pid: i32) -> CFTypeRef;
        fn AXUIElementSetMessagingTimeout(element: CFTypeRef, seconds: f32) -> i32;
        fn AXUIElementCopyAttributeValue(element: CFTypeRef, attribute: CFTypeRef, value: *mut CFTypeRef) -> i32;
        fn AXValueGetValue(value: CFTypeRef, kind: u32, out: *mut c_void) -> u8;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(cf: CFTypeRef);
        fn CFEqual(a: CFTypeRef, b: CFTypeRef) -> u8;
        fn CFArrayGetCount(array: CFTypeRef) -> isize;
        fn CFArrayGetValueAtIndex(array: CFTypeRef, index: isize) -> CFTypeRef;
        fn CFStringCreateWithCString(alloc: CFTypeRef, s: *const c_char, encoding: u32) -> CFTypeRef;
    }

    /// A Core Foundation object released when dropped.
    struct Owned(CFTypeRef);
    impl Drop for Owned {
        fn drop(&mut self) {
            // SAFETY: we own one reference to a live, non-null CF object.
            unsafe { CFRelease(self.0) }
        }
    }

    fn string(s: &std::ffi::CStr) -> Option<Owned> {
        // SAFETY: a valid C string; the result is owned (Create rule).
        let r = unsafe { CFStringCreateWithCString(std::ptr::null(), s.as_ptr(), UTF8) };
        (!r.is_null()).then_some(Owned(r))
    }

    fn attribute(element: CFTypeRef, name: &std::ffi::CStr) -> Option<Owned> {
        let name = string(name)?;
        let mut value: CFTypeRef = std::ptr::null();
        // SAFETY: a live AXUIElement and attribute name; the value is owned (Copy rule).
        let err = unsafe { AXUIElementCopyAttributeValue(element, name.0, &mut value) };
        (err == 0 && !value.is_null()).then_some(Owned(value))
    }

    fn pair(element: CFTypeRef, name: &std::ffi::CStr, kind: u32) -> Option<(f64, f64)> {
        let value = attribute(element, name)?;
        let mut out = [0f64; 2];
        // SAFETY: CGPoint and CGSize are both two f64s.
        (unsafe { AXValueGetValue(value.0, kind, out.as_mut_ptr().cast()) } != 0).then_some((out[0], out[1]))
    }

    /// The Dock's left and right edges in points (the same x in AppKit and
    /// Accessibility coordinates), or None without the permission.
    pub fn dock_span() -> Option<(f64, f64)> {
        use objc2_app_kit::NSRunningApplication;
        use objc2_foundation::NSString;

        // SAFETY: plain query.
        if unsafe { AXIsProcessTrusted() } == 0 {
            return None;
        }
        let dock = NSRunningApplication::runningApplicationsWithBundleIdentifier(&NSString::from_str("com.apple.dock"));
        let pid = dock.firstObject()?.processIdentifier();
        // SAFETY: the Dock's pid; the element is owned (Create rule).
        let app = Owned(unsafe { AXUIElementCreateApplication(pid) });
        if app.0.is_null() {
            return None;
        }
        // SAFETY: a live element.
        unsafe { AXUIElementSetMessagingTimeout(app.0, TIMEOUT) };
        let children = attribute(app.0, c"AXChildren")?;
        let list = string(c"AXList")?;
        // SAFETY: AXChildren is a CFArray of AXUIElements, borrowed from `children`.
        let count = unsafe { CFArrayGetCount(children.0) };
        (0..count).find_map(|i| {
            let child = unsafe { CFArrayGetValueAtIndex(children.0, i) };
            let role = attribute(child, c"AXRole")?;
            // SAFETY: two live CF objects.
            if unsafe { CFEqual(role.0, list.0) } == 0 {
                return None;
            }
            let (x, _) = pair(child, c"AXPosition", POINT)?;
            let (w, _) = pair(child, c"AXSize", SIZE)?;
            (w > 0.0).then_some((x, x + w))
        })
    }
}
