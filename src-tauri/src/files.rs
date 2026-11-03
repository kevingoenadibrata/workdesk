use std::path::{Path, PathBuf};
use std::process::Command;

/// Editors Workdesk can open a file in at a line, with the app bundle that marks each installed.
const EDITORS: &[(&str, &str)] = &[
    ("vscode", "Visual Studio Code.app"),
    ("cursor", "Cursor.app"),
    ("windsurf", "Windsurf.app"),
    ("zed", "Zed.app"),
    ("sublime", "Sublime Text.app"),
    ("xcode", "Xcode.app"),
];

fn home() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".into())
}

/// Where an app bundle is installed, checking /Applications then ~/Applications.
fn app_path(bundle: &str) -> Option<PathBuf> {
    [PathBuf::from("/Applications"), Path::new(&home()).join("Applications")]
        .into_iter()
        .map(|dir| dir.join(bundle))
        .find(|p| p.is_dir())
}

/// Ids of the editors installed, in the order Settings lists them.
#[tauri::command]
pub fn installed_editors() -> Vec<String> {
    EDITORS
        .iter()
        .filter(|(_, bundle)| app_path(bundle).is_some())
        .map(|(id, _)| id.to_string())
        .collect()
}

#[derive(serde::Serialize)]
pub struct Resolved {
    path: String,
    dir: bool,
}

/// For each of `paths` (absolute, `~/…`, or relative to `cwd`), the absolute
/// path of the file or folder there, or None if there's nothing.
#[tauri::command]
pub fn resolve_files(cwd: String, paths: Vec<String>) -> Vec<Option<Resolved>> {
    let home = home();
    paths
        .into_iter()
        .map(|p| {
            let full = if let Some(rest) = p.strip_prefix("~/") {
                Path::new(&home).join(rest)
            } else if p.starts_with('/') {
                PathBuf::from(&p)
            } else if cwd.is_empty() {
                return None;
            } else {
                Path::new(&cwd).join(&p)
            };
            if !full.exists() {
                return None;
            }
            let full = full.canonicalize().unwrap_or(full);
            let dir = full.is_dir();
            full.into_os_string().into_string().ok().map(|path| Resolved { path, dir })
        })
        .collect()
}

/// Percent-encodes `path` for a URL, keeping the slashes.
fn encode(path: &str) -> String {
    path.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn editor_app(id: &str) -> Option<PathBuf> {
    EDITORS.iter().find(|(e, _)| *e == id).and_then(|(_, b)| app_path(b))
}

/// Opens a file `path` in `editor` at `line` and `col` (1-based) when it can,
/// else in the file's default app. A folder opens in `folder_app`'s editor as
/// a project, or in Finder.
#[tauri::command]
pub fn open_in_editor(editor: String, folder_app: String, path: String, line: Option<u32>, col: Option<u32>) -> Result<(), String> {
    let line = line.unwrap_or(1).max(1);
    let col = col.unwrap_or(1).max(1);
    if Path::new(&path).is_dir() {
        let mut c = Command::new("/usr/bin/open");
        if let Some(app) = editor_app(&folder_app) {
            c.arg("-a").arg(app);
        }
        c.arg(&path);
        return reap(c);
    }
    let bundle = editor_app(&editor);
    let cmd = match (editor.as_str(), bundle) {
        ("vscode" | "cursor" | "windsurf", Some(_)) => {
            let mut c = Command::new("/usr/bin/open");
            c.arg(format!("{editor}://file{}:{line}:{col}", encode(&path)));
            c
        }
        ("zed", Some(app)) => {
            let mut c = Command::new(app.join("Contents/MacOS/cli"));
            c.arg(format!("{path}:{line}:{col}"));
            c
        }
        ("sublime", Some(app)) => {
            let mut c = Command::new(app.join("Contents/SharedSupport/bin/subl"));
            c.arg(format!("{path}:{line}:{col}"));
            c
        }
        ("xcode", Some(_)) => {
            let mut c = Command::new("/usr/bin/xed");
            c.args(["--line", &line.to_string(), &path]);
            c
        }
        _ => {
            let mut c = Command::new("/usr/bin/open");
            c.arg(&path);
            c
        }
    };
    reap(cmd)
}

/// Opens a folder in Finder, or shows a file selected in its folder.
#[tauri::command]
pub fn show_in_finder(path: String) -> Result<(), String> {
    let mut c = Command::new("/usr/bin/open");
    if !Path::new(&path).is_dir() {
        c.arg("-R");
    }
    c.arg(&path);
    reap(c)
}

/// Starts `cmd`, and reaps it once it exits so it doesn't linger as a zombie.
fn reap(mut cmd: Command) -> Result<(), String> {
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    std::thread::spawn(move || child.wait());
    Ok(())
}

/// Decodes `%XX` escapes (as `encodeURIComponent` writes them).
fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or(""), 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Saves a file dropped onto a pane (raw body, its name percent-encoded in the
/// `x-name` header) to a fresh temp folder, and returns the saved path. The
/// webview only hands over a dropped file's contents, never where it lives.
#[tauri::command]
pub fn save_drop(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw file contents".into());
    };
    let name = request.headers().get("x-name").and_then(|v| v.to_str().ok()).map(decode).unwrap_or_default();
    let name = Path::new(&name).file_name().and_then(|n| n.to_str()).filter(|n| !n.is_empty()).unwrap_or("dropped").to_string();
    save_in(&std::env::temp_dir().join("workdesk-drops"), &name, bytes)
}

/// Writes `bytes` as `name` in a fresh folder under `root`, so names never clash, and returns the path.
fn save_in(root: &Path, name: &str, bytes: &[u8]) -> Result<String, String> {
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let dir = root.join(stamp.to_string());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    path.into_os_string().into_string().map_err(|_| "non-UTF-8 path".into())
}

/// Where images pasted into Workdesk's own tickets are kept.
fn attachments_dir() -> PathBuf {
    Path::new(&home()).join(".workdesk/attachments")
}

/// `name` with only letters, digits, `.`, `_` and `-`, so its path reads as one Markdown link target.
fn plain_name(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') { c } else { '-' }).collect();
    let s = s.trim_matches(|c| c == '.' || c == '-').to_string();
    if s.is_empty() { "image.png".into() } else { s }
}

/// Saves an image pasted into a Workdesk ticket (raw body, its name
/// percent-encoded in `x-name`) under ~/.workdesk/attachments, and returns
/// the path. The ticket links it there, and Claude is told to read it.
#[tauri::command]
pub fn save_ticket_image(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw image contents".into());
    };
    let name = request.headers().get("x-name").and_then(|v| v.to_str().ok()).map(decode).unwrap_or_default();
    let name = plain_name(Path::new(&name).file_name().and_then(|n| n.to_str()).unwrap_or_default());
    save_in(&attachments_dir(), &name, bytes)
}

/// Whether `path` looks like an image a ticket can show, by its extension.
pub fn is_image(path: &Path) -> bool {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase();
    matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "heic" | "tiff" | "tif" | "bmp")
}

/// Saves image bytes (a screenshot read from the clipboard) with the ticket
/// images, as `save_ticket_image` does for pasted ones, and returns the path.
pub fn save_ticket_bytes(name: &str, bytes: &[u8]) -> Result<String, String> {
    save_in(&attachments_dir(), &plain_name(name), bytes)
}

/// Copies an image file in with the ticket images, as `save_ticket_image`
/// does for pasted ones, and returns its new path.
pub fn copy_ticket_image(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Couldn't read {}: {e}", path.display()))?;
    let name = plain_name(path.file_name().and_then(|n| n.to_str()).unwrap_or_default());
    save_in(&attachments_dir(), &name, &bytes)
}

/// The bytes of an image saved by `save_ticket_image`, for showing it in a
/// ticket. Paths outside ~/.workdesk/attachments are refused.
#[tauri::command]
pub fn read_ticket_image(path: String) -> Result<tauri::ipc::Response, String> {
    let root = attachments_dir().canonicalize().map_err(|_| "No images saved yet".to_string())?;
    let real = Path::new(&path).canonicalize().map_err(|_| format!("{path} is gone"))?;
    if !real.starts_with(&root) {
        return Err(format!("{path} isn't a ticket image"));
    }
    std::fs::read(&real).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{is_image, plain_name};
    use std::path::Path;

    #[test]
    fn images_by_extension() {
        assert!(is_image(Path::new("/tmp/Screenshot 2026-11-03.PNG")));
        assert!(is_image(Path::new("a.jpeg")));
        assert!(!is_image(Path::new("notes.md")));
        assert!(!is_image(Path::new("png")));
    }

    #[test]
    fn plain_names_have_no_spaces_or_brackets() {
        assert_eq!(plain_name("Screenshot 2026-11-02 at 10.00.00.png"), "Screenshot-2026-11-02-at-10.00.00.png");
        assert_eq!(plain_name("a(b).png"), "a-b-.png");
        assert_eq!(plain_name(""), "image.png");
        assert_eq!(plain_name(".."), "image.png");
    }
}
