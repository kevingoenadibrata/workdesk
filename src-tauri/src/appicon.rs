use tauri::AppHandle;

/// The alternate Dock icons, rendered by `branding/build.mjs`. "classic" is
/// the bundle's own icon.
const VARIANTS: &[(&str, &[u8])] = &[
    ("classic", include_bytes!("../icons/variants/classic.png")),
    ("light", include_bytes!("../icons/variants/light.png")),
    ("copper", include_bytes!("../icons/variants/copper.png")),
    ("ember", include_bytes!("../icons/variants/ember.png")),
    ("midnight", include_bytes!("../icons/variants/midnight.png")),
    ("forest", include_bytes!("../icons/variants/forest.png")),
    ("ocean", include_bytes!("../icons/variants/ocean.png")),
    ("sunset", include_bytes!("../icons/variants/sunset.png")),
    ("graphite", include_bytes!("../icons/variants/graphite.png")),
    ("phosphor", include_bytes!("../icons/variants/phosphor.png")),
];

/// Swaps the Dock icon for variant `id` while the app runs. macOS shows the
/// bundle's icon again once it quits, so the frontend reapplies it at launch.
#[tauri::command]
pub fn set_app_icon(app: AppHandle, id: String) -> Result<(), String> {
    let bytes = VARIANTS
        .iter()
        .find(|(name, _)| *name == id)
        .map(|(_, bytes)| *bytes)
        .ok_or_else(|| format!("no app icon named {id}"))?;
    #[cfg(target_os = "macos")]
    app.run_on_main_thread(move || {
        use objc2::MainThreadMarker;
        use objc2::AllocAnyThread;
        use objc2_app_kit::{NSApplication, NSImage};
        use objc2_foundation::NSData;
        let Some(mtm) = MainThreadMarker::new() else { return };
        let ns_app = NSApplication::sharedApplication(mtm);
        // Classic is the bundle icon, so clear the override rather than set a copy of it.
        let image = if id == "classic" { None } else { NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(bytes)) };
        unsafe { ns_app.setApplicationIconImage(image.as_deref()) };
    })
    .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = (app, bytes);
    Ok(())
}
