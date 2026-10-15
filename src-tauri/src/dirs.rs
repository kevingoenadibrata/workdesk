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
