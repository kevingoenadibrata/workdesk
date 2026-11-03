//! Native touches on the menu bar that Tauri's menu API can't make: SF Symbol
//! icons, and shortcuts that are shown but never pressed.
//!
//! Icons: macOS gives its standard items (Cut, Copy, Minimize, Zoom…) icons by
//! itself; ours have none. So once the menu is in place, walk the native menu
//! and give each item whose title is listed below its symbol. Items that
//! already have an image are left alone, and titles with no good match (like
//! the loadout names) aren't listed on purpose.
//!
//! Shortcuts: a live key equivalent would take the key before the webview,
//! where the frontend's keydown handler binds every shortcut (see `build_menu`).
//! So each submenu gets a delegate that puts the key equivalents on its items
//! when it opens and takes them off when it closes: they show while you look,
//! and there's nothing for a key press to match the rest of the time.
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

/// Which modifiers a shortcut uses.
#[derive(Debug, Default, PartialEq)]
pub struct Mods {
    pub cmd: bool,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}

/// A combo from src/shortcuts.ts ("mod+shift+]", "mod+alt+arrowleft") as an
/// AppKit key equivalent and its modifiers, or None for a key it can't show.
pub fn key_equivalent(combo: &str) -> Option<(String, Mods)> {
    let mut parts: Vec<&str> = combo.split('+').collect();
    // "mod++" would split into empty parts; the combos never bind "+" itself.
    let key = parts.pop().filter(|k| !k.is_empty())?;
    let mut mods = Mods::default();
    for p in parts {
        match p {
            "mod" => mods.cmd = true,
            "ctrl" => mods.ctrl = true,
            "alt" => mods.alt = true,
            "shift" => mods.shift = true,
            _ => return None,
        }
    }
    let ch = |c: u32| char::from_u32(c).map(String::from);
    let key = match key {
        "arrowup" => ch(0xF700)?,
        "arrowdown" => ch(0xF701)?,
        "arrowleft" => ch(0xF702)?,
        "arrowright" => ch(0xF703)?,
        "enter" => "\r".into(),
        "tab" => "\t".into(),
        "space" => " ".into(),
        "backspace" => "\u{8}".into(),
        "delete" => "\u{7f}".into(),
        "escape" => "\u{1b}".into(),
        k if k.len() > 1 && k.starts_with('f') => {
            let n: u32 = k[1..].parse().ok().filter(|n| (1..=20).contains(n))?;
            ch(0xF704 + n - 1)?
        }
        k if k.chars().count() == 1 => k.to_lowercase(),
        _ => return None,
    };
    Some((key, mods))
}

/// Adds the icons to the app's menu bar, and `keys` — (item title, combo) —
/// as shortcuts shown while a menu is open. Call it after `set_menu`: that
/// sets the native menu on a main-thread task, and this queues behind it.
pub fn apply<R: Runtime>(app: &AppHandle<R>, keys: Vec<(String, String)>) {
    #[cfg(target_os = "macos")]
    let _ = app.run_on_main_thread(move || {
        use objc2::MainThreadMarker;
        use objc2_app_kit::NSApplication;
        let Some(mtm) = MainThreadMarker::new() else { return };
        if let Some(menu) = NSApplication::sharedApplication(mtm).mainMenu() {
            imp::decorate(mtm, &menu, &keys);
        }
    });
    #[cfg(not(target_os = "macos"))]
    let _ = (app, keys);
}

#[cfg(target_os = "macos")]
mod imp {
    use std::cell::RefCell;

    use objc2::rc::Retained;
    use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
    use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSEventModifierFlags, NSImage, NSMenu, NSMenuDelegate, NSMenuItem};
    use objc2_foundation::NSString;

    use super::{key_equivalent, symbol_for};

    type Shortcut = (Retained<NSMenuItem>, Retained<NSString>, NSEventModifierFlags);

    define_class!(
        /// A submenu's delegate that shows its items' shortcuts only while it's open.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[ivars = Vec<Shortcut>]
        #[name = "WorkdeskMenuShortcuts"]
        struct MenuShortcuts;

        unsafe impl NSObjectProtocol for MenuShortcuts {}

        unsafe impl NSMenuDelegate for MenuShortcuts {
            #[unsafe(method(menuWillOpen:))]
            fn menu_will_open(&self, _menu: &NSMenu) {
                for (item, key, mods) in self.ivars() {
                    item.setKeyEquivalentModifierMask(*mods);
                    item.setKeyEquivalent(key);
                }
            }

            #[unsafe(method(menuDidClose:))]
            fn menu_did_close(&self, _menu: &NSMenu) {
                for (item, _, _) in self.ivars() {
                    item.setKeyEquivalent(&NSString::new());
                }
            }
        }
    );

    thread_local! {
        /// The delegates of the current menu bar (NSMenu holds its delegate weakly).
        static DELEGATES: RefCell<Vec<Retained<MenuShortcuts>>> = const { RefCell::new(Vec::new()) };
    }

    pub fn decorate(mtm: MainThreadMarker, main: &NSMenu, keys: &[(String, String)]) {
        let mut delegates = Vec::new();
        for top in main.itemArray().iter() {
            if let Some(sub) = top.submenu() {
                decorate_menu(mtm, &sub, keys, &mut delegates);
            }
        }
        DELEGATES.with(|d| *d.borrow_mut() = delegates);
    }

    fn decorate_menu(mtm: MainThreadMarker, menu: &NSMenu, keys: &[(String, String)], delegates: &mut Vec<Retained<MenuShortcuts>>) {
        let mut shortcuts = Vec::new();
        for item in menu.itemArray().iter() {
            if let Some(sub) = item.submenu() {
                decorate_menu(mtm, &sub, keys, delegates);
                continue;
            }
            let title = item.title().to_string();
            if item.image().is_none() {
                if let Some(symbol) = symbol_for(&title) {
                    let image = NSImage::imageWithSystemSymbolName_accessibilityDescription(&NSString::from_str(symbol), None);
                    item.setImage(image.as_deref());
                }
            }
            let shortcut = keys.iter().find(|(t, _)| *t == title).and_then(|(_, combo)| key_equivalent(combo));
            if let Some((key, m)) = shortcut {
                let mut mods = NSEventModifierFlags::empty();
                for (on, flag) in [
                    (m.cmd, NSEventModifierFlags::Command),
                    (m.ctrl, NSEventModifierFlags::Control),
                    (m.alt, NSEventModifierFlags::Option),
                    (m.shift, NSEventModifierFlags::Shift),
                ] {
                    if on {
                        mods |= flag;
                    }
                }
                shortcuts.push((item.clone(), NSString::from_str(&key), mods));
            }
        }
        if shortcuts.is_empty() {
            return;
        }
        let delegate = MenuShortcuts::alloc(mtm).set_ivars(shortcuts);
        let delegate: Retained<MenuShortcuts> = unsafe { msg_send![super(delegate), init] };
        menu.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        delegates.push(delegate);
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
    fn turns_combos_into_key_equivalents() {
        let cmd = Mods { cmd: true, ..Mods::default() };
        assert_eq!(key_equivalent("mod+t"), Some(("t".into(), cmd)));
        assert_eq!(
            key_equivalent("mod+shift+]"),
            Some(("]".into(), Mods { cmd: true, shift: true, ..Mods::default() }))
        );
        assert_eq!(
            key_equivalent("mod+alt+arrowleft"),
            Some(("\u{f702}".into(), Mods { cmd: true, alt: true, ..Mods::default() }))
        );
        assert_eq!(key_equivalent("mod+shift+enter").unwrap().0, "\r");
        assert_eq!(key_equivalent("f5").unwrap().0, "\u{f708}");
        assert_eq!(key_equivalent("mod+numpadenter"), None);
        assert_eq!(key_equivalent("hyper+k"), None);
    }

    #[test]
    fn looks_up_by_exact_title() {
        assert_eq!(symbol_for("Split Right"), Some("rectangle.split.2x1"));
        assert_eq!(symbol_for("#work"), None);
    }
}
