//! The Tailscale CLI, as the phone mirror (src/phone.rs) uses it: who this Mac
//! is signed in as, which of that person's phones are online, and turning
//! `tailscale serve` on and off for the mirror's port. Workdesk never signs in,
//! starts Tailscale or touches anything it didn't add.

use std::{
    io::Read,
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use serde_json::Value;

/// Where the CLI lives: inside the Mac app (standalone or App Store), or a Homebrew / manual install.
const CANDIDATES: &[&str] = &[
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    "/opt/homebrew/bin/tailscale",
    "/usr/local/bin/tailscale",
];

pub fn cli() -> Option<&'static str> {
    CANDIDATES.iter().copied().find(|p| Path::new(p).exists())
}

/// Runs the CLI, giving up after 15 seconds; returns stdout, or its message on failure.
fn run(args: &[&str]) -> Result<String, String> {
    let cli = cli().ok_or("Tailscale isn't installed.")?;
    let mut child = Command::new(cli)
        .args(args)
        // The binary inside Tailscale.app decides whether it's the CLI or the GUI from how it was
        // launched. Spawned from an app (no terminal), it guesses GUI, prints nothing to stdout
        // and exits 0. This forces CLI mode; the other installs ignore it.
        .env("TAILSCALE_BE_CLI", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Couldn't run Tailscale: {e}"))?;
    // Read both pipes on their own threads so a chatty command can't fill one and stall.
    let mut out = child.stdout.take().unwrap();
    let mut err = child.stderr.take().unwrap();
    let out = thread::spawn(move || {
        let mut s = String::new();
        let _ = out.read_to_string(&mut s);
        s
    });
    let err = thread::spawn(move || {
        let mut s = String::new();
        let _ = err.read_to_string(&mut s);
        s
    });
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if start.elapsed() > Duration::from_secs(15) {
            let _ = child.kill();
            return Err("Tailscale didn't answer.".into());
        }
        thread::sleep(Duration::from_millis(50));
    };
    let (out, err) = (out.join().unwrap_or_default(), err.join().unwrap_or_default());
    if status.success() {
        Ok(out)
    } else {
        let msg = if err.trim().is_empty() { out } else { err };
        Err(msg.trim().to_string())
    }
}

/// A phone or tablet signed in to Tailscale as the same person as this Mac.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub name: String,
    pub os: String,
    pub online: bool,
    /// When Tailscale last heard from it (RFC 3339), if it's offline.
    pub last_seen: Option<String>,
    #[serde(skip)]
    pub ips: Vec<String>,
}

/// This Mac on Tailscale.
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    /// "Running", "Stopped", "NeedsLogin", "Starting", …
    pub state: String,
    /// The signed-in person's login, e.g. "you@example.com" or "you@github".
    pub login: Option<String>,
    /// This Mac's name on the tailnet, e.g. "macbook.tail1234.ts.net".
    pub host: Option<String>,
    /// Whether the tailnet hands out HTTPS certificates (needed by serve).
    pub https: bool,
    pub phones: Vec<Device>,
}

const PHONE_OS: &[&str] = &["iOS", "android"];

pub fn status() -> Result<Node, String> {
    let json = run(&["status", "--json"])?;
    if json.trim().is_empty() {
        return Err("Tailscale gave no answer. Make sure the Tailscale app is running.".into());
    }
    let v: Value = serde_json::from_str(&json).map_err(|e| format!("Unexpected answer from Tailscale: {e}"))?;
    Ok(parse_status(&v))
}

fn parse_status(v: &Value) -> Node {
    let state = v["BackendState"].as_str().unwrap_or("Unknown").to_string();
    let me = &v["Self"];
    let user = me["UserID"].as_u64();
    let login = user
        .and_then(|id| v["User"][id.to_string()]["LoginName"].as_str())
        .map(str::to_string);
    let host = me["DNSName"].as_str().map(|s| s.trim_end_matches('.').to_string()).filter(|s| !s.is_empty());
    let https = v["CertDomains"].as_array().is_some_and(|d| !d.is_empty());
    let mut phones: Vec<Device> = v["Peer"]
        .as_object()
        .into_iter()
        .flat_map(|peers| peers.values())
        .filter(|p| user.is_some() && p["UserID"].as_u64() == user)
        .filter(|p| p["OS"].as_str().is_some_and(|os| PHONE_OS.contains(&os)))
        .map(|p| {
            let online = p["Online"].as_bool().unwrap_or(false);
            Device {
                name: p["HostName"].as_str().unwrap_or("Phone").to_string(),
                os: p["OS"].as_str().unwrap_or_default().to_string(),
                online,
                last_seen: p["LastSeen"].as_str().filter(|_| !online).map(str::to_string),
                ips: p["TailscaleIPs"]
                    .as_array()
                    .map(|ips| ips.iter().filter_map(|ip| ip.as_str().map(str::to_string)).collect())
                    .unwrap_or_default(),
            }
        })
        .collect();
    phones.sort_by(|a, b| b.online.cmp(&a.online).then_with(|| a.name.cmp(&b.name)));
    Node { state, login, host, https, phones }
}

/// What `tailscale serve` does with the mirror's HTTPS port.
#[derive(Debug, Default, PartialEq)]
pub struct Serve {
    /// It forwards to the mirror.
    pub ours: bool,
    /// It's taken by something else, which Workdesk leaves alone.
    pub taken: bool,
    /// The port is on the public internet (Funnel). The mirror refuses to run then.
    pub funnel: bool,
}

pub fn serve_status(host: &str, https_port: u16, target: &str) -> Result<Serve, String> {
    let json = run(&["serve", "status", "--json"])?;
    // An empty config prints nothing, or "{}".
    let v: Value = serde_json::from_str(&json).unwrap_or(Value::Null);
    Ok(parse_serve(&v, host, https_port, target))
}

fn parse_serve(v: &Value, host: &str, https_port: u16, target: &str) -> Serve {
    let key = format!("{host}:{https_port}");
    let web = &v["Web"][&key];
    let tcp = &v["TCP"][https_port.to_string()];
    let ours = web["Handlers"]["/"]["Proxy"].as_str().is_some_and(|p| p.trim_end_matches('/') == target);
    let taken = !ours && (!web.is_null() || !tcp.is_null());
    let funnel = v["AllowFunnel"][&key].as_bool().unwrap_or(false);
    Serve { ours, taken, funnel }
}

/// Forwards `https://<host>:<https_port>` on the tailnet to `target`, and keeps doing so across restarts.
pub fn serve_on(https_port: u16, target: &str) -> Result<(), String> {
    run(&["serve", "--bg", "--yes", &format!("--https={https_port}"), target]).map(|_| ())
}

pub fn serve_off(https_port: u16) -> Result<(), String> {
    run(&["serve", "--yes", &format!("--https={https_port}"), "off"]).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn finds_own_phones_only() {
        let v = json!({
            "BackendState": "Running",
            "CertDomains": ["mac.tail1.ts.net"],
            "Self": { "DNSName": "mac.tail1.ts.net.", "UserID": 1 },
            "User": { "1": { "LoginName": "me@example.com" }, "2": { "LoginName": "them@example.com" } },
            "Peer": {
                "a": { "HostName": "iPhone", "OS": "iOS", "Online": true, "UserID": 1, "TailscaleIPs": ["100.1.1.1"] },
                "b": { "HostName": "their-phone", "OS": "iOS", "Online": true, "UserID": 2 },
                "c": { "HostName": "server", "OS": "linux", "Online": true, "UserID": 1 },
                "d": { "HostName": "Pixel", "OS": "android", "Online": false, "UserID": 1, "LastSeen": "2026-11-01T10:00:00Z" }
            }
        });
        let n = parse_status(&v);
        assert_eq!(n.login.as_deref(), Some("me@example.com"));
        assert_eq!(n.host.as_deref(), Some("mac.tail1.ts.net"));
        assert!(n.https);
        let names: Vec<_> = n.phones.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["iPhone", "Pixel"]);
        assert_eq!(n.phones[0].ips, ["100.1.1.1"]);
        assert_eq!(n.phones[1].last_seen.as_deref(), Some("2026-11-01T10:00:00Z"));
    }

    #[test]
    fn stopped_without_peers() {
        let n = parse_status(&json!({ "BackendState": "Stopped", "Self": { "DNSName": "" }, "Peer": null, "User": null }));
        assert_eq!(n.state, "Stopped");
        assert!(n.login.is_none() && n.host.is_none() && n.phones.is_empty());
    }

    #[test]
    fn reads_serve_config() {
        let target = "http://127.0.0.1:47390";
        let ours = json!({
            "TCP": { "8443": { "HTTPS": true } },
            "Web": { "mac.ts.net:8443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:47390" } } } }
        });
        assert_eq!(parse_serve(&ours, "mac.ts.net", 8443, target), Serve { ours: true, taken: false, funnel: false });
        let other = json!({
            "TCP": { "8443": { "HTTPS": true } },
            "Web": { "mac.ts.net:8443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:3000" } } } },
            "AllowFunnel": { "mac.ts.net:8443": true }
        });
        assert_eq!(parse_serve(&other, "mac.ts.net", 8443, target), Serve { ours: false, taken: true, funnel: true });
        assert_eq!(parse_serve(&Value::Null, "mac.ts.net", 8443, target), Serve::default());
    }
}
