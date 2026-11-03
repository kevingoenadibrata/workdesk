//! Shottr (shottr.cc), the screenshot app: a screenshot taken with it can start
//! a ticket.
//!
//! Shottr copies a screenshot to the clipboard (on ⌘C, or on Esc when its
//! "copy on Esc" setting is on), so Workdesk watches the clipboard's change
//! count. When it changes to an image while Shottr is, or just was, the app in
//! front, that's a Shottr screenshot: "shottr-shot" goes out, and the drop zone
//! beside the Dock (showing it, from `shottr_preview`) and the main window offer
//! to make a ticket of it. Only the change count and the list of types are read
//! while watching; the image itself is read once it's known to be Shottr's, and
//! held until it's taken or the next one comes. "shottr-taken" withdraws every offer.
//!
//! Workdesk can also ask Shottr for a screenshot (`shottr_grab`, through its
//! `shottr://` URL scheme). The next image Shottr copies within a few minutes
//! then goes straight into the New ticket composer, no offer needed.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tauri::AppHandle;

/// Shottr's bundle identifier.
#[cfg(target_os = "macos")]
const BUNDLE_ID: &str = "cc.ffitch.shottr";
/// How often the clipboard's change count is read.
const POLL_MS: u64 = 400;
/// An image copied this long after Shottr was last in front still counts as
/// Shottr's: pressing Esc copies and closes its editor in one go, so the app in
/// front may already have changed by the next read.
const RECENT: Duration = Duration::from_secs(3);
/// How long after `shottr_grab` the next image copied goes straight to a ticket.
const ARMED_FOR: Duration = Duration::from_secs(180);

struct Watch {
    /// The clipboard's change count at the last read; None before the first.
    count: Option<isize>,
    /// When Shottr was last seen in front.
    shottr_seen: Option<Instant>,
    /// When `shottr_grab` asked for a screenshot.
    armed: Option<Instant>,
}

/// The screenshot on offer: its bytes and the extension it's saved with.
static HELD: Mutex<Option<(Vec<u8>, &'static str)>> = Mutex::new(None);

static WATCH: Mutex<Watch> = Mutex::new(Watch { count: None, shottr_seen: None, armed: None });
static WATCHING: AtomicBool = AtomicBool::new(false);

/// Whether Shottr is installed, where apps usually live.
fn installed() -> bool {
    let home = std::env::var("HOME").unwrap_or_default();
    ["/Applications/Shottr.app".to_string(), format!("{home}/Applications/Shottr.app"), "/Applications/Setapp/Shottr.app".to_string()]
        .iter()
        .any(|p| std::path::Path::new(p).exists())
}

/// Starts watching the clipboard for Shottr's screenshots, if Shottr is installed
/// and the watch isn't running yet.
pub fn start(app: &AppHandle) {
    if !installed() || WATCHING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(POLL_MS));
        let handle = app.clone();
        // AppKit's clipboard and workspace are read on the main thread.
        if app.run_on_main_thread(move || tick(&handle)).is_err() {
            WATCHING.store(false, Ordering::SeqCst);
            break;
        }
    });
}

/// What a read of the clipboard found.
#[derive(Debug, PartialEq)]
enum Shot {
    /// Nothing new, or nothing that's Shottr's.
    None,
    /// A Shottr screenshot to offer.
    Offer,
    /// The screenshot `shottr_grab` asked for: straight to a ticket.
    Ticket,
}

/// Decides what a clipboard read means. `count` is the change count now,
/// `image` whether the clipboard holds an image, `front` whether Shottr is in front.
fn judge(w: &mut Watch, count: isize, image: bool, front: bool, now: Instant) -> Shot {
    if front {
        w.shottr_seen = Some(now);
    }
    let Some(last) = w.count.replace(count) else {
        // What was on the clipboard before Workdesk looked isn't offered.
        return Shot::None;
    };
    if count == last || !image {
        return Shot::None;
    }
    if w.armed.take().is_some_and(|t| now.duration_since(t) < ARMED_FOR) {
        return Shot::Ticket;
    }
    if w.shottr_seen.is_some_and(|t| now.duration_since(t) < RECENT) {
        return Shot::Offer;
    }
    Shot::None
}

#[cfg(target_os = "macos")]
fn tick(app: &AppHandle) {
    use tauri::Emitter;

    let board = objc2_app_kit::NSPasteboard::generalPasteboard();
    let count = board.changeCount();
    let front = shottr_in_front();
    let mut w = WATCH.lock().unwrap_or_else(|e| e.into_inner());
    // Types are only listed when the count moved, which is rare.
    let image = w.count.is_some_and(|c| c != count) && image_type(&board).is_some();
    let shot = judge(&mut w, count, image, front, Instant::now());
    drop(w);
    if shot == Shot::None {
        return;
    }
    let Some(image) = read_image(&board) else { return };
    *HELD.lock().unwrap_or_else(|e| e.into_inner()) = Some(image);
    if shot == Shot::Offer {
        let _ = app.emit("shottr-shot", ());
    } else if let Err(e) = ticket(app) {
        eprintln!("shottr: {e}");
    }
}

#[cfg(not(target_os = "macos"))]
fn tick(_app: &AppHandle) {}

#[cfg(target_os = "macos")]
fn shottr_in_front() -> bool {
    objc2_app_kit::NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .and_then(|a| a.bundleIdentifier())
        .is_some_and(|id| id.to_string() == BUNDLE_ID)
}

/// The clipboard's image type, PNG first (Shottr copies both PNG and TIFF), and
/// the extension it's saved with.
#[cfg(target_os = "macos")]
fn image_type(board: &objc2_app_kit::NSPasteboard) -> Option<(&'static objc2_app_kit::NSPasteboardType, &'static str)> {
    use objc2_app_kit::{NSPasteboardTypePNG, NSPasteboardTypeTIFF};

    let types = board.types()?;
    // SAFETY: the statics are AppKit's pasteboard type names.
    let known = unsafe { [(NSPasteboardTypePNG, "png"), (NSPasteboardTypeTIFF, "tiff")] };
    known.into_iter().find(|(t, _)| types.containsObject(t))
}

/// The clipboard's image and its extension.
#[cfg(target_os = "macos")]
fn read_image(board: &objc2_app_kit::NSPasteboard) -> Option<(Vec<u8>, &'static str)> {
    let (kind, ext) = image_type(board)?;
    Some((board.dataForType(kind)?.to_vec(), ext))
}

/// Saves the held screenshot with the ticket images and opens the composer with it.
fn ticket(app: &AppHandle) -> Result<(), String> {
    use tauri::Emitter;

    let (bytes, ext) = HELD.lock().unwrap_or_else(|e| e.into_inner()).take().ok_or("That screenshot is already in a ticket")?;
    let path = crate::files::save_ticket_bytes(&format!("shottr.{ext}"), &bytes)?;
    let name = path.rsplit('/').next().unwrap_or("shottr.png");
    // Every offer of it goes away.
    let _ = app.emit("shottr-taken", ());
    crate::dock::open_composer(app, &format!("![{name}]({path})"))
}

/// The screenshot on offer, for the drop zone to show.
#[tauri::command]
pub fn shottr_preview() -> Result<tauri::ipc::Response, String> {
    HELD.lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|(bytes, _)| tauri::ipc::Response::new(bytes.clone()))
        .ok_or_else(|| "No screenshot on offer".into())
}

/// Whether Shottr is installed, so its buttons show.
#[tauri::command]
pub fn shottr_installed(app: AppHandle) -> bool {
    let yes = installed();
    if yes {
        start(&app);
    }
    yes
}

/// Asks Shottr for an area screenshot; the next image it copies opens the
/// composer with it.
#[tauri::command]
pub fn shottr_grab(app: AppHandle) -> Result<(), String> {
    if !installed() {
        return Err("Shottr isn't installed: get it from shottr.cc".into());
    }
    start(&app);
    WATCH.lock().unwrap_or_else(|e| e.into_inner()).armed = Some(Instant::now());
    std::process::Command::new("open")
        .arg("shottr://grab/area")
        .status()
        .map_err(|e| format!("Couldn't open Shottr: {e}"))
        .and_then(|s| if s.success() { Ok(()) } else { Err("Couldn't open Shottr".into()) })
}

/// Takes the offered screenshot: it's saved with the ticket images and the
/// composer opens with it in the description.
#[tauri::command]
pub fn shottr_ticket(app: AppHandle) -> Result<(), String> {
    ticket(&app)
}

#[cfg(test)]
mod tests {
    use super::{judge, Shot, Watch, ARMED_FOR, RECENT};
    use std::time::{Duration, Instant};

    fn fresh() -> Watch {
        Watch { count: None, shottr_seen: None, armed: None }
    }

    #[test]
    fn ignores_what_was_there_first() {
        let mut w = fresh();
        assert_eq!(judge(&mut w, 5, true, true, Instant::now()), Shot::None);
    }

    #[test]
    fn offers_images_shottr_copies() {
        let mut w = fresh();
        let t = Instant::now();
        judge(&mut w, 1, false, true, t);
        // Shottr's editor closed by the next read: it was in front just before.
        assert_eq!(judge(&mut w, 2, true, false, t + Duration::from_millis(400)), Shot::Offer);
        // The same copy isn't offered twice.
        assert_eq!(judge(&mut w, 2, true, false, t + Duration::from_millis(800)), Shot::None);
    }

    #[test]
    fn leaves_other_copies_alone() {
        let mut w = fresh();
        let t = Instant::now();
        judge(&mut w, 1, false, true, t);
        // Text copied in Shottr isn't a screenshot.
        assert_eq!(judge(&mut w, 2, false, true, t), Shot::None);
        // An image copied long after Shottr was in front isn't Shottr's.
        assert_eq!(judge(&mut w, 3, true, false, t + RECENT + Duration::from_secs(1)), Shot::None);
    }

    #[test]
    fn grabbed_screenshots_go_straight_to_a_ticket() {
        let mut w = fresh();
        let t = Instant::now();
        judge(&mut w, 1, false, false, t);
        w.armed = Some(t);
        assert_eq!(judge(&mut w, 2, true, false, t + Duration::from_secs(20)), Shot::Ticket);
        // Only once.
        assert_eq!(judge(&mut w, 3, true, false, t + Duration::from_secs(21)), Shot::None);
        // And not after it's given up waiting.
        w.armed = Some(t);
        assert_eq!(judge(&mut w, 4, true, false, t + ARMED_FOR + Duration::from_secs(1)), Shot::None);
    }
}
