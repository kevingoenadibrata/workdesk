use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex,
    },
    thread,
};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    State,
};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    /// The shell's pid; any other foreground process group means a command is running.
    shell_pid: Option<u32>,
}

#[derive(Default)]
pub struct PtyState {
    next_id: AtomicU32,
    sessions: Mutex<HashMap<u32, Session>>,
}

/// Variables a running Claude Code session sets for its own child processes.
const AGENT_SESSION_VARS: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_PID",
    "CLAUDE_EFFORT",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "AI_AGENT",
];

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }
}

/// Spawns the user's login shell in a new PTY. Output is streamed as raw bytes
/// over `on_data`; the exit code is sent over `on_exit` once the shell is gone.
#[tauri::command]
pub fn pty_spawn(
    state: State<'_, PtyState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    on_data: Channel<InvokeResponseBody>,
    on_exit: Channel<i32>,
) -> Result<u32, String> {
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(err)?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");
    // A recent directory may have been deleted since; fall back to home.
    let cwd = cwd.filter(|d| std::path::Path::new(d).is_dir());
    if let Some(dir) = cwd.or_else(|| std::env::var("HOME").ok()) {
        cmd.cwd(dir);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "workdesk");
    // Launched from inside a coding agent, we'd hand its session markers to
    // every shell, and an agent started there would think it's a subagent
    // (Claude Code then stops saving its transcript).
    for var in AGENT_SESSION_VARS {
        cmd.env_remove(var);
    }
    // Apps launched from Finder get a bare environment without a locale.
    if std::env::var("LANG").is_err() {
        cmd.env("LANG", "en_US.UTF-8");
    }

    let mut child = pair.slave.spawn_command(cmd).map_err(err)?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(err)?;
    let writer = pair.master.take_writer().map_err(err)?;
    let killer = child.clone_killer();
    let shell_pid = child.process_id();

    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    state
        .sessions
        .lock()
        .unwrap()
        .insert(id, Session { master: pair.master, writer, killer, shell_pid });

    thread::spawn(move || {
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if on_data.send(InvokeResponseBody::Raw(buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
            }
        }
        let code = child.wait().map(|s| s.exit_code() as i32).unwrap_or(-1);
        let _ = on_exit.send(code);
    });

    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: u32, data: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    let session = sessions.get_mut(&id).ok_or("no such pty")?;
    session.writer.write_all(data.as_bytes()).map_err(err)
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions.get(&id).ok_or("no such pty")?;
    session.master.resize(size(cols, rows)).map_err(err)
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>, id: u32) {
    if let Some(mut session) = state.sessions.lock().unwrap().remove(&id) {
        let _ = session.killer.kill();
    }
}

/// Name of the foreground process in each PTY (e.g. "zsh", "vim", "node"),
/// used as the default tab title.
#[tauri::command]
pub fn pty_process_names(state: State<'_, PtyState>, ids: Vec<u32>) -> HashMap<u32, String> {
    let sessions = state.sessions.lock().unwrap();
    ids.into_iter()
        .filter_map(|id| {
            let pid = sessions.get(&id)?.master.process_group_leader()?;
            Some((id, process_name(pid)?))
        })
        .collect()
}

/// PTYs running a command in the foreground (anything but the shell at its
/// prompt), with that command's name. Used to confirm before closing them.
#[tauri::command]
pub fn pty_busy(state: State<'_, PtyState>, ids: Vec<u32>) -> HashMap<u32, String> {
    let sessions = state.sessions.lock().unwrap();
    ids.into_iter()
        .filter_map(|id| {
            let session = sessions.get(&id)?;
            let pid = session.master.process_group_leader()?;
            if session.shell_pid.is_none_or(|shell| shell as libc::pid_t == pid) {
                return None;
            }
            Some((id, process_name(pid).unwrap_or_else(|| "a process".into())))
        })
        .collect()
}

/// The foreground process group leader of each PTY.
pub fn foreground_pids(state: &PtyState, ids: &[u32]) -> Vec<(u32, libc::pid_t)> {
    let sessions = state.sessions.lock().unwrap();
    ids.iter()
        .filter_map(|&id| Some((id, sessions.get(&id)?.master.process_group_leader()?)))
        .collect()
}

/// The shell each PTY started with; servers it runs in the background are below it.
pub fn shell_pids(state: &PtyState, ids: &[u32]) -> Vec<(u32, libc::pid_t)> {
    let sessions = state.sessions.lock().unwrap();
    ids.iter()
        .filter_map(|&id| Some((id, sessions.get(&id)?.shell_pid? as libc::pid_t)))
        .collect()
}

/// Working directory of the foreground process in each PTY, used to keep the
/// list of recent directories up to date.
#[tauri::command]
pub fn pty_cwds(state: State<'_, PtyState>, ids: Vec<u32>) -> HashMap<u32, String> {
    let sessions = state.sessions.lock().unwrap();
    ids.into_iter()
        .filter_map(|id| {
            let pid = sessions.get(&id)?.master.process_group_leader()?;
            Some((id, process_cwd(pid)?))
        })
        .collect()
}

#[cfg(target_os = "macos")]
pub fn process_cwd(pid: libc::pid_t) -> Option<String> {
    let mut info: libc::proc_vnodepathinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_vnodepathinfo>() as libc::c_int;
    let len = unsafe {
        libc::proc_pidinfo(pid, libc::PROC_PIDVNODEPATHINFO, 0, (&raw mut info).cast(), size)
    };
    if len != size {
        return None;
    }
    let path = unsafe { std::ffi::CStr::from_ptr(info.pvi_cdir.vip_path.as_ptr().cast()) };
    Some(path.to_string_lossy().into_owned()).filter(|p| !p.is_empty())
}

#[cfg(not(target_os = "macos"))]
pub fn process_cwd(pid: libc::pid_t) -> Option<String> {
    std::fs::read_link(format!("/proc/{pid}/cwd"))
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

#[cfg(target_os = "macos")]
fn process_name(pid: libc::pid_t) -> Option<String> {
    let mut buf = [0u8; 256];
    let len = unsafe { libc::proc_name(pid, buf.as_mut_ptr().cast(), buf.len() as u32) };
    (len > 0).then(|| String::from_utf8_lossy(&buf[..len as usize]).into_owned())
}

#[cfg(not(target_os = "macos"))]
fn process_name(pid: libc::pid_t) -> Option<String> {
    std::fs::read_to_string(format!("/proc/{pid}/comm"))
        .ok()
        .map(|s| s.trim().to_string())
}
