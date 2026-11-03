//! Lets coding agents write Workdesk's own tickets.
//!
//! Workdesk's tickets live in the main window's storage, out of an agent's
//! reach, so agents drop them in an inbox instead: ~/.workdesk/inbox/tickets.
//! A Claude Code skill (`workdesk-ticket`, installed into ~/.claude/skills on
//! launch) carries a script that writes one there as a small text file:
//!
//! ```text
//! title: Fix the login redirect loop
//! project: workdesk
//! repo: /Users/me/Projects/workdesk
//! ---
//! The description, in Markdown.
//! ```
//!
//! Workdesk watches the inbox. When a ticket arrives, "agent-tickets" goes out;
//! the main window takes them (`agent_tickets_take`, which deletes the files),
//! adds each to its backlog, and answers with the id (`agent_tickets_done`
//! writes `<name>.done`), which the script waits for and prints.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

const SKILL_MD: &str = include_str!("../skill/workdesk-ticket/SKILL.md");
const SCRIPT: &str = include_str!("../skill/workdesk-ticket/new-ticket.sh");
/// How often the inbox is looked at.
const POLL: Duration = Duration::from_millis(700);
/// Answers nobody picked up are cleared after this long.
const DONE_TTL: Duration = Duration::from_secs(120);

static WATCHING: AtomicBool = AtomicBool::new(false);
/// One take at a time, so a ticket is never handed out twice.
static TAKING: Mutex<()> = Mutex::new(());

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

fn inbox() -> PathBuf {
    home().join(".workdesk/inbox/tickets")
}

fn skill_dir() -> PathBuf {
    let claude = std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|| home().join(".claude"));
    claude.join("skills/workdesk-ticket")
}

/// Writes `text` to `path` unless it's already there, so launches don't touch
/// the files' dates for nothing.
fn write_if_changed(path: &Path, text: &str) -> std::io::Result<()> {
    if std::fs::read_to_string(path).is_ok_and(|old| old == text) {
        return Ok(());
    }
    std::fs::write(path, text)
}

/// Installs (or updates) the skill into Claude Code's user skills.
fn install_skill() -> std::io::Result<()> {
    let dir = skill_dir();
    std::fs::create_dir_all(&dir)?;
    let md = SKILL_MD.replace("{{DIR}}", &dir.to_string_lossy());
    write_if_changed(&dir.join("SKILL.md"), &md)?;
    let script = dir.join("new-ticket.sh");
    write_if_changed(&script, SCRIPT)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))?;
    }
    Ok(())
}

/// Installs the skill and starts watching the inbox.
pub fn start(app: &AppHandle) {
    if WATCHING.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Err(e) = install_skill() {
        eprintln!("agent tickets: couldn't install the skill: {e}");
    }
    if let Err(e) = std::fs::create_dir_all(inbox()) {
        eprintln!("agent tickets: couldn't make the inbox: {e}");
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(POLL);
        let (waiting, stale) = scan(&inbox());
        for p in stale {
            let _ = std::fs::remove_file(p);
        }
        if waiting {
            let _ = app.emit("agent-tickets", ());
        }
    });
}

/// Whether tickets are waiting in `dir`, and the answers old enough to clear.
fn scan(dir: &Path) -> (bool, Vec<PathBuf>) {
    let mut waiting = false;
    let mut stale = Vec::new();
    let now = SystemTime::now();
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        match path.extension().and_then(|e| e.to_str()) {
            Some("md") => waiting = true,
            Some("done") => {
                let old = entry.metadata().and_then(|m| m.modified()).ok().and_then(|t| now.duration_since(t).ok());
                if old.is_some_and(|d| d > DONE_TTL) {
                    stale.push(path);
                }
            }
            _ => {}
        }
    }
    (waiting, stale)
}

/// A ticket an agent wrote.
#[derive(Serialize, Debug, PartialEq)]
pub struct AgentTicket {
    /// The inbox file's name without `.md`, for the answer.
    name: String,
    title: String,
    project: String,
    /// The repository it was written from, when it belongs to it.
    repo: Option<String>,
    body: String,
}

/// Reads one inbox file: `key: value` lines, then `---`, then the description.
fn parse(name: &str, text: &str) -> Option<AgentTicket> {
    let (head, body) = match text.split_once("\n---\n") {
        Some((h, b)) => (h, b),
        None => (text.strip_suffix("\n---").unwrap_or(text), ""),
    };
    let mut t = AgentTicket { name: name.into(), title: String::new(), project: String::new(), repo: None, body: body.trim().into() };
    for line in head.lines() {
        let Some((key, value)) = line.split_once(':') else { continue };
        let value = value.trim().to_string();
        match key.trim() {
            "title" => t.title = value,
            "project" => t.project = value,
            "repo" if !value.is_empty() => t.repo = Some(value),
            _ => {}
        }
    }
    (!t.title.is_empty()).then_some(t)
}

/// Takes every ticket waiting in the inbox, oldest first; their files are deleted.
#[tauri::command]
pub fn agent_tickets_take() -> Vec<AgentTicket> {
    let _one = TAKING.lock().unwrap_or_else(|e| e.into_inner());
    let mut files: Vec<(SystemTime, PathBuf)> = std::fs::read_dir(inbox())
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "md"))
        .map(|p| (std::fs::metadata(&p).and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH), p))
        .collect();
    files.sort();
    files
        .into_iter()
        .filter_map(|(_, path)| {
            let text = std::fs::read_to_string(&path).ok();
            let _ = std::fs::remove_file(&path);
            let name = path.file_stem()?.to_str()?.to_string();
            let t = parse(&name, &text?);
            if t.is_none() {
                eprintln!("agent tickets: skipped {} (no title)", path.display());
            }
            t
        })
        .collect()
}

/// Tells the script that wrote ticket `name` the id it got.
#[tauri::command]
pub fn agent_tickets_done(name: String, id: String) -> Result<(), String> {
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Not an inbox ticket".into());
    }
    std::fs::write(inbox().join(format!("{name}.done")), id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{parse, AgentTicket};

    #[test]
    fn reads_a_ticket() {
        let t = parse("1-2-3", "title: Fix it\nproject: app\nrepo: /src/app\n---\nWhy: it's broken.\n\n---\nMore.\n").unwrap();
        assert_eq!(
            t,
            AgentTicket {
                name: "1-2-3".into(),
                title: "Fix it".into(),
                project: "app".into(),
                repo: Some("/src/app".into()),
                body: "Why: it's broken.\n\n---\nMore.".into(),
            }
        );
    }

    #[test]
    fn needs_only_a_title() {
        let t = parse("n", "title: Just this\nproject: \n---\n\n").unwrap();
        assert_eq!((t.project.as_str(), t.repo, t.body.as_str()), ("", None, ""));
        // Colons in the title are kept.
        assert_eq!(parse("n", "title: a: b\n---\n").unwrap().title, "a: b");
    }

    #[test]
    fn refuses_a_ticket_without_a_title() {
        assert_eq!(parse("n", "project: app\n---\nbody\n"), None);
    }
}
