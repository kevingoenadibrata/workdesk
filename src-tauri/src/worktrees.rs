//! Git worktrees for agents working on tickets: one checkout per ticket under
//! ~/.workdesk/worktrees/<repo>/<branch>, so several can run side by side
//! without touching the user's own checkout.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::git::run;

/// A worktree ready for an agent.
#[derive(Serialize, Debug)]
pub struct Started {
    /// The worktree's folder.
    path: String,
    /// Name of the repo's main folder.
    repo: String,
    /// The main checkout's folder.
    root: String,
    /// What the new branch started from, like "origin/main"; null if the branch already existed.
    base: Option<String>,
    /// The worktree was already there (a ticket picked up again).
    reused: bool,
    /// Ignored files like .env copied over from the main checkout.
    copied: Vec<String>,
    /// The file holding the agent's first prompt.
    prompt_file: String,
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| "/".into())
}

fn prompts_dir() -> PathBuf {
    home().join(".workdesk/prompts")
}

/// The main checkout of the repo `dir` is in, even when `dir` is in one of its worktrees.
fn main_repo(dir: &str) -> Result<PathBuf, String> {
    let common = run(dir, &["rev-parse", "--path-format=absolute", "--git-common-dir"])
        .map_err(|_| format!("{dir} isn't in a git repo. Pick a folder inside the repo the ticket belongs to."))?;
    let common = PathBuf::from(common.trim());
    // ".../repo/.git" → ".../repo"; a bare repo has no main checkout.
    if common.file_name().is_some_and(|n| n == ".git") {
        Ok(common.parent().unwrap().to_path_buf())
    } else {
        Err(format!("{} is a bare repo, with no checkout to branch from.", common.display()))
    }
}

/// Every worktree of `repo` (the main checkout first), with its branch if it has one.
fn worktrees(repo: &str) -> Vec<(PathBuf, Option<String>)> {
    let mut out = Vec::new();
    for block in run(repo, &["worktree", "list", "--porcelain"]).unwrap_or_default().split("\n\n") {
        let mut path = None;
        let mut branch = None;
        for line in block.lines() {
            if let Some(p) = line.strip_prefix("worktree ") {
                path = Some(PathBuf::from(p));
            } else if let Some(b) = line.strip_prefix("branch refs/heads/") {
                branch = Some(b.to_string());
            }
        }
        if let Some(p) = path {
            out.push((p, branch));
        }
    }
    out
}

fn same(a: &Path, b: &Path) -> bool {
    a == b || matches!((a.canonicalize(), b.canonicalize()), (Ok(x), Ok(y)) if x == y)
}

/// The branch new work starts from: the remote's default branch, else HEAD.
fn base_ref(repo: &str) -> String {
    if let Ok(b) = run(repo, &["rev-parse", "--abbrev-ref", "origin/HEAD"]) {
        let b = b.trim();
        if !b.is_empty() && b != "origin/HEAD" {
            return b.to_string();
        }
    }
    for b in ["origin/main", "origin/master"] {
        if run(repo, &["rev-parse", "--verify", "--quiet", b]).is_ok() {
            return b.to_string();
        }
    }
    "HEAD".into()
}

/// Copies the main checkout's ignored `.env*` files into `path`, which a
/// fresh worktree lacks. Returns their names.
fn copy_env_files(repo: &Path, path: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(repo) else { return Vec::new() };
    let mut copied = Vec::new();
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if !name.starts_with(".env") || !e.path().is_file() || path.join(&name).exists() {
            continue;
        }
        // Only ignored ones: tracked files are in the worktree already.
        if run(&repo.to_string_lossy(), &["check-ignore", "-q", &name]).is_err() {
            continue;
        }
        if std::fs::copy(e.path(), path.join(&name)).is_ok() {
            copied.push(name);
        }
    }
    copied.sort();
    copied
}

fn start(dir: &str, branch: &str, prompt: &str) -> Result<Started, String> {
    run(dir, &["check-ref-format", "--branch", branch]).map_err(|_| format!("'{branch}' isn't a valid branch name"))?;
    let repo_path = main_repo(dir)?;
    let repo = repo_path.to_string_lossy().into_owned();
    let repo_name = repo_path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let target = home().join(".workdesk/worktrees").join(&repo_name).join(branch.replace('/', "-"));

    let list = worktrees(&repo);
    let existing = list.iter().find(|(_, b)| b.as_deref() == Some(branch));
    let (path, base, reused) = match existing {
        // The main checkout has the branch; git won't check it out twice.
        Some((p, _)) if same(p, &repo_path) => {
            return Err(format!("{branch} is checked out in {repo}. Switch that checkout to another branch first."));
        }
        // Picked up again, or the user made a worktree for it themselves.
        Some((p, _)) => (p.clone(), None, true),
        None => {
            if target.exists() {
                return Err(format!("{} already exists and isn't a worktree of {repo_name}.", target.display()));
            }
            std::fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;
            // Best effort: offline, the last fetched state will do.
            let _ = run(&repo, &["fetch", "--quiet", "origin"]);
            let t = target.to_string_lossy();
            let local = run(&repo, &["show-ref", "--verify", "--quiet", &format!("refs/heads/{branch}")]).is_ok();
            let remote = format!("origin/{branch}");
            let base = if local {
                run(&repo, &["worktree", "add", &t, branch])?;
                None
            } else if run(&repo, &["rev-parse", "--verify", "--quiet", &remote]).is_ok() {
                run(&repo, &["worktree", "add", "--track", "-b", branch, &t, &remote])?;
                Some(remote)
            } else {
                // No tracking: the agent pushes with -u to a branch of the same name.
                let base = base_ref(&repo);
                run(&repo, &["worktree", "add", "--no-track", "-b", branch, &t, &base])?;
                Some(base)
            };
            (target, base, false)
        }
    };

    // Git lists worktrees by their real path; say the same thing either way.
    let path = path.canonicalize().unwrap_or(path);
    let copied = copy_env_files(&repo_path, &path);
    std::fs::create_dir_all(prompts_dir()).map_err(|e| e.to_string())?;
    let prompt_file = prompts_dir().join(format!("{repo_name}-{}.md", branch.replace('/', "-")));
    std::fs::write(&prompt_file, prompt).map_err(|e| e.to_string())?;
    Ok(Started {
        path: path.to_string_lossy().into_owned(),
        repo: repo_name,
        root: repo,
        base,
        reused,
        copied,
        prompt_file: prompt_file.to_string_lossy().into_owned(),
    })
}

/// Makes (or finds) the worktree for `branch` of the repo `dir` is in, and
/// saves `prompt` to a file the agent's command can read.
#[tauri::command]
pub async fn worktree_start(dir: String, branch: String, prompt: String) -> Result<Started, String> {
    if branch.starts_with('-') {
        return Err(format!("'{branch}' isn't a valid branch name"));
    }
    tauri::async_runtime::spawn_blocking(move || start(&dir, &branch, &prompt)).await.map_err(|e| e.to_string())?
}

fn remove(path: &str, repo: &str, branch: &str, force_branch: bool, prompt_file: Option<&str>) -> Result<String, String> {
    let gone = !Path::new(path).exists();
    if gone {
        let _ = run(repo, &["worktree", "prune"]);
    } else {
        // Without --force, git keeps a worktree with changes nobody committed.
        run(repo, &["worktree", "remove", path]).map_err(|e| {
            if e.contains("modified or untracked") {
                format!("{path} has changes that aren't committed. Commit or discard them first.")
            } else {
                e
            }
        })?;
    }
    if let Some(f) = prompt_file.map(Path::new).filter(|f| f.starts_with(prompts_dir())) {
        let _ = std::fs::remove_file(f);
    }
    if branch.is_empty() || branch.starts_with('-') {
        return Ok("Removed the worktree".into());
    }
    // A squash-merged branch isn't merged as far as git can tell, so -d would refuse it.
    match run(repo, &["branch", if force_branch { "-D" } else { "-d" }, branch]) {
        Ok(_) => Ok(format!("Removed the worktree and {branch}")),
        Err(_) => Ok(format!("Removed the worktree; kept {branch}, which isn't merged")),
    }
}

/// Removes the worktree at `path` of `repo` (refusing if it has uncommitted
/// changes) and its branch: always if `force_branch`, else only if merged.
#[tauri::command]
pub async fn worktree_remove(path: String, repo: String, branch: String, force_branch: bool, prompt_file: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || remove(&path, &repo, &branch, force_branch, prompt_file.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn sh(dir: &Path, cmd: &str) {
        let ok = Command::new("sh").arg("-c").arg(cmd).current_dir(dir).status().unwrap().success();
        assert!(ok, "{cmd}");
    }

    #[test]
    fn starts_reuses_and_removes_a_worktree() {
        let tmp = std::env::temp_dir().join(format!("workdesk-wt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let (origin, repo) = (tmp.join("origin.git"), tmp.join("app"));
        std::fs::create_dir_all(&repo).unwrap();
        sh(&tmp, "git init -q --bare -b main origin.git");
        sh(&repo, "git init -q -b main && printf '.env\\n' > .gitignore && git add .gitignore && git -c user.name=t -c user.email=t@t commit -q -m init");
        sh(&repo, &format!("git remote add origin {} && git push -q -u origin main && git remote set-head origin main", origin.display()));
        sh(&repo, "echo SECRET=1 > .env");
        // Keep the test's worktrees and prompts out of the real home.
        // SAFETY: no other test reads or writes the environment.
        unsafe { std::env::set_var("HOME", tmp.join("home")) };

        let d = repo.to_string_lossy().into_owned();
        let s = start(&d, "eng-42/fix-login", "do it").unwrap();
        assert_eq!(s.base.as_deref(), Some("origin/main"));
        assert!(!s.reused);
        assert_eq!(s.copied, vec![".env".to_string()]);
        assert!(s.path.ends_with(".workdesk/worktrees/app/eng-42-fix-login"));
        assert_eq!(std::fs::read_to_string(&s.prompt_file).unwrap(), "do it");
        // Starting from inside the worktree finds the same one.
        let again = start(&s.path, "eng-42/fix-login", "again").unwrap();
        assert!(again.reused);
        assert_eq!(again.path, s.path);
        // The main checkout's own branch can't be used.
        assert!(start(&d, "main", "x").unwrap_err().contains("checked out in"));

        std::fs::write(Path::new(&s.path).join("new.txt"), "x").unwrap();
        assert!(remove(&s.path, &s.root, "eng-42/fix-login", false, Some(&s.prompt_file)).unwrap_err().contains("aren't committed"));
        std::fs::remove_file(Path::new(&s.path).join("new.txt")).unwrap();
        assert_eq!(remove(&s.path, &s.root, "eng-42/fix-login", true, Some(&s.prompt_file)).unwrap(), "Removed the worktree and eng-42/fix-login");
        assert!(!Path::new(&s.path).exists());
        assert!(!Path::new(&s.prompt_file).exists());
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
