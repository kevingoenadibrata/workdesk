//! Coding agents (Claude Code, Codex, opencode) running in the terminals, for
//! the Monitor page. Agents are found by inspecting each PTY's foreground
//! process tree; what they're doing comes from the session files each one
//! writes to disk.

use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::pty::{self, PtyState};

#[derive(Clone, Copy, PartialEq)]
enum Harness {
    Claude,
    Codex,
    OpenCode,
}

impl Harness {
    fn id(self) -> &'static str {
        match self {
            Harness::Claude => "claude",
            Harness::Codex => "codex",
            Harness::OpenCode => "opencode",
        }
    }
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    harness: &'static str,
    /// "thinking", "working", "waiting", "idle", "error", or "unknown" when the
    /// session can't be read.
    status: &'static str,
    /// The last thing the user asked.
    prompt: Option<String>,
    /// The running tool, what the agent is waiting on, or the error.
    detail: Option<String>,
}

/// Session files read so far, so each poll only parses what was appended.
#[derive(Default)]
pub struct AgentState {
    tails: Arc<Mutex<HashMap<PathBuf, Tail>>>,
}

/// The agent running in each PTY, if any.
#[tauri::command]
pub async fn agent_status(
    ptys: State<'_, PtyState>,
    agents: State<'_, AgentState>,
    ids: Vec<u32>,
) -> Result<HashMap<u32, AgentInfo>, String> {
    let leaders = pty::foreground_pids(&ptys, &ids);
    let tails = agents.tails.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut tails = tails.lock().unwrap();
        let mut used = HashSet::new();
        let out = leaders
            .into_iter()
            .filter_map(|(id, leader)| {
                let (harness, pid) = find_agent(leader)?;
                let info = match harness {
                    Harness::Claude => claude_status(pid, &mut tails, &mut used),
                    Harness::Codex => codex_status(pid, &mut tails, &mut used),
                    Harness::OpenCode => opencode_status(pid),
                };
                Some((id, AgentInfo { harness: harness.id(), ..info }))
            })
            .collect();
        // Forget sessions no pane shows any more.
        tails.retain(|path, _| used.contains(path));
        out
    })
    .await
    .map_err(|e| e.to_string())
}

// ---- finding agents ----

/// The agent in a foreground process group: its leader, or a process a few
/// levels below it (for wrappers like `npx` or a node launcher).
fn find_agent(leader: libc::pid_t) -> Option<(Harness, libc::pid_t)> {
    let mut level = vec![leader];
    for _ in 0..4 {
        for &pid in &level {
            if let Some(h) = harness_of(pid) {
                return Some((h, pid));
            }
        }
        level = level.iter().flat_map(|&p| proc::children(p)).collect();
        if level.is_empty() {
            break;
        }
    }
    None
}

/// Which agent a process is, from its executable and first arguments. The
/// process name alone isn't enough: Claude Code's binary is named after its
/// version, and npm installs run under `node`.
fn harness_of(pid: libc::pid_t) -> Option<Harness> {
    let mut words: Vec<String> = proc::exe_path(pid).into_iter().collect();
    words.extend(proc::argv(pid).into_iter().take(3));
    words.iter().find_map(|w| {
        let base = w.rsplit('/').next().unwrap_or(w).to_ascii_lowercase();
        if base == "claude" || w.contains("/claude/versions/") || w.contains("@anthropic-ai/claude-code") {
            Some(Harness::Claude)
        } else if base == "codex" || base.starts_with("codex-") || w.contains("@openai/codex") {
            Some(Harness::Codex)
        } else if base == "opencode" || base == ".opencode" || w.contains("opencode-ai") {
            Some(Harness::OpenCode)
        } else {
            None
        }
    })
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn modified_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// First line of `text`, trimmed and cut to a card-sized length.
fn clip(text: &str) -> String {
    let line = text.trim().lines().next().unwrap_or("").trim();
    if line.chars().count() <= 240 {
        return line.to_string();
    }
    line.chars().take(240).collect::<String>() + "…"
}

/// Text a harness adds to the conversation itself (environment context,
/// command wrappers) rather than something the user typed.
fn is_injected(text: &str) -> bool {
    let t = text.trim_start();
    t.is_empty() || t.starts_with('<') || t.starts_with("# AGENTS.md") || t.starts_with("Caveat:")
}

/// "Bash: npm test", "Edit: main.ts", or just the tool's name.
fn tool_summary(name: &str, input: &Value) -> String {
    let arg = ["command", "cmd", "file_path", "path", "filePath", "pattern", "url", "description", "query"]
        .iter()
        .find_map(|k| match &input[*k] {
            Value::String(s) => Some(s.clone()),
            Value::Array(a) => Some(a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" ")),
            _ => None,
        });
    match arg {
        Some(arg) => {
            // Paths read better as their file name.
            let arg = if arg.starts_with('/') && !arg.contains(' ') { arg.rsplit('/').next().unwrap_or(&arg).to_string() } else { arg };
            clip(&format!("{name}: {arg}"))
        }
        None => name.to_string(),
    }
}

// ---- incremental JSONL reading ----

/// Where the last thing in a transcript left the conversation.
#[derive(Default, PartialEq)]
enum Last {
    #[default]
    Nothing,
    Prompt,
    Thinking,
    Text,
    ToolUse,
    ToolResult,
    Interrupted,
    Error(String),
}

#[derive(Default)]
struct Transcript {
    prompt: Option<String>,
    /// Tool calls without a result yet, by call id, with their summary.
    open_tools: Vec<(String, String)>,
    last: Last,
    /// Codex: inside a turn, per its turn markers.
    in_turn: Option<bool>,
}

impl Transcript {
    fn tool_started(&mut self, id: String, summary: String) {
        self.open_tools.push((id, summary));
        self.last = Last::ToolUse;
    }

    fn tool_finished(&mut self, id: &str) {
        self.open_tools.retain(|(i, _)| i != id);
        self.last = Last::ToolResult;
    }

    fn prompted(&mut self, text: &str) {
        self.prompt = Some(clip(text));
        self.open_tools.clear();
        self.last = Last::Prompt;
    }

    fn current_tool(&self) -> Option<String> {
        self.open_tools.last().map(|(_, s)| s.clone())
    }
}

struct Tail {
    offset: u64,
    partial: Vec<u8>,
    /// The first read starts mid-file, so its first line is cut off.
    mid_line: bool,
    transcript: Transcript,
}

/// Transcripts can run to many megabytes; the first read starts this far from the end.
const FIRST_READ_MAX: u64 = 4 * 1024 * 1024;

/// Feeds whatever was appended to `path` since the last poll through `parse`.
fn follow<'a>(
    tails: &'a mut HashMap<PathBuf, Tail>,
    used: &mut HashSet<PathBuf>,
    path: &Path,
    parse: fn(&mut Transcript, &Value),
) -> Option<&'a Transcript> {
    used.insert(path.to_path_buf());
    let mut file = File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(FIRST_READ_MAX);
    let tail = tails.entry(path.to_path_buf()).or_insert_with(|| Tail {
        offset: start,
        partial: Vec::new(),
        mid_line: start > 0,
        transcript: Transcript::default(),
    });
    // Rewritten from scratch: start over.
    if len < tail.offset {
        *tail = Tail { offset: 0, partial: Vec::new(), mid_line: false, transcript: Transcript::default() };
    }
    if len > tail.offset {
        let skip_first = std::mem::take(&mut tail.mid_line);
        file.seek(SeekFrom::Start(tail.offset)).ok()?;
        let mut buf = Vec::with_capacity((len - tail.offset) as usize);
        file.take(len - tail.offset).read_to_end(&mut buf).ok()?;
        tail.offset += buf.len() as u64;
        tail.partial.extend_from_slice(&buf);
        // Keep an unfinished last line for next time.
        let end = tail.partial.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1);
        let complete: Vec<u8> = tail.partial.drain(..end).collect();
        // A first read from the middle of the file starts mid-line.
        for line in complete.split(|&b| b == b'\n').skip(skip_first as usize) {
            if let Ok(v) = serde_json::from_slice::<Value>(line) {
                parse(&mut tail.transcript, &v);
            }
        }
    }
    Some(&tail.transcript)
}

// ---- Claude Code ----

fn claude_dir() -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|| home().join(".claude"))
}

/// Claude Code names a project's transcript folder after its path, with
/// every character but letters and digits replaced by `-`.
fn claude_project_dir(cwd: &str) -> PathBuf {
    let name: String = cwd.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    claude_dir().join("projects").join(name)
}

fn parse_claude(t: &mut Transcript, v: &Value) {
    match v["type"].as_str() {
        Some("last-prompt") => {
            if let Some(p) = v["lastPrompt"].as_str().filter(|p| !is_injected(p)) {
                t.prompt = Some(clip(p));
            }
        }
        Some("user") if v["isMeta"] != true => match &v["message"]["content"] {
            Value::String(s) => claude_user_text(t, s),
            Value::Array(blocks) => {
                for b in blocks {
                    match b["type"].as_str() {
                        Some("tool_result") => t.tool_finished(b["tool_use_id"].as_str().unwrap_or("")),
                        Some("text") => claude_user_text(t, b["text"].as_str().unwrap_or("")),
                        _ => {}
                    }
                }
            }
            _ => {}
        },
        Some("assistant") => {
            if v["isApiErrorMessage"] == true {
                let text = v["message"]["content"][0]["text"].as_str().unwrap_or("API error");
                t.open_tools.clear();
                t.last = Last::Error(clip(text));
                return;
            }
            for b in v["message"]["content"].as_array().into_iter().flatten() {
                match b["type"].as_str() {
                    Some("thinking") | Some("redacted_thinking") => t.last = Last::Thinking,
                    Some("text") => t.last = Last::Text,
                    Some("tool_use") => {
                        let name = b["name"].as_str().unwrap_or("tool");
                        t.tool_started(b["id"].as_str().unwrap_or("").to_string(), tool_summary(name, &b["input"]));
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
}

fn claude_user_text(t: &mut Transcript, text: &str) {
    if text.starts_with("[Request interrupted") {
        t.open_tools.clear();
        t.last = Last::Interrupted;
    } else if let Some(cmd) = text.strip_prefix("<command-name>") {
        // A slash command: show it as typed.
        let name = cmd.split('<').next().unwrap_or("");
        let args = text.split("<command-args>").nth(1).and_then(|a| a.split('<').next()).unwrap_or("");
        t.prompted(format!("{name} {args}").trim());
    } else if !is_injected(text) {
        t.prompted(text);
    }
}

fn claude_status(pid: libc::pid_t, tails: &mut HashMap<PathBuf, Tail>, used: &mut HashSet<PathBuf>) -> AgentInfo {
    // Claude Code keeps a status file per process naming its session.
    let meta: Value = std::fs::read(claude_dir().join("sessions").join(format!("{pid}.json")))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null);
    let cwd = meta["cwd"].as_str().map(String::from).or_else(|| pty::process_cwd(pid));
    let path = match (meta["sessionId"].as_str(), &cwd) {
        (Some(id), Some(cwd)) => Some(claude_project_dir(cwd).join(format!("{id}.jsonl"))),
        // Older versions don't write the status file: take the newest
        // transcript in the folder that's been written since it started.
        (None, Some(cwd)) => newest_file(&claude_project_dir(cwd), "jsonl", proc::start_ms(pid)),
        _ => None,
    };
    let Some(t) = path.as_deref().and_then(|p| follow(tails, used, p, parse_claude)) else {
        return AgentInfo { status: if meta.is_null() { "unknown" } else { "idle" }, ..Default::default() };
    };
    let fresh = path.as_deref().is_some_and(|p| now_ms().saturating_sub(modified_ms(p)) < 4000);
    let (status, detail) = match meta["status"].as_str() {
        Some("waiting") => ("waiting", meta["waitingFor"].as_str().map(clip).or(t.current_tool())),
        Some("busy") if !t.open_tools.is_empty() => ("working", t.current_tool()),
        // Tool calls reach the transcript only once they finish, but a
        // running Bash call shows up as a child shell.
        Some("busy") if let Some(cmd) = claude_running_bash(pid) => ("working", Some(clip(&format!("Bash: {cmd}")))),
        Some("busy") => ("thinking", None),
        Some(_) => match &t.last {
            Last::Error(e) => ("error", Some(e.clone())),
            _ => ("idle", None),
        },
        // No status file: judge by the transcript alone.
        None => match &t.last {
            Last::Error(e) => ("error", Some(e.clone())),
            Last::ToolUse if !t.open_tools.is_empty() => ("working", t.current_tool()),
            Last::Nothing | Last::Interrupted => ("idle", None),
            Last::Text if !fresh => ("idle", None),
            _ if fresh => ("thinking", None),
            _ => ("idle", None),
        },
    };
    AgentInfo { status, detail, prompt: t.prompt.clone(), ..Default::default() }
}

/// The command of a Bash tool call Claude Code is running, if any. Each runs
/// as `zsh -c "source …/shell-snapshots/… && eval '<command>' && pwd -P …"`.
fn claude_running_bash(pid: libc::pid_t) -> Option<String> {
    proc::children(pid).into_iter().find_map(|child| {
        let script = proc::argv(child).into_iter().find(|a| a.contains("/shell-snapshots/"))?;
        let body = &script[script.find("eval '")? + "eval '".len()..];
        let end = ["' < /dev/null", "' && pwd -P"].iter().filter_map(|m| body.rfind(m)).min().unwrap_or(body.len());
        Some(body[..end].replace("'\"'\"'", "'"))
    })
}

/// The most recently modified `*.ext` in `dir`, if it changed after `since_ms`.
fn newest_file(dir: &Path, ext: &str, since_ms: Option<u64>) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == ext))
        .map(|p| (modified_ms(&p), p))
        .filter(|(m, _)| since_ms.is_none_or(|s| *m + 2000 >= s))
        .max_by_key(|(m, _)| *m)
        .map(|(_, p)| p)
}

// ---- Codex ----

fn codex_dir() -> PathBuf {
    std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".codex"))
}

fn is_rollout(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or("");
    path.contains("/sessions/") && name.starts_with("rollout-") && name.ends_with(".jsonl")
}

/// The rollout file Codex is writing: it keeps it open for the whole session.
fn codex_rollout(pid: libc::pid_t) -> Option<PathBuf> {
    let mut level = vec![pid];
    for _ in 0..3 {
        for &p in &level {
            if let Some(path) = proc::open_files(p).into_iter().find(|f| is_rollout(f)) {
                return Some(PathBuf::from(path));
            }
        }
        level = level.iter().flat_map(|&p| proc::children(p)).collect();
    }
    codex_recent_rollout(pid)
}

/// The newest rollout for this folder written since Codex started, in case
/// the file isn't held open. Rollouts are filed under sessions/YYYY/MM/DD.
fn codex_recent_rollout(pid: libc::pid_t) -> Option<PathBuf> {
    let cwd = pty::process_cwd(pid)?;
    let since = proc::start_ms(pid);
    let latest = |dir: &Path, n: usize| -> Vec<PathBuf> {
        let mut dirs: Vec<PathBuf> = std::fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        dirs.sort();
        dirs.into_iter().rev().take(n).collect()
    };
    let days: Vec<PathBuf> = latest(&codex_dir().join("sessions"), 1)
        .iter()
        .flat_map(|y| latest(y, 2))
        .flat_map(|m| latest(&m, 2))
        .collect();
    let needle = format!("\"cwd\":{}", Value::String(cwd));
    days.iter()
        .flat_map(|d| std::fs::read_dir(d).into_iter().flatten().flatten().map(|e| e.path()))
        .filter(|p| p.to_str().is_some_and(is_rollout))
        .map(|p| (modified_ms(&p), p))
        .filter(|(m, _)| since.is_none_or(|s| *m + 2000 >= s))
        .filter(|(_, p)| {
            // The first line is the session's metadata, naming its folder.
            let mut head = vec![0u8; 16 * 1024];
            let n = File::open(p).and_then(|mut f| f.read(&mut head)).unwrap_or(0);
            String::from_utf8_lossy(&head[..n]).lines().next().is_some_and(|l| l.contains(&needle))
        })
        .max_by_key(|(m, _)| *m)
        .map(|(_, p)| p)
}

fn parse_codex(t: &mut Transcript, v: &Value) {
    let p = &v["payload"];
    match (v["type"].as_str(), p["type"].as_str()) {
        (Some("response_item"), Some("message")) => match p["role"].as_str() {
            Some("user") => {
                let text: Vec<&str> = p["content"].as_array().into_iter().flatten().filter_map(|c| c["text"].as_str()).collect();
                if let Some(text) = text.into_iter().find(|s| !is_injected(s)) {
                    t.prompted(text);
                }
            }
            Some("assistant") => t.last = Last::Text,
            _ => {}
        },
        (Some("response_item"), Some("reasoning")) => t.last = Last::Thinking,
        (Some("response_item"), Some("function_call" | "custom_tool_call" | "local_shell_call")) => {
            let name = p["name"].as_str().unwrap_or("shell");
            // Function arguments arrive as a JSON string.
            let input = match &p["arguments"] {
                Value::String(s) => serde_json::from_str(s).unwrap_or(Value::Null),
                _ => p["action"].clone(),
            };
            let summary = match &p["input"] {
                Value::String(s) if input.is_null() => clip(&format!("{name}: {s}")),
                _ => tool_summary(name, &input),
            };
            let id = p["call_id"].as_str().or(p["id"].as_str()).unwrap_or("").to_string();
            t.tool_started(id, summary);
        }
        (Some("response_item"), Some("function_call_output" | "custom_tool_call_output")) => {
            t.tool_finished(p["call_id"].as_str().unwrap_or(""))
        }
        (Some("event_msg"), Some("task_started" | "turn_started")) => t.in_turn = Some(true),
        (Some("event_msg"), Some("task_complete" | "turn_complete" | "turn_aborted")) => {
            t.in_turn = Some(false);
            t.open_tools.clear();
        }
        (Some("event_msg"), Some("user_message")) => {
            if let Some(m) = p["message"].as_str().filter(|m| !is_injected(m)) {
                t.prompt = Some(clip(m));
            }
        }
        _ => {}
    }
}

fn codex_status(pid: libc::pid_t, tails: &mut HashMap<PathBuf, Tail>, used: &mut HashSet<PathBuf>) -> AgentInfo {
    let Some(path) = codex_rollout(pid) else {
        // No session until the first message is sent.
        return AgentInfo { status: "idle", ..Default::default() };
    };
    let Some(t) = follow(tails, used, &path, parse_codex) else {
        return AgentInfo { status: "unknown", ..Default::default() };
    };
    let fresh = now_ms().saturating_sub(modified_ms(&path)) < 4000;
    let busy = t.in_turn.unwrap_or(fresh && t.last != Last::Text);
    let (status, detail) = match () {
        _ if !t.open_tools.is_empty() && busy => ("working", t.current_tool()),
        _ if busy => ("thinking", None),
        _ => ("idle", None),
    };
    AgentInfo { status, detail, prompt: t.prompt.clone(), ..Default::default() }
}

// ---- opencode ----

/// opencode keeps every session in one SQLite database.
fn opencode_db() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("OPENCODE_DB") {
        return Some(PathBuf::from(p));
    }
    let data = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".local/share"));
    let dir = data.join("opencode");
    let main = dir.join("opencode.db");
    if main.exists() {
        return Some(main);
    }
    // Other release channels use opencode-<channel>.db.
    std::fs::read_dir(&dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            name.starts_with("opencode") && name.ends_with(".db")
        })
        .max_by_key(|p| modified_ms(p))
}

/// Runs a read-only query with the system sqlite3, returning rows as JSON objects.
fn sqlite(db: &Path, sql: &str) -> Option<Vec<Value>> {
    let out = Command::new("/usr/bin/sqlite3")
        .args(["-readonly", "-json", "-cmd", ".timeout 200"])
        .arg(db)
        .arg(sql)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    if out.stdout.iter().all(u8::is_ascii_whitespace) {
        return Some(Vec::new());
    }
    serde_json::from_slice::<Vec<Value>>(&out.stdout).ok()
}

fn sql_str(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

fn json_col(row: &Value, col: &str) -> Value {
    row[col].as_str().and_then(|s| serde_json::from_str(s).ok()).unwrap_or(Value::Null)
}

fn opencode_error(e: &Value) -> String {
    let msg = e["data"]["message"].as_str().or(e["message"].as_str()).or(e["name"].as_str()).unwrap_or("Error");
    clip(msg)
}

fn opencode_status(pid: libc::pid_t) -> AgentInfo {
    let unknown = AgentInfo { status: "unknown", ..Default::default() };
    let (Some(db), Some(cwd)) = (opencode_db(), pty::process_cwd(pid)) else { return unknown };
    // A session in this folder touched since this opencode started; an
    // older one belongs to an earlier run.
    let since = proc::start_ms(pid).unwrap_or(0).saturating_sub(2000);
    let Some(tables) = sqlite(&db, "SELECT name FROM sqlite_master WHERE type='table'") else { return unknown };
    let has = |t: &str| tables.iter().any(|r| r["name"] == t);
    if has("session_v2") && has("session_message") {
        opencode_v2(&db, &cwd, since)
    } else if has("session") && has("message") && has("part") {
        opencode_v1(&db, &cwd, since)
    } else {
        unknown
    }
}

/// The session_v2 schema: each message is one row with its content inline.
fn opencode_v2(db: &Path, cwd: &str, since: u64) -> AgentInfo {
    let sql = format!(
        "SELECT type, data FROM session_message WHERE session_id = (SELECT id FROM session_v2 \
         WHERE directory = {} AND parent_id IS NULL AND time_updated >= {since} ORDER BY time_updated DESC LIMIT 1) \
         ORDER BY seq DESC LIMIT 40",
        sql_str(cwd)
    );
    let Some(rows) = sqlite(db, &sql) else { return AgentInfo { status: "unknown", ..Default::default() } };
    let prompt = rows
        .iter()
        .find(|r| r["type"] == "user")
        .and_then(|r| json_col(r, "data")["text"].as_str().map(clip));
    let mut status = ("idle", None);
    for row in &rows {
        let data = json_col(row, "data");
        status = match row["type"].as_str().unwrap_or("") {
            "idle" if data["outcome"] == "failed" => ("error", Some(opencode_error(&data["error"]))),
            "idle" => ("idle", None),
            "user" | "synthetic" => ("thinking", None),
            "shell" if data["status"] == "running" => ("working", data["command"].as_str().map(clip)),
            "assistant" if !data["error"].is_null() => ("error", Some(opencode_error(&data["error"]))),
            "assistant" => {
                let last = data["content"].as_array().and_then(|c| c.last()).cloned().unwrap_or(Value::Null);
                let tool_running = last["type"] == "tool" && matches!(last["state"]["status"].as_str(), Some("running" | "streaming"));
                if tool_running {
                    ("working", Some(tool_summary(last["name"].as_str().unwrap_or("tool"), &last["state"]["input"])))
                } else if data["time"]["completed"].is_null() || last["type"] == "tool" {
                    ("thinking", None)
                } else {
                    ("idle", None)
                }
            }
            // Agent or model switches and the like say nothing about progress.
            _ => continue,
        };
        break;
    }
    AgentInfo { status: status.0, detail: status.1, prompt, ..Default::default() }
}

/// The session/message/part schema of released versions: message metadata
/// and its parts are separate rows.
fn opencode_v1(db: &Path, cwd: &str, since: u64) -> AgentInfo {
    let sql = format!(
        "SELECT id, data FROM message WHERE session_id = (SELECT id FROM session WHERE directory = {} \
         AND parent_id IS NULL AND time_updated >= {since} ORDER BY time_updated DESC LIMIT 1) \
         ORDER BY time_created DESC LIMIT 20",
        sql_str(cwd)
    );
    let Some(messages) = sqlite(db, &sql) else { return AgentInfo { status: "unknown", ..Default::default() } };
    let messages: Vec<(String, Value)> =
        messages.iter().map(|r| (r["id"].as_str().unwrap_or("").to_string(), json_col(r, "data"))).collect();
    let user = messages.iter().find(|(_, d)| d["role"] == "user");
    let Some((last_id, last)) = messages.first() else { return AgentInfo { status: "idle", ..Default::default() } };
    let ids: Vec<String> = [Some(last_id), user.map(|(id, _)| id)].into_iter().flatten().map(|id| sql_str(id)).collect();
    let parts = sqlite(
        db,
        &format!("SELECT message_id, data FROM part WHERE message_id IN ({}) ORDER BY id", ids.join(",")),
    )
    .unwrap_or_default();
    let parts_of = |id: &str| -> Vec<Value> {
        parts.iter().filter(|p| p["message_id"] == id).map(|p| json_col(p, "data")).collect()
    };
    let prompt = user.and_then(|(id, _)| {
        parts_of(id).iter().find(|p| p["type"] == "text" && p["synthetic"] != true).and_then(|p| p["text"].as_str().map(clip))
    });
    let (status, detail) = if last["role"] == "user" {
        ("thinking", None)
    } else if !last["error"].is_null() && last["error"]["name"] != "MessageAbortedError" {
        ("error", Some(opencode_error(&last["error"])))
    } else {
        let last_part = parts_of(last_id).into_iter().filter(|p| p["type"] != "step-finish").last().unwrap_or(Value::Null);
        let tool_running = last_part["type"] == "tool" && matches!(last_part["state"]["status"].as_str(), Some("pending" | "running"));
        if tool_running {
            ("working", Some(tool_summary(last_part["tool"].as_str().unwrap_or("tool"), &last_part["state"]["input"])))
        } else if last["time"]["completed"].is_null() || last["finish"] == "tool-calls" {
            ("thinking", None)
        } else {
            ("idle", None)
        }
    };
    AgentInfo { status, detail, prompt, ..Default::default() }
}

// ---- process inspection ----

#[cfg(target_os = "macos")]
pub(crate) mod proc {
    use std::ffi::CStr;

    pub fn exe_path(pid: libc::pid_t) -> Option<String> {
        let mut buf = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
        let len = unsafe { libc::proc_pidpath(pid, buf.as_mut_ptr().cast(), buf.len() as u32) };
        (len > 0).then(|| String::from_utf8_lossy(&buf[..len as usize]).into_owned())
    }

    /// The process's arguments, argv[0] first.
    pub fn argv(pid: libc::pid_t) -> Vec<String> {
        let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid];
        let mut size: libc::size_t = 0;
        let ok = unsafe { libc::sysctl(mib.as_mut_ptr(), 3, std::ptr::null_mut(), &mut size, std::ptr::null_mut(), 0) };
        if ok != 0 || size < 4 {
            return Vec::new();
        }
        let mut buf = vec![0u8; size];
        let ok = unsafe { libc::sysctl(mib.as_mut_ptr(), 3, buf.as_mut_ptr().cast(), &mut size, std::ptr::null_mut(), 0) };
        if ok != 0 || size < 4 {
            return Vec::new();
        }
        buf.truncate(size);
        // argc, then the executable path, NUL padding, then argv.
        let argc = i32::from_ne_bytes([buf[0], buf[1], buf[2], buf[3]]).max(0) as usize;
        let rest = &buf[4..];
        let start = rest.iter().position(|&b| b == 0).unwrap_or(rest.len());
        let start = start + rest[start..].iter().position(|&b| b != 0).unwrap_or(0);
        rest[start..]
            .split(|&b| b == 0)
            .take(argc)
            .map(|s| String::from_utf8_lossy(s).into_owned())
            .collect()
    }

    pub fn children(pid: libc::pid_t) -> Vec<libc::pid_t> {
        let mut buf = vec![0 as libc::pid_t; 256];
        let size = (buf.len() * std::mem::size_of::<libc::pid_t>()) as libc::c_int;
        let n = unsafe { libc::proc_listchildpids(pid, buf.as_mut_ptr().cast(), size) };
        buf.truncate(n.max(0) as usize);
        buf
    }

    /// When the process started, in ms since the epoch.
    pub fn start_ms(pid: libc::pid_t) -> Option<u64> {
        let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
        let len = unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 0, (&raw mut info).cast(), size) };
        (len == size).then(|| info.pbi_start_tvsec * 1000 + info.pbi_start_tvusec / 1000)
    }

    #[repr(C)]
    struct ProcFileInfo {
        fi_openflags: u32,
        fi_status: u32,
        fi_offset: i64,
        fi_type: i32,
        fi_guardflags: u32,
    }

    /// `struct vnode_fdinfowithpath`, which libc doesn't declare.
    #[repr(C)]
    struct VnodeFdInfoWithPath {
        pfi: ProcFileInfo,
        pvip: libc::vnode_info_path,
    }

    const PROC_PIDFDVNODEPATHINFO: libc::c_int = 2;

    /// Paths of the files the process has open.
    pub fn open_files(pid: libc::pid_t) -> Vec<String> {
        let fd_size = std::mem::size_of::<libc::proc_fdinfo>();
        let mut fds: Vec<libc::proc_fdinfo> = vec![unsafe { std::mem::zeroed() }; 512];
        let bytes = unsafe {
            libc::proc_pidinfo(pid, libc::PROC_PIDLISTFDS, 0, fds.as_mut_ptr().cast(), (fds.len() * fd_size) as libc::c_int)
        };
        if bytes <= 0 {
            return Vec::new();
        }
        fds.truncate(bytes as usize / fd_size);
        fds.iter()
            .filter(|fd| fd.proc_fdtype == libc::PROX_FDTYPE_VNODE as u32)
            .filter_map(|fd| {
                let mut info: VnodeFdInfoWithPath = unsafe { std::mem::zeroed() };
                let size = std::mem::size_of::<VnodeFdInfoWithPath>() as libc::c_int;
                let len = unsafe { libc::proc_pidfdinfo(pid, fd.proc_fd, PROC_PIDFDVNODEPATHINFO, (&raw mut info).cast(), size) };
                if len != size {
                    return None;
                }
                let path = unsafe { CStr::from_ptr(info.pvip.vip_path.as_ptr().cast()) };
                Some(path.to_string_lossy().into_owned())
            })
            .collect()
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) mod proc {
    pub fn exe_path(pid: libc::pid_t) -> Option<String> {
        std::fs::read_link(format!("/proc/{pid}/exe")).ok().map(|p| p.to_string_lossy().into_owned())
    }

    pub fn argv(pid: libc::pid_t) -> Vec<String> {
        std::fs::read(format!("/proc/{pid}/cmdline"))
            .map(|b| b.split(|&c| c == 0).filter(|s| !s.is_empty()).map(|s| String::from_utf8_lossy(s).into_owned()).collect())
            .unwrap_or_default()
    }

    pub fn children(pid: libc::pid_t) -> Vec<libc::pid_t> {
        std::fs::read_to_string(format!("/proc/{pid}/task/{pid}/children"))
            .map(|s| s.split_whitespace().filter_map(|p| p.parse().ok()).collect())
            .unwrap_or_default()
    }

    pub fn start_ms(pid: libc::pid_t) -> Option<u64> {
        let meta = std::fs::metadata(format!("/proc/{pid}")).ok()?;
        let t = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?;
        Some(t.as_millis() as u64)
    }

    pub fn open_files(pid: libc::pid_t) -> Vec<String> {
        std::fs::read_dir(format!("/proc/{pid}/fd"))
            .map(|d| d.flatten().filter_map(|e| std::fs::read_link(e.path()).ok()).map(|p| p.to_string_lossy().into_owned()).collect())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(parse: fn(&mut Transcript, &Value), lines: &[&str]) -> Transcript {
        let mut t = Transcript::default();
        for l in lines {
            parse(&mut t, &serde_json::from_str(l).unwrap());
        }
        t
    }

    #[test]
    fn claude_transcript() {
        let t = feed(parse_claude, &[
            r#"{"type":"user","message":{"role":"user","content":"<command-name>/review</command-name><command-args>42</command-args>"}}"#,
            r#"{"type":"user","message":{"role":"user","content":"fix the build"}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Edit","input":{"file_path":"/a/b/main.ts"}}]}}"#,
        ]);
        assert_eq!(t.prompt.as_deref(), Some("fix the build"));
        assert_eq!(t.current_tool().as_deref(), Some("Edit: main.ts"));
        let t = feed(parse_claude, &[
            r#"{"type":"user","message":{"role":"user","content":"<command-name>/review</command-name><command-args>42</command-args>"}}"#,
            r#"{"type":"assistant","isApiErrorMessage":true,"message":{"content":[{"type":"text","text":"API Error: 529 overloaded"}]}}"#,
        ]);
        assert_eq!(t.prompt.as_deref(), Some("/review 42"));
        assert!(t.last == Last::Error("API Error: 529 overloaded".into()));
    }

    #[test]
    fn codex_rollout() {
        let start = [
            r#"{"timestamp":"t","type":"session_meta","payload":{"id":"x","cwd":"/p"}}"#,
            r#"{"timestamp":"t","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>…</environment_context>"}]}}"#,
            r#"{"timestamp":"t","type":"event_msg","payload":{"type":"task_started"}}"#,
            r#"{"timestamp":"t","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"add tests"}]}}"#,
            r#"{"timestamp":"t","type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"{\"command\":[\"cargo\",\"test\"]}","call_id":"c1"}}"#,
        ];
        let t = feed(parse_codex, &start);
        assert_eq!(t.prompt.as_deref(), Some("add tests"));
        assert_eq!(t.in_turn, Some(true));
        assert_eq!(t.current_tool().as_deref(), Some("shell: cargo test"));
        let mut lines = start.to_vec();
        lines.extend([
            r#"{"timestamp":"t","type":"response_item","payload":{"type":"function_call_output","call_id":"c1","output":"ok"}}"#,
            r#"{"timestamp":"t","type":"event_msg","payload":{"type":"task_complete"}}"#,
        ]);
        let t = feed(parse_codex, &lines);
        assert!(t.open_tools.is_empty());
        assert_eq!(t.in_turn, Some(false));
    }

    fn sqlite_fixture(name: &str, sql: &str) -> PathBuf {
        let db = std::env::temp_dir().join(format!("workdesk-test-{name}-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&db);
        let ok = Command::new("/usr/bin/sqlite3").arg(&db).arg(sql).status().unwrap().success();
        assert!(ok);
        db
    }

    #[test]
    fn opencode_session_v2() {
        let db = sqlite_fixture("v2", r#"
            CREATE TABLE session_v2 (id TEXT, directory TEXT, parent_id TEXT, time_updated INTEGER);
            CREATE TABLE session_message (session_id TEXT, type TEXT, seq INTEGER, data TEXT);
            INSERT INTO session_v2 VALUES ('s1', '/p', NULL, 5000);
            INSERT INTO session_message VALUES ('s1', 'user', 1, '{"text":"rename foo"}');
            INSERT INTO session_message VALUES ('s1', 'assistant', 2, '{"content":[{"type":"tool","name":"bash","state":{"status":"running","input":{"command":"ls"}}}],"time":{"created":1}}');
            INSERT INTO session_message VALUES ('s1', 'model-switched', 3, '{}');
        "#);
        let info = opencode_v2(&db, "/p", 1000);
        assert_eq!((info.status, info.prompt.as_deref(), info.detail.as_deref()), ("working", Some("rename foo"), Some("bash: ls")));
        assert_eq!(opencode_v2(&db, "/p", 9000).status, "idle", "sessions from before the process started are ignored");
        let _ = std::fs::remove_file(db);
    }

    #[test]
    fn opencode_session_v1() {
        let db = sqlite_fixture("v1", r#"
            CREATE TABLE session (id TEXT, directory TEXT, parent_id TEXT, time_updated INTEGER);
            CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
            CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
            INSERT INTO session VALUES ('s1', '/p', NULL, 5000);
            INSERT INTO message VALUES ('m1', 's1', 1, '{"role":"user","time":{"created":1}}');
            INSERT INTO part VALUES ('p1', 'm1', 's1', 1, '{"type":"text","text":"why is CI red"}');
            INSERT INTO message VALUES ('m2', 's1', 2, '{"role":"assistant","time":{"created":2},"error":{"name":"APIError","data":{"message":"rate limited"}}}');
        "#);
        let info = opencode_v1(&db, "/p", 1000);
        assert_eq!((info.status, info.prompt.as_deref(), info.detail.as_deref()), ("error", Some("why is CI red"), Some("rate limited")));
        let _ = std::fs::remove_file(db);
    }
}
