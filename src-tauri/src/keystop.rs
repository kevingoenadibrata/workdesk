//! Keeps keys a webview leaves unhandled from being typed into it (macOS).
//!
//! With Tauri's multiwebview ("unstable"), every webview — Workdesk's own included —
//! is a child WKWebView added straight into tao's view of the window. A key the
//! page doesn't take (an arrow key, say) goes up the responder chain to tao's view,
//! whose `keyDown:` runs `interpretKeyEvents:`; macOS text input then types the
//! key's legacy control character (→ is U+001D) into the focused field as a box,
//! and the caret never moves. A single-webview window doesn't do this: wry wraps
//! its webview in a parent whose `keyDown:` only offers the key to the menu.
//!
//! So a `KeyStop` responder goes between each WKWebView and tao's view. Keys
//! reaching it are interpreted against the standard key bindings: movement
//! commands (`moveRight:`, `moveWordLeftAndModifySelection:`, …) go back to the
//! webview, which moves the caret; anything else, text included, ends there.
//! Menu shortcuts still work (they're offered to the menu before any `keyDown:`),
//! and mouse, scroll and key-up events still pass on to tao's view.

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::c_void;

    use objc2::rc::{Retained, Weak};
    use objc2::runtime::{AnyObject, Bool, NSObject, Sel};
    use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSEvent, NSResponder};
    use objc2_foundation::NSArray;

    pub struct Ivars {
        webview: Weak<NSResponder>,
    }

    define_class!(
        #[unsafe(super(NSResponder, NSObject))]
        #[thread_kind = MainThreadOnly]
        #[ivars = Ivars]
        #[name = "WorkdeskKeyStop"]
        pub struct KeyStop;

        impl KeyStop {
            #[unsafe(method(keyDown:))]
            fn key_down(&self, event: &NSEvent) {
                self.interpretKeyEvents(&NSArray::from_slice(&[event]));
            }

            #[unsafe(method(doCommandBySelector:))]
            fn do_command(&self, command: Sel) {
                if !command.name().to_bytes().starts_with(b"move") {
                    return;
                }
                if let Some(webview) = self.ivars().webview.load() {
                    let _: Bool = unsafe { msg_send![&*webview, tryToPerform: command, with: None::<&AnyObject>] };
                }
            }

            #[unsafe(method(insertText:))]
            fn insert_text(&self, _text: &AnyObject) {}
        }
    );

    unsafe extern "C" {
        fn objc_setAssociatedObject(object: *mut AnyObject, key: *const c_void, value: *mut AnyObject, policy: usize);
    }
    const OBJC_ASSOCIATION_RETAIN_NONATOMIC: usize = 1;
    static KEY: u8 = 0;

    /// Puts a `KeyStop` after `webview` (a WKWebView) in the responder chain, once.
    pub fn install(webview: *mut c_void) {
        let Some(mtm) = MainThreadMarker::new() else { return };
        let Some(webview) = (unsafe { Retained::retain(webview.cast::<NSResponder>()) }) else { return };
        let Some(next) = (unsafe { webview.nextResponder() }) else { return };
        if next.class().name().to_bytes() == b"WorkdeskKeyStop" {
            return;
        }
        let stop = KeyStop::alloc(mtm).set_ivars(Ivars { webview: Weak::from_retained(&webview) });
        let stop: Retained<KeyStop> = unsafe { msg_send![super(stop), init] };
        unsafe {
            stop.setNextResponder(Some(&next));
            webview.setNextResponder(Some(&stop));
            // The webview keeps its KeyStop alive; the KeyStop only holds it weakly.
            objc_setAssociatedObject(
                Retained::as_ptr(&webview) as *mut AnyObject,
                &KEY as *const u8 as *const c_void,
                Retained::as_ptr(&stop) as *mut AnyObject,
                OBJC_ASSOCIATION_RETAIN_NONATOMIC,
            );
        }
    }
}

/// Stops keys `webview` leaves unhandled from being typed into it as control characters.
pub fn contain_keys<R: tauri::Runtime>(webview: &tauri::Webview<R>) {
    #[cfg(target_os = "macos")]
    let _ = webview.with_webview(|w| imp::install(w.inner()));
    #[cfg(not(target_os = "macos"))]
    let _ = webview;
}
