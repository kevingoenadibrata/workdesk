use std::{collections::HashMap, path::Path, process::Command, sync::OnceLock};

use serde::Serialize;

/// What a pane's status bar shows about the git repo its shell is in.
#[derive(Serialize)]
pub struct GitInfo {
    /// Name of the repo's top-level folder.
    repo: String,
    /// The checked-out branch, or the short commit hash when detached.
    branch: String,
    /// Lines added and removed in the working tree and index, against HEAD.
    added: u32,
    removed: u32,
    /// Commits ahead of and behind the upstream branch; both 0 without one.
    ahead: u32,
    behind: u32,
}

/// A git binary that won't pop up the "install developer tools" dialog:
/// `/usr/bin/git` is only a shim that does when they're missing. Apps launched
/// from Finder don't get the user's PATH, so look in the usual places.
fn git_binary() -> Option<&'static str> {
    static GIT: OnceLock<Option<&'static str>> = OnceLock::new();
    *GIT.get_or_init(|| {
        [
            "/opt/homebrew/bin/git",
            "/usr/local/bin/git",
            "/Library/Developer/CommandLineTools/usr/bin/git",
            "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
            "/usr/bin/git",
        ]
        .into_iter()
        .find(|p| {
            Path::new(p).is_file()
                && (*p != "/usr/bin/git" || cfg!(not(target_os = "macos")))
        })
    })
}

/// Runs git in `dir`, returning its stdout if it succeeded.
fn git(dir: &str, args: &[&str]) -> Option<String> {
    run(dir, args).ok()
}

/// Runs git in `dir`, returning its stdout, or its error message if it failed.
fn run(dir: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new(git_binary().ok_or("git isn't installed")?)
        .arg("-C")
        .arg(dir)
        .args(args)
        // Polling must never take the index lock out from under the user's own git commands.
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if msg.is_empty() { format!("git exited with {}", out.status) } else { msg })
    }
}

fn git_info(dir: &str) -> Option<GitInfo> {
    let top = git(dir, &["rev-parse", "--show-toplevel"])?;
    let top = top.trim();
    let repo = Path::new(top).file_name()?.to_string_lossy().into_owned();
    let branch = git(dir, &["symbolic-ref", "--short", "-q", "HEAD"])
        .or_else(|| git(dir, &["rev-parse", "--short", "HEAD"]))
        .map(|b| b.trim().to_string())
        .unwrap_or_default();
    // A repo with no commits yet has no HEAD to diff against; count nothing.
    let (mut added, mut removed) = (0, 0);
    for line in git(dir, &["-c", "diff.autoRefreshIndex=false", "diff", "HEAD", "--numstat", "--no-ext-diff", "--no-color"]).unwrap_or_default().lines() {
        let mut cols = line.split('\t');
        // Binary files show "-" for both counts.
        added += cols.next().and_then(|n| n.parse::<u32>().ok()).unwrap_or(0);
        removed += cols.next().and_then(|n| n.parse::<u32>().ok()).unwrap_or(0);
    }
    let counts = git(dir, &["rev-list", "--left-right", "--count", "HEAD...@{u}"]).unwrap_or_default();
    let mut counts = counts.split_whitespace().map(|n| n.parse::<u32>().unwrap_or(0));
    let (ahead, behind) = (counts.next().unwrap_or(0), counts.next().unwrap_or(0));
    Some(GitInfo { repo, branch, added, removed, ahead, behind })
}

/// Git status for each of `dirs` that's inside a repo, keyed by directory.
#[tauri::command]
pub async fn git_status(dirs: Vec<String>) -> HashMap<String, GitInfo> {
    tauri::async_runtime::spawn_blocking(move || {
        dirs.into_iter().filter_map(|d| Some((d.clone(), git_info(&d)?))).collect()
    })
    .await
    .unwrap_or_default()
}

/// Local branches of the repo `dir` is in, most recently committed first.
#[tauri::command]
pub async fn git_branches(dir: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out = run(&dir, &["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads"])?;
        Ok(out.lines().map(str::to_string).filter(|b| !b.is_empty()).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Checks out `branch` in the repo `dir` is in (creating it from HEAD if
/// `create`), failing with git's message.
#[tauri::command]
pub async fn git_checkout(dir: String, branch: String, create: bool) -> Result<(), String> {
    if branch.starts_with('-') {
        return Err(format!("'{branch}' is not a valid branch name"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        if create {
            run(&dir, &["checkout", "-b", &branch]).map(|_| ())
        } else {
            // The trailing "--" makes git read it as a branch, never a path.
            run(&dir, &["checkout", &branch, "--"]).map(|_| ())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
