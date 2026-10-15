//! Local web servers, for the Local Servers page: every port on this machine
//! that answers HTTP, what's serving it, and which pane started it, if any.

use std::{
    collections::{HashMap, HashSet},
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    process::Command,
    sync::Mutex,
    time::Duration,
};

use serde::Serialize;
use tauri::State;

use crate::agents::proc;
use crate::pty::{self, PtyState};

/// A process serving HTTP on a local port.
#[derive(Serialize)]
pub struct Listener {
    port: u16,
    pid: i32,
    /// What it is, e.g. "vite" or "rails" rather than just "node" or "ruby".
    name: String,
    /// The PTY whose shell started it, or None for servers started elsewhere.
    pty: Option<u32>,
}

/// Whether each (pid, port) answered HTTP, so each one is only asked once.
#[derive(Default)]
pub struct ServerState {
    http: Mutex<HashMap<(libc::pid_t, u16), bool>>,
}

/// Every local port that answers HTTP, and which of the PTYs `ids` started it.
/// Apps' own helpers (Raycast, Ollama, Creative Cloud…) are left out unless a
/// pane started one or printed its port, one of `ports`.
#[tauri::command]
pub async fn local_servers(
    ptys: State<'_, PtyState>,
    state: State<'_, ServerState>,
    ids: Vec<u32>,
    ports: Vec<u16>,
) -> Result<Vec<Listener>, String> {
    let shells = pty::shell_pids(&ptys, &ids);
    let found: Vec<_> = listening().into_iter().filter(|l| !is_system(l.pid)).collect();

    // Ask the ones not asked yet, all at once.
    let unknown: Vec<_> = {
        let known = state.http.lock().unwrap();
        found.iter().filter(|l| !known.contains_key(&(l.pid, l.port))).map(|l| (l.pid, l.port, l.addr)).collect()
    };
    let answers = tauri::async_runtime::spawn_blocking(move || {
        let probes: Vec<_> = unknown.into_iter().map(|(pid, port, addr)| std::thread::spawn(move || ((pid, port), speaks_http(addr)))).collect();
        probes.into_iter().filter_map(|p| p.join().ok()).collect::<Vec<_>>()
    })
    .await
    .map_err(|e| e.to_string())?;

    let http = {
        let mut known = state.http.lock().unwrap();
        known.extend(answers);
        // Forget servers that are gone, so a pid reused later is asked again.
        let live: HashSet<_> = found.iter().map(|l| (l.pid, l.port)).collect();
        known.retain(|k, _| live.contains(k));
        known.clone()
    };

    let mut owner = HashMap::new();
    for (id, shell) in shells {
        for pid in descendants(shell) {
            owner.entry(pid).or_insert(id);
        }
    }
    let printed: HashSet<u16> = ports.into_iter().collect();
    Ok(found
        .into_iter()
        .filter(|l| http.get(&(l.pid, l.port)) == Some(&true))
        .filter(|l| owner.contains_key(&l.pid) || printed.contains(&l.port) || !is_app(l.pid))
        .map(|l| Listener { port: l.port, pid: l.pid, name: label(l.pid, l.command), pty: owner.get(&l.pid).copied() })
        .collect())
}

struct Found {
    pid: libc::pid_t,
    command: String,
    port: u16,
    /// An address it accepts connections on.
    addr: SocketAddr,
}

/// Every TCP port the user's processes listen on, once each even when a
/// server listens on both IPv4 and IPv6.
fn listening() -> Vec<Found> {
    let Ok(out) = Command::new("/usr/sbin/lsof").args(["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"]).output() else {
        return Vec::new();
    };
    let mut seen = HashSet::new();
    let mut found = Vec::new();
    let (mut pid, mut command) = (0, String::new());
    // One field per line, tagged by its first character: p(id), c(ommand), f(d), n(ame).
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let (tag, value) = line.split_at(line.len().min(1));
        match tag {
            "p" => pid = value.parse().unwrap_or(0),
            "c" => command = value.to_string(),
            "n" => {
                let Some((host, port)) = value.rsplit_once(':') else { continue };
                let Ok(port) = port.parse::<u16>() else { continue };
                let addr = match host {
                    "[::1]" | "[::]" => SocketAddr::from(([0u16, 0, 0, 0, 0, 0, 0, 1], port)),
                    _ => SocketAddr::from(([127, 0, 0, 1], port)),
                };
                // Bound to another interface only: not a local server.
                if !matches!(host, "*" | "127.0.0.1" | "[::1]" | "[::]" | "0.0.0.0") {
                    continue;
                }
                if seen.insert((pid, port)) {
                    found.push(Found { pid, command: command.clone(), port, addr });
                }
            }
            _ => {}
        }
    }
    found
}

/// macOS's own services (AirPlay, sharing, and so on) listen too; they aren't anyone's dev server.
fn is_system(pid: libc::pid_t) -> bool {
    let Some(exe) = proc::exe_path(pid) else { return true };
    ["/System/", "/usr/libexec/", "/usr/sbin/", "/sbin/"].iter().any(|p| exe.starts_with(p))
}

/// Part of an installed app rather than something run from a terminal: inside
/// an app bundle (Xcode's tools are, but those are dev tools), or a runtime an
/// app keeps in Application Support (Raycast runs its own node from there).
fn is_app(pid: libc::pid_t) -> bool {
    proc::exe_path(pid).is_some_and(|exe| {
        let bundled = (exe.starts_with("/Applications/") || exe.starts_with("/Library/")) && exe.contains(".app/");
        (bundled && !exe.contains("/Developer/")) || exe.contains("/Library/Application Support/")
    })
}

/// Whether whatever's on `addr` answers an HTTP request.
fn speaks_http(addr: SocketAddr) -> bool {
    let timeout = Duration::from_millis(600);
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, timeout) else { return false };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    if stream.write_all(b"HEAD / HTTP/1.0\r\nHost: localhost\r\n\r\n").is_err() {
        return false;
    }
    let mut head = [0u8; 5];
    stream.read_exact(&mut head).is_ok() && &head == b"HTTP/"
}

/// `pid` and every process below it.
fn descendants(pid: libc::pid_t) -> Vec<libc::pid_t> {
    let mut all = vec![pid];
    let mut i = 0;
    while i < all.len() && all.len() < 4096 {
        all.extend(proc::children(all[i]));
        i += 1;
    }
    all
}

/// Runtimes whose name says less than the script they run.
const RUNTIMES: &[&str] = &["node", "bun", "deno", "python", "python3", "ruby", "php", "java"];

/// A name for the server: the command, or for a runtime, the script it runs
/// (`node …/.bin/vite` → "vite").
fn label(pid: libc::pid_t, command: String) -> String {
    if !RUNTIMES.contains(&command.as_str()) {
        return command;
    }
    let script = proc::argv(pid).into_iter().skip(1).find(|a| !a.starts_with('-'));
    script
        .as_deref()
        .and_then(|s| s.rsplit('/').next())
        .map(|s| s.split('.').next().unwrap_or(s))
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or(command)
}
