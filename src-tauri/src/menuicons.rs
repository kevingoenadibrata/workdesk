//! SF Symbol icons for the menu bar's own items.
//!
//! macOS gives its standard items (Cut, Copy, Minimize, Zoom…) icons by
//! itself; ours have none, since Tauri's menu API can't set SF Symbols. So
//! once the menu is in place, walk the native menu and give each item whose
//! title is listed below its symbol. Items that already have an image are
//! left alone, and titles with no good match (like the loadout names) aren't
//! listed on purpose.

use tauri::{AppHandle, Runtime};

/// Menu item title → SF Symbol name. A symbol this macOS doesn't have just
/// leaves the item without an icon.
const ICONS: &[(&str, &str)] = &[
    // Workdesk
    ("Check for Updates…", "arrow.triangle.2.circlepath"),
    ("Settings…", "gearshape"),
    ("Keyboard Shortcuts", "keyboard"),
    ("Restart Onboarding", "arrow.counterclockwise"),
    ("Quit Workdesk", "power"),
    // File
    ("Teleport: New Tab in Folder…", "folder"),
    ("New Claude Session…", "sparkles"),
    ("New Browser Tab", "globe"),
    ("New Ticket…", "square.and.pencil"),
    ("Rename Tab…", "pencil"),
    ("Close Pane or Tab", "xmark"),
    // Edit
    ("Select All in Terminal", "selection.pin.in.out"),
    ("Find in Terminal…", "magnifyingglass"),
    ("Clear Terminal", "eraser"),
    // View
    ("Home", "house"),
    ("Local Servers", "server.rack"),
    ("Show or Hide Sidebar", "sidebar.left"),
    ("Collapse or Expand Sidebar", "sidebar.squares.left"),
    ("Show or Hide File Tree", "list.bullet.indent"),
    ("Bigger Text", "textformat.size.larger"),
    ("Smaller Text", "textformat.size.smaller"),
    ("Default Text Size", "textformat.size"),
    // Pane
    ("Split Right", "rectangle.split.2x1"),
    ("Split Down", "rectangle.split.1x2"),
    ("Split Right with Browser", "globe"),
    ("Unsplit into Tabs", "rectangle.stack"),
    ("Maximize or Restore Pane", "arrow.up.left.and.arrow.down.right"),
    ("Change Layout…", "rectangle.3.group"),
    ("Next Pane", "chevron.forward"),
    ("Previous Pane", "chevron.backward"),
    ("Focus Pane Left", "arrow.left"),
    ("Focus Pane Right", "arrow.right"),
    ("Focus Pane Above", "arrow.up"),
    ("Focus Pane Below", "arrow.down"),
    // Tabs
    ("Search Tabs…", "magnifyingglass"),
    ("Next Tab", "chevron.forward"),
    ("Previous Tab", "chevron.backward"),
    ("New Group", "folder.badge.plus"),
    ("Group Selected Tabs", "rectangle.stack.badge.plus"),
    ("Ungroup Selected Tabs", "rectangle.stack.badge.minus"),
    // Loadouts
    ("Save All Tabs as Loadout…", "square.and.arrow.down"),
    ("Edit Loadouts…", "slider.horizontal.3"),
];

fn symbol_for(title: &str) -> Option<&'static str> {
    ICONS.iter().find(|(t, _)| *t == title).map(|(_, s)| *s)
}

/// Adds the icons to the app's menu bar. Call it after `set_menu`: that sets
/// the native menu on a main-thread task, and this queues behind it.
pub fn apply<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    let _ = app.run_on_main_thread(|| {
        use objc2::MainThreadMarker;
        use objc2_app_kit::NSApplication;
        let Some(mtm) = MainThreadMarker::new() else { return };
        if let Some(menu) = NSApplication::sharedApplication(mtm).mainMenu() {
            decorate(&menu);
        }
    });
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[cfg(target_os = "macos")]
fn decorate(menu: &objc2_app_kit::NSMenu) {
    use objc2_app_kit::NSImage;
    use objc2_foundation::NSString;
    for item in menu.itemArray().iter() {
        if let Some(sub) = item.submenu() {
            decorate(&sub);
            continue;
        }
        if item.image().is_some() {
            continue;
        }
        let title = item.title().to_string();
        let Some(symbol) = symbol_for(&title) else { continue };
        let image = NSImage::imageWithSystemSymbolName_accessibilityDescription(&NSString::from_str(symbol), None);
        item.setImage(image.as_deref());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_are_unique() {
        for (i, (t, _)) in ICONS.iter().enumerate() {
            assert!(ICONS[i + 1..].iter().all(|(u, _)| u != t), "{t} listed twice");
        }
    }

    #[test]
    fn every_title_is_in_the_menu() {
        let menu = include_str!("lib.rs");
        for (t, _) in ICONS {
            assert!(menu.contains(&format!("\"{t}\"")), "{t} is not a menu item any more");
        }
    }

    #[test]
    fn looks_up_by_exact_title() {
        assert_eq!(symbol_for("Split Right"), Some("rectangle.split.2x1"));
        assert_eq!(symbol_for("#work"), None);
    }
}
