//! Subscription usage limits (the 5-hour and weekly windows) for Claude Code
//! and Codex, for the Agent Monitor page.
//!
//! Claude Code doesn't write its limits to disk, so a status line script
//! (~/.claude/workdesk-statusline.sh) saves them while a session runs. With no
//! session open, the user can ask for a one-off Haiku request, whose stream
//! reports the same numbers. Codex logs its limits in every rollout file.

use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use serde::Serialize;
use serde_json::{json, Value};

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    /// The window's length: 300 for the 5-hour window, 10080 for the week.
    minutes: u64,
    used_percent: f64,
    /// Unix seconds.
    resets_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    windows: Vec<Window>,
    /// When these numbers were read, in ms.
    updated_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    claude: Option<Limits>,
    codex: Option<Limits>,
    /// Whether a Claude Code session is running anywhere, which keeps the
    /// status line file fresh (and so the Haiku ping is off).
    claude_session_open: bool,
}

#[tauri::command]
pub async fn usage_status() -> Result<Usage, String> {
    tauri::async_runtime::spawn_blocking(|| Usage {
        claude: claude_limits(),
        codex: codex_limits(),
        claude_session_open: claude_session_open(),
    })
    .await
    .map_err(|e| e.to_string())
}

/// Sends Claude Code a tiny Haiku request to read the current limits. Refused
/// while a session is open: the status line already has them.
#[tauri::command]
pub async fn usage_ping_claude() -> Result<Usage, String> {
    tauri::async_runtime::spawn_blocking(|| {
        if claude_session_open() {
            return Err("A Claude Code session is open; its limits are already shown.".into());
        }
        let limits = ping_claude()?;
        let out = claude_dir().join("workdesk-usage-ping.json");
        std::fs::write(&out, json!({ "rate_limits": limits }).to_string()).map_err(|e| e.to_string())?;
        Ok(Usage { claude: claude_limits(), codex: codex_limits(), claude_session_open: false })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

fn modified_ms(path: &Path) -> Option<u64> {
    let t = std::fs::metadata(path).ok()?.modified().ok()?;
    Some(t.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64)
}

// ---- Claude Code ----

fn claude_dir() -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|| home().join(".claude"))
}

/// The newer of what the status line and the last ping saved. Both hold
/// Claude Code's status line `rate_limits` shape.
fn claude_limits() -> Option<Limits> {
    ["workdesk-usage.json", "workdesk-usage-ping.json"]
        .iter()
        .filter_map(|name| {
            let path = claude_dir().join(name);
            let updated_at = modified_ms(&path)?;
            let v: Value = serde_json::from_str(&std::fs::read_to_string(&path).ok()?).ok()?;
            let windows = claude_windows(&v["rate_limits"]);
            (!windows.is_empty()).then_some(Limits { windows, updated_at })
        })
        .max_by_key(|l| l.updated_at)
}

fn claude_windows(limits: &Value) -> Vec<Window> {
    [("five_hour", 300), ("seven_day", 10080)]
        .iter()
        .filter_map(|&(key, minutes)| {
            let w = &limits[key];
            Some(Window { minutes, used_percent: w["used_percentage"].as_f64()?, resets_at: w["resets_at"].as_u64()? })
        })
        .collect()
}

/// Claude Code writes ~/.claude/sessions/<pid>.json for each running session.
fn claude_session_open() -> bool {
    std::fs::read_dir(claude_dir().join("sessions"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| e.path().file_stem()?.to_str()?.parse::<libc::pid_t>().ok())
        .any(|pid| pid > 0 && unsafe { libc::kill(pid, 0) } == 0)
}

/// Runs `claude -p` on Haiku with no tools, MCP servers, settings or saved
/// session, so the request is a few hundred tokens. The stream's
/// `rate_limit_event` carries both windows, as fractions.
fn ping_claude() -> Result<Value, String> {
    let claude = claude_bin().ok_or("Couldn't find the claude command.")?;
    #[rustfmt::skip]
    let args = [
        "-p", "--model", "haiku", "--output-format", "stream-json", "--verbose",
        "--no-session-persistence", "--tools", "", "--strict-mcp-config", "--setting-sources", "",
        "--disable-slash-commands", "--system-prompt", "Reply ok.", "ok",
    ];
    let out = Command::new(claude)
        .args(args)
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Couldn't run claude: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let windows = stdout
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .find(|v| v["type"] == "rate_limit_event")
        .map(|v| v["rate_limit_info"]["unifiedWindows"].clone());
    let Some(windows) = windows else {
        let err = String::from_utf8_lossy(&out.stderr);
        let last = err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("no usage limits in the reply");
        return Err(format!("Couldn't read limits: {last}"));
    };
    let mut limits = json!({});
    for key in ["five_hour", "seven_day"] {
        let w = &windows[key];
        if let (Some(u), Some(r)) = (w["utilization"].as_f64(), w["resetsAt"].as_u64()) {
            limits[key] = json!({ "used_percentage": u * 100.0, "resets_at": r });
        }
    }
    Ok(limits)
}

/// Where `claude` is installed. The app's PATH isn't the user's, so check the
/// usual install spots, then ask an interactive shell (PATH is often set in
/// .zshrc, which a login shell alone doesn't read).
fn claude_bin() -> Option<PathBuf> {
    let known = [home().join(".local/bin/claude"), home().join(".claude/local/claude"), "/opt/homebrew/bin/claude".into(), "/usr/local/bin/claude".into()];
    if let Some(p) = known.into_iter().find(|p| p.is_file()) {
        return Some(p);
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let out = Command::new(shell).args(["-ilc", "command -v claude"]).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
    let path = String::from_utf8_lossy(&out.stdout).lines().last()?.trim().to_string();
    Path::new(&path).is_file().then(|| path.into())
}

// ---- Codex ----

fn codex_dir() -> PathBuf {
    std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".codex"))
}

/// The newest limits in Codex's rollouts (sessions/YYYY/MM/DD/rollout-*.jsonl),
/// which log them with every token count.
fn codex_limits() -> Option<Limits> {
    let mut files: Vec<(u64, PathBuf)> = latest_dirs(&codex_dir().join("sessions"), 2)
        .iter()
        .flat_map(|y| latest_dirs(y, 2))
        .flat_map(|m| latest_dirs(&m, 3))
        .flat_map(|d| std::fs::read_dir(d).into_iter().flatten().flatten().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e == "jsonl"))
        .filter_map(|p| Some((modified_ms(&p)?, p)))
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0));
    files.iter().take(8).find_map(|(modified, path)| {
        let (windows, at) = last_codex_windows(&tail(path, 512 * 1024)?)?;
        Some(Limits { windows, updated_at: at.unwrap_or(*modified) })
    })
}

fn latest_dirs(dir: &Path, n: usize) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    dirs.sort();
    dirs.into_iter().rev().take(n).collect()
}

fn tail(path: &Path, bytes: u64) -> Option<String> {
    let mut f = File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    f.seek(SeekFrom::Start(len.saturating_sub(bytes))).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// The last `rate_limits` in a rollout, and when it was logged (ms).
fn last_codex_windows(text: &str) -> Option<(Vec<Window>, Option<u64>)> {
    text.lines().rev().filter(|l| l.contains("\"rate_limits\"")).find_map(|l| {
        let v: Value = serde_json::from_str(l).ok()?;
        let at = v["timestamp"].as_str().and_then(iso_ms);
        let limits = &v["payload"]["rate_limits"];
        let windows: Vec<Window> = ["primary", "secondary"]
            .iter()
            .filter_map(|k| {
                let w = &limits[*k];
                // Newer versions log when it resets; older ones how long until.
                let resets_at = w["resets_at"]
                    .as_u64()
                    .or_else(|| Some(at? / 1000 + w["resets_in_seconds"].as_u64()?))?;
                Some(Window { minutes: w["window_minutes"].as_u64()?, used_percent: w["used_percent"].as_f64()?, resets_at })
            })
            .collect();
        (!windows.is_empty()).then_some((windows, at))
    })
}

/// "2026-10-15T09:41:12.345Z" in ms. UTC only, which is all Codex writes.
fn iso_ms(s: &str) -> Option<u64> {
    let n = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, m, d) = (n(0..4)?, n(5..7)?, n(8..10)?);
    let (hh, mm, ss) = (n(11..13)?, n(14..16)?, n(17..19)?);
    let frac = s.get(19..).filter(|f| f.starts_with('.')).map_or(0, |f| {
        let digits: String = f[1..].chars().take_while(|c| c.is_ascii_digit()).take(3).collect();
        format!("{digits:0<3}").parse::<i64>().unwrap_or(0)
    });
    // Days since the epoch, from Howard Hinnant's days_from_civil.
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let days = era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468;
    u64::try_from(((days * 24 + hh) * 60 + mm) * 60 + ss).ok().map(|secs| secs * 1000 + frac as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_timestamps() {
        assert_eq!(iso_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(iso_ms("2026-10-15T09:41:12.345Z"), Some(1792057272345));
    }

    #[test]
    fn claude_rate_limits() {
        let v: Value = serde_json::from_str(r#"{"five_hour":{"used_percentage":7,"resets_at":1792069800},"seven_day":{"used_percentage":34,"resets_at":1792440000}}"#).unwrap();
        assert_eq!(
            claude_windows(&v),
            vec![
                Window { minutes: 300, used_percent: 7.0, resets_at: 1792069800 },
                Window { minutes: 10080, used_percent: 34.0, resets_at: 1792440000 },
            ]
        );
    }

    #[test]
    fn codex_rate_limits() {
        let text = [
            r#"{"timestamp":"2026-10-15T09:00:00.000Z","type":"event_msg","payload":{"type":"token_count","info":null,"rate_limits":{"primary":{"used_percent":10.0,"window_minutes":300,"resets_at":1792070000},"secondary":null}}}"#,
            r#"{"timestamp":"2026-10-15T09:41:12.345Z","type":"event_msg","payload":{"type":"token_count","info":null,"rate_limits":{"primary":{"used_percent":12.5,"window_minutes":300,"resets_in_seconds":600},"secondary":{"used_percent":40.0,"window_minutes":10080,"resets_in_seconds":86400}}}}"#,
            r#"{"timestamp":"2026-10-15T09:41:13.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[]}}"#,
        ]
        .join("\n");
        let (windows, at) = last_codex_windows(&text).unwrap();
        assert_eq!(at, Some(1792057272345));
        assert_eq!(
            windows,
            vec![
                Window { minutes: 300, used_percent: 12.5, resets_at: 1792057272 + 600 },
                Window { minutes: 10080, used_percent: 40.0, resets_at: 1792057272 + 86400 },
            ]
        );
    }
}
