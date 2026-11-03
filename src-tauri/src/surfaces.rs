//! Which of Workdesk's always-on windows outside the main one are shown: the
//! strip around the notch (`notch`) and the cards beside the Dock (`dock`).
//!
//! Kept in ~/.workdesk/surfaces.json rather than the main window's storage so
//! `setup` knows before opening them, and a hidden one never flashes at launch.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(default)]
pub struct Surfaces {
    pub notch: bool,
    pub dock: bool,
}

impl Default for Surfaces {
    fn default() -> Self {
        Surfaces { notch: true, dock: true }
    }
}

fn path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".into());
    PathBuf::from(home).join(".workdesk/surfaces.json")
}

fn parse(text: &str) -> Surfaces {
    serde_json::from_str(text).unwrap_or_default()
}

/// The saved choice; both shown when nothing is saved or the file is unreadable.
pub fn load() -> Surfaces {
    std::fs::read_to_string(path()).map(|t| parse(&t)).unwrap_or_default()
}

fn save(s: Surfaces) -> Result<(), String> {
    let p = path();
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&s).map_err(|e| e.to_string())?;
    std::fs::write(&p, text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn surfaces_get() -> Surfaces {
    load()
}

/// Shows or hides the notch and the Dock cards right away, and remembers it.
#[tauri::command]
pub fn surfaces_set(app: AppHandle, surfaces: Surfaces) -> Result<(), String> {
    save(surfaces)?;
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = if surfaces.notch { crate::notch::open(&handle) } else { crate::notch::close(&handle) };
        if let Err(e) = result {
            eprintln!("notch: {e}");
        }
        let result = if surfaces.dock { crate::dock::open(&handle) } else { crate::dock::close(&handle) };
        if let Err(e) = result {
            eprintln!("dock: {e}");
        }
    })
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_fields_default_to_shown() {
        assert_eq!(parse("{}"), Surfaces { notch: true, dock: true });
        assert_eq!(parse(r#"{"dock":false}"#), Surfaces { notch: true, dock: false });
        assert_eq!(parse("not json"), Surfaces::default());
    }
}
