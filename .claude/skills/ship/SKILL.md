---
name: ship
description: Build Workdesk (the Tauri app in this repo) and install the new build over /Applications/Workdesk.app, without quitting or relaunching the running app. Use whenever the user says "ship this", "ship it", "ship", "release it", "push it to my app", "install the new build", "put this in my real app", or otherwise wants their latest changes running in the installed Workdesk rather than the dev server.
---

# Ship Workdesk

"Ship this" means: build a release of Workdesk from the current source and replace the copy in `/Applications` with it, so the user's everyday app picks up the changes. There is no remote release (no git, no GitHub, no updater); shipping is local.

## Steps

### 1. Ask about the version

The version lives in three files that must stay in sync: `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` (the `[package]` `version`). Read the current value, then ask the user, every time, whether this ship is a patch, minor or major bump, or no bump. Use AskUserQuestion with the concrete resulting numbers in the labels (e.g. "Patch → 0.1.1"), and put "No bump" last. Apply the choice to all three files. Don't touch `Cargo.lock` by hand; cargo updates it during the build.

### 2. Check before building

Run `npx tsc --noEmit -p .` from the repo root. A type error would fail the build several minutes in, so catch it now; if it fails, stop and report the errors instead of building.

### 3. Build

```bash
npm run tauri build
```

Run it from the repo root with a 10-minute timeout. It runs `npm run build` (tsc + vite) then cargo in release mode and bundles a `.app` and `.dmg`. A first or post-`cargo clean` build can take several minutes; incremental ones are faster.

The output is `src-tauri/target/release/bundle/macos/Workdesk.app`. If the build fails, show the relevant error lines (not the whole log), and don't install anything. A failure in the `bundle_dmg.sh` step after the `.app` was produced is OK to ignore: only the `.app` is installed. Say so in the report.

### 4. Install

```bash
.claude/skills/ship/scripts/install.sh src-tauri/target/release/bundle/macos/Workdesk.app
```

Install only. Never quit, kill or relaunch Workdesk, and don't `open` it: the user has processes running in its panes (this session is usually one of them), and losing them is worse than running the old build a while longer. The script swaps the bundle in /Applications (keeping the old one as a backup, restored if the copy fails) and leaves the running app alone; the new build loads the next time the user restarts Workdesk themselves. Report the installed version and remind them of that.

### 5. Verifying

`defaults read /Applications/Workdesk.app/Contents/Info CFBundleShortVersionString` shows the installed version. The previous build is kept at `~/Library/Application Support/workdesk-ship/Workdesk.previous.app` if the user wants to roll back.

## Notifications

Only notify the user's phone if they ask (e.g. "ship this and ping me"); use the `notify-phone` skill. Send it once the install finishes, or on a build failure, send the failure.
