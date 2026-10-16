use std::path::Path;

/// The user's home directory, used to expand and abbreviate `~`.
#[tauri::command]
pub fn home_dir() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".into())
}

/// Names of the subdirectories of `path`, sorted case-insensitively. Hidden
/// directories are left out unless `hidden` is set. Symlinks to directories count.
#[tauri::command]
pub fn list_dirs(path: String, hidden: bool) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(&path) else { return Vec::new() };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|name| hidden || !name.starts_with('.'))
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    names
}

/// Which of `paths` are existing directories, so stale recents can be dropped.
#[tauri::command]
pub fn existing_dirs(paths: Vec<String>) -> Vec<String> {
    paths.into_iter().filter(|p| Path::new(p).is_dir()).collect()
}

#[derive(serde::Serialize)]
pub struct Entry {
    name: String,
    dir: bool,
}

/// Everything in `path`, folders first, each sorted case-insensitively. Hidden
/// entries are left out unless `hidden` is set. Symlinks count as what they point to.
#[tauri::command]
pub fn list_entries(path: String, hidden: bool) -> Result<Vec<Entry>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut out: Vec<Entry> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            (hidden || !name.starts_with('.')).then(|| Entry { dir: e.path().is_dir(), name })
        })
        .collect();
    out.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}
