---
name: release
description: Publish a new Workdesk release on GitHub — bump the version, tag it, and let the release workflow build and publish it, so the in-app updater offers it to installed copies. Use when the user says "release", "make a release", "cut a release", "publish a new version", "bump the version and release", or when the `ship` skill chains into it. Takes an optional argument: patch, minor or major.
---

# Release Workdesk

A release is a GitHub Release on `kevingoenadibrata/workdesk` built by `.github/workflows/release.yml`, which runs when a `v*` tag is pushed. It publishes a signed `Workdesk.app.tar.gz` and a `latest.json`; installed copies of Workdesk check that file (on launch, every 6 hours, and from Workdesk → Check for Updates…) and offer the update. Releasing doesn't touch the local `/Applications` copy; it updates itself like everyone else's.

## Steps

### 1. Preconditions

- On `main`, with a clean working tree (`git status --short` empty). If there are uncommitted changes, stop and suggest the `ship` skill first.
- Up to date: `git pull --ff-only`.
- There's something to release: `git log <last tag>..HEAD --oneline` (last tag from `git describe --tags --abbrev=0`; if there are no tags, everything counts). If nothing has changed since the last tag, say so and ask before releasing anyway.

### 2. Pick the version

The version lives in `package.json` (and `package-lock.json`), `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` (`[package] version`, plus `Cargo.lock`). All must match.

If the skill was given `patch`, `minor` or `major`, use it. Otherwise ask with AskUserQuestion, putting the resulting numbers in the labels (e.g. "Patch → 0.2.5", "Minor → 0.3.0", "Major → 1.0.0").

The new version must be greater than the current one, or the updater won't offer it. Check that the tag `v<new>` doesn't already exist (`git tag -l`, `gh release view v<new>`).

### 3. Bump

```bash
npm version <new> --no-git-tag-version          # package.json + package-lock.json
```

Then set `"version"` in `src-tauri/tauri.conf.json` and `version` under `[package]` in `src-tauri/Cargo.toml` to the new value, and refresh the lockfile:

```bash
(cd src-tauri && cargo update -p workdesk --offline)
```

`git diff --stat` should show exactly those five files.

### 4. Write the release notes

The notes go in the annotated tag's message; the workflow publishes them as the GitHub Release body and as the `notes` field of `latest.json` (what the in-app updater sees). They're fixed once the tag is pushed, so get them right first.

Read what changed since the previous tag: `git log <last tag>..HEAD` (full messages, not just subjects) and merged PRs (`gh pr list --state merged --base main --search "merged:>=<last tag date>" --json number,title,body`). Look at the diff where a message is vague. Then write Markdown for someone using Workdesk, not someone reading the code:

```markdown
## What's new
- **Auto-updates.** Workdesk checks for new versions on launch and every few hours, and from Workdesk → Check for Updates…

## Fixes
- Closing the last pane of a split no longer …

## Under the hood
- …
```

- Lead with what the user can now do or will notice; name menu items and shortcuts as they appear in the app.
- One line per change, bold lead-in, no commit hashes, no file paths unless the user would touch them.
- Leave out sections with nothing in them. Fold version bumps, skill/workflow tweaks and refactors into "Under the hood", or drop them if they don't matter to a user.
- Link PRs as `(#12)` at the end of a line when there is one.

Show the draft to the user and ask with AskUserQuestion: "Looks good" or "Edit" (they say what to change). Don't tag until they approve. Save the approved notes to a file outside the repo (e.g. in the scratchpad directory).

### 5. Commit, tag, push

```bash
git commit -am "Release v<new>"
git tag -a v<new> -F <notes file>
git push origin main v<new>
```

The tag must be annotated (`-a`): the workflow fails on a tag with no message. The version bump goes straight to `main` (it's only a version change); end the commit message with the attribution lines from the system reminder, if any. If the push is rejected, stop and report; don't force.

### 6. Watch the build

Find the run (`gh run list --workflow release.yml --limit 1 --json databaseId,headBranch,status`) and run `gh run watch <id> --exit-status` in the background. It takes about 5–10 minutes. Don't poll; wait for it to finish.

The workflow creates the release as a draft, uploads the build into it, and publishes it last, so the updater never sees a release without its files. If it fails, show the failing step's log lines (`gh run view <id> --log-failed | tail -50`). A failed run can leave the draft behind; `gh run rerun <id>` reuses it. The tag is already pushed, so after a fix the usual move is a new patch release, not reusing the tag; ask the user before deleting or moving any tag.

### 7. Check

```bash
gh release view v<new>
curl -sL https://github.com/kevingoenadibrata/workdesk/releases/latest/download/latest.json
```

The release should show the notes, and `latest.json` should show `"version": "<new>"`, the same notes, and a `darwin-aarch64` platform entry. If a typo needs fixing after the fact, `gh release edit v<new> --notes-file <file>` fixes the page, but `latest.json` keeps the tag's version unless it's re-uploaded too.

Report the release URL and tell the user their Workdesk will offer the update on its next check (or right away via Workdesk → Check for Updates…).

## Signing key

The workflow signs updates with the GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; the same key is at `~/.tauri/workdesk-updater.key` (+ `.password`). Never print them. Never generate a new key: installed copies only accept updates signed with this one.

## Notifications

Only notify the user's phone if they ask (e.g. "release and ping me"); use the `notify-phone` skill when the workflow finishes, with the release URL, or with the failure.
