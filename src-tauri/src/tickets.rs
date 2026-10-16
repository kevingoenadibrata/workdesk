//! Tickets assigned to the user on GitHub Issues, ClickUp and Linear.
//!
//! ClickUp and Linear take a personal API token, kept in the macOS Keychain.
//! GitHub uses a pasted token if there is one, else the `gh` CLI's login.

use std::{path::Path, process::Command, sync::OnceLock, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Github,
    Clickup,
    Linear,
}

impl Provider {
    fn key(self) -> &'static str {
        match self {
            Provider::Github => "github",
            Provider::Clickup => "clickup",
            Provider::Linear => "linear",
        }
    }
}

/// A ticket as the Tickets page lists it, whichever service it's from.
#[derive(Serialize)]
pub struct Ticket {
    provider: Provider,
    /// What the service calls it: "#123", "ENG-42", or a ClickUp task id.
    id: String,
    title: String,
    url: String,
    /// The repo, Linear team or ClickUp list it belongs to.
    project: String,
    status: String,
    /// The status's color as hex, when the service has one.
    color: Option<String>,
    /// Last updated: an ISO 8601 date, or ms since the epoch (ClickUp).
    updated: String,
    /// A branch name the service suggests (Linear does).
    branch: Option<String>,
}

/// An open GitHub pull request the user wrote, or was asked to review.
#[derive(Serialize)]
pub struct PullRequest {
    /// "authored" or "review".
    kind: &'static str,
    /// "#123".
    id: String,
    title: String,
    url: String,
    /// "owner/name".
    repo: String,
    author: String,
    draft: bool,
    /// GitHub's review decision: "APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED", or null.
    review: Option<String>,
    /// The PR's head branch.
    branch: String,
    updated: String,
}

/// Whether Workdesk can reach a service, and with what.
#[derive(Serialize)]
pub struct Account {
    provider: Provider,
    /// "keychain" for a pasted token, "gh" for the GitHub CLI's login, or null.
    source: Option<&'static str>,
}

const KEYCHAIN_SERVICE: &str = "Workdesk Integrations";

#[cfg(target_os = "macos")]
fn stored_token(p: Provider) -> Option<String> {
    let bytes = security_framework::passwords::get_generic_password(KEYCHAIN_SERVICE, p.key()).ok()?;
    String::from_utf8(bytes).ok().filter(|t| !t.is_empty())
}

#[cfg(target_os = "macos")]
fn store_token(p: Provider, token: &str) -> Result<(), String> {
    security_framework::passwords::set_generic_password(KEYCHAIN_SERVICE, p.key(), token.as_bytes()).map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn forget_token(p: Provider) {
    let _ = security_framework::passwords::delete_generic_password(KEYCHAIN_SERVICE, p.key());
}

#[cfg(not(target_os = "macos"))]
fn stored_token(_: Provider) -> Option<String> {
    None
}

#[cfg(not(target_os = "macos"))]
fn store_token(_: Provider, _: &str) -> Result<(), String> {
    Err("Saving tokens needs the macOS Keychain".into())
}

#[cfg(not(target_os = "macos"))]
fn forget_token(_: Provider) {}

/// The `gh` CLI's token. Apps launched from Finder don't get the user's
/// PATH, so look in the usual places.
fn gh_token() -> Option<String> {
    static GH: OnceLock<Option<&'static str>> = OnceLock::new();
    let gh = (*GH.get_or_init(|| ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"].into_iter().find(|p| Path::new(p).is_file())))?;
    let out = Command::new(gh).args(["auth", "token"]).stdin(std::process::Stdio::null()).output().ok()?;
    let token = String::from_utf8(out.stdout).ok()?.trim().to_string();
    (out.status.success() && !token.is_empty()).then_some(token)
}

/// The token to use for `p`, and where it came from.
fn token(p: Provider) -> Option<(String, &'static str)> {
    if let Some(t) = stored_token(p) {
        return Some((t, "keychain"));
    }
    if p == Provider::Github {
        return gh_token().map(|t| (t, "gh"));
    }
    None
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        // reqwest is built without a crypto provider of its own (the updater's choice); use ring's.
        let _ = rustls::crypto::ring::default_provider().install_default();
        reqwest::Client::builder()
            .user_agent(concat!("Workdesk/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(20))
            .build()
            .expect("HTTP client")
    })
}

/// Sends `req`, returning its JSON body, or a message fit to show the user.
async fn send(name: &str, req: reqwest::RequestBuilder) -> Result<Value, String> {
    let res = req.send().await.map_err(|e| {
        if e.is_timeout() {
            format!("{name} didn't answer in time")
        } else {
            format!("Couldn't reach {name}")
        }
    })?;
    let status = res.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(format!("{name} rejected the token. Reconnect it in Settings → Integrations."));
    }
    if !status.is_success() {
        return Err(format!("{name} answered {status}"));
    }
    res.json().await.map_err(|_| format!("{name} sent something unexpected"))
}

fn str_at(v: &Value, ptr: &str) -> String {
    v.pointer(ptr).and_then(Value::as_str).unwrap_or_default().to_string()
}

fn missing(p: Provider) -> String {
    match p {
        Provider::Github => "Not connected. Add a token in Settings → Integrations, or sign in with `gh auth login`.".into(),
        _ => "Not connected. Add a token in Settings → Integrations.".into(),
    }
}

// ---- GitHub ----

fn github(token: &str, path: &str) -> reqwest::RequestBuilder {
    client()
        .get(format!("https://api.github.com{path}"))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
}

async fn github_tickets(token: &str) -> Result<Vec<Ticket>, String> {
    let body = send("GitHub", github(token, "/search/issues?q=is:open+is:issue+assignee:@me+archived:false&sort=updated&order=desc&per_page=100")).await?;
    let items = body["items"].as_array().cloned().unwrap_or_default();
    Ok(items
        .iter()
        .map(|i| {
            // ".../repos/owner/name" → "owner/name"
            let repo = str_at(i, "/repository_url");
            let repo = repo.splitn(6, '/').nth(5).unwrap_or_default().to_string();
            Ticket {
                provider: Provider::Github,
                id: format!("#{}", i["number"].as_u64().unwrap_or_default()),
                title: str_at(i, "/title"),
                url: str_at(i, "/html_url"),
                project: repo,
                status: "Open".into(),
                color: None,
                updated: str_at(i, "/updated_at"),
                branch: None,
            }
        })
        .collect())
}

async fn github_pulls(token: &str) -> Result<Vec<PullRequest>, String> {
    let query = r#"fragment pr on PullRequest { number title url updatedAt isDraft reviewDecision headRefName author { login } repository { nameWithOwner } }
        { authored: search(type: ISSUE, first: 100, query: "is:pr is:open author:@me archived:false sort:updated-desc") { nodes { ...pr } }
          review: search(type: ISSUE, first: 100, query: "is:pr is:open review-requested:@me archived:false sort:updated-desc") { nodes { ...pr } } }"#;
    let req = client().post("https://api.github.com/graphql").bearer_auth(token).json(&json!({ "query": query }));
    let body = send("GitHub", req).await?;
    if let Some(err) = body["errors"].as_array().and_then(|e| e.first()) {
        return Err(format!("GitHub: {}", str_at(err, "/message")));
    }
    let mut out = Vec::new();
    for kind in ["authored", "review"] {
        for n in body.pointer(&format!("/data/{kind}/nodes")).and_then(Value::as_array).cloned().unwrap_or_default() {
            // Search can return issues too; they come back as empty objects here.
            let Some(number) = n["number"].as_u64() else { continue };
            out.push(PullRequest {
                kind,
                id: format!("#{number}"),
                title: str_at(&n, "/title"),
                url: str_at(&n, "/url"),
                repo: str_at(&n, "/repository/nameWithOwner"),
                author: str_at(&n, "/author/login"),
                draft: n["isDraft"].as_bool().unwrap_or_default(),
                review: n["reviewDecision"].as_str().map(str::to_string),
                branch: str_at(&n, "/headRefName"),
                updated: str_at(&n, "/updatedAt"),
            });
        }
    }
    Ok(out)
}

// ---- Linear ----

async fn linear(token: &str, query: &str) -> Result<Value, String> {
    // Personal API keys go in as they are, without "Bearer".
    let body = send("Linear", client().post("https://api.linear.app/graphql").header("Authorization", token).json(&json!({ "query": query }))).await?;
    if let Some(err) = body["errors"].as_array().and_then(|e| e.first()) {
        return Err(format!("Linear: {}", str_at(err, "/message")));
    }
    Ok(body["data"].clone())
}

async fn linear_tickets(token: &str) -> Result<Vec<Ticket>, String> {
    let data = linear(
        token,
        r#"{ viewer { assignedIssues(first: 100, orderBy: updatedAt, filter: { state: { type: { nin: ["completed", "canceled"] } } }) {
            nodes { identifier title url branchName updatedAt state { name color } team { name } } } } }"#,
    )
    .await?;
    let nodes = data.pointer("/viewer/assignedIssues/nodes").and_then(Value::as_array).cloned().unwrap_or_default();
    Ok(nodes
        .iter()
        .map(|n| Ticket {
            provider: Provider::Linear,
            id: str_at(n, "/identifier"),
            title: str_at(n, "/title"),
            url: str_at(n, "/url"),
            project: str_at(n, "/team/name"),
            status: str_at(n, "/state/name"),
            color: n.pointer("/state/color").and_then(Value::as_str).map(str::to_string),
            updated: str_at(n, "/updatedAt"),
            branch: n["branchName"].as_str().filter(|b| !b.is_empty()).map(str::to_string),
        })
        .collect())
}

// ---- ClickUp ----

async fn clickup(token: &str, path: &str) -> Result<Value, String> {
    send("ClickUp", client().get(format!("https://api.clickup.com/api/v2{path}")).header("Authorization", token)).await
}

async fn clickup_tickets(token: &str) -> Result<Vec<Ticket>, String> {
    let user = clickup(token, "/user").await?;
    let me = user.pointer("/user/id").and_then(Value::as_u64).ok_or("ClickUp sent something unexpected")?;
    let teams = clickup(token, "/team").await?;
    let mut out = Vec::new();
    for team in teams["teams"].as_array().cloned().unwrap_or_default() {
        let team_id = str_at(&team, "/id");
        // A page is 100 tasks; past five pages, the oldest ones can wait.
        for page in 0..5 {
            let body = clickup(
                token,
                &format!("/team/{team_id}/task?assignees[]={me}&subtasks=true&include_closed=false&order_by=updated&page={page}"),
            )
            .await?;
            for t in body["tasks"].as_array().cloned().unwrap_or_default() {
                let custom = str_at(&t, "/custom_id");
                out.push(Ticket {
                    provider: Provider::Clickup,
                    id: if custom.is_empty() { str_at(&t, "/id") } else { custom },
                    title: str_at(&t, "/name"),
                    url: str_at(&t, "/url"),
                    project: str_at(&t, "/list/name"),
                    status: str_at(&t, "/status/status"),
                    color: t.pointer("/status/color").and_then(Value::as_str).map(str::to_string),
                    updated: str_at(&t, "/date_updated"),
                    branch: None,
                });
            }
            if body["last_page"].as_bool() != Some(false) {
                break;
            }
        }
    }
    Ok(out)
}

// ---- commands ----

/// Which services are connected, without asking any of them.
#[tauri::command]
pub async fn tickets_accounts() -> Vec<Account> {
    tauri::async_runtime::spawn_blocking(|| {
        [Provider::Github, Provider::Clickup, Provider::Linear]
            .into_iter()
            .map(|provider| Account { provider, source: token(provider).map(|(_, s)| s) })
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// The name of the account `provider`'s token belongs to.
#[tauri::command]
pub async fn tickets_whoami(provider: Provider) -> Result<String, String> {
    let (t, _) = tauri::async_runtime::spawn_blocking(move || token(provider)).await.ok().flatten().ok_or_else(|| missing(provider))?;
    whoami(provider, &t).await
}

async fn whoami(provider: Provider, token: &str) -> Result<String, String> {
    Ok(match provider {
        Provider::Github => str_at(&send("GitHub", github(token, "/user")).await?, "/login"),
        Provider::Linear => str_at(&linear(token, "{ viewer { name } }").await?, "/viewer/name"),
        Provider::Clickup => str_at(&clickup(token, "/user").await?, "/user/username"),
    })
}

/// Checks `token` with `provider`, then keeps it in the Keychain. Returns the account's name.
#[tauri::command]
pub async fn tickets_connect(provider: Provider, token: String) -> Result<String, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Paste a token first".into());
    }
    let name = whoami(provider, &token).await?;
    tauri::async_runtime::spawn_blocking(move || store_token(provider, &token)).await.map_err(|e| e.to_string())??;
    Ok(name)
}

/// Forgets `provider`'s token. GitHub falls back to the `gh` login, if there is one.
#[tauri::command]
pub async fn tickets_disconnect(provider: Provider) {
    let _ = tauri::async_runtime::spawn_blocking(move || forget_token(provider)).await;
}

/// The open tickets assigned to the user on `provider`, most recently updated first.
#[tauri::command]
pub async fn tickets_list(provider: Provider) -> Result<Vec<Ticket>, String> {
    let (t, _) = tauri::async_runtime::spawn_blocking(move || token(provider)).await.ok().flatten().ok_or_else(|| missing(provider))?;
    match provider {
        Provider::Github => github_tickets(&t).await,
        Provider::Linear => linear_tickets(&t).await,
        Provider::Clickup => clickup_tickets(&t).await,
    }
}


/// The open GitHub pull requests the user wrote or was asked to review, most recently updated first.
#[tauri::command]
pub async fn tickets_pulls() -> Result<Vec<PullRequest>, String> {
    let (t, _) = tauri::async_runtime::spawn_blocking(|| token(Provider::Github)).await.ok().flatten().ok_or_else(|| missing(Provider::Github))?;
    github_pulls(&t).await
}
