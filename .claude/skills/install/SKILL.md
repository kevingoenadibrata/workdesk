---
name: install
description: Build Workdesk (the Tauri app in this repo) from the current source and install it over /Applications/Workdesk.app, without quitting or relaunching the running app. Use whenever the user says "install", "install it", "install locally", "push it to my app", "install the new build", "put this in my real app", or otherwise wants their latest local changes running in the installed Workdesk without making a GitHub release.
---

# Install Workdesk locally

"Install" means: build a release of Workdesk from the current working tree and replace the copy in `/Applications` with it, so the user's everyday app picks up the changes right away. Nothing is committed, pushed or published. For the git/GitHub side, see the `ship` and `release` skills.

The version number is left alone: versions are bumped by the `release` skill. The in-app updater only offers releases newer than the installed version, so a local install never blocks a later release.

## Steps

### 1. Check before building

Run `npx tsc --noEmit -p .` from the repo root. A type error would fail the build several minutes in, so catch it now; if it fails, stop and report the errors instead of building.

### 2. Build

```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/workdesk-updater.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat ~/.tauri/workdesk-updater.password)" \
npm run tauri build
```

Run it from the repo root with a 10-minute timeout. It runs `npm run build` (tsc + vite) then cargo in release mode and bundles a `.app` and `.dmg`. A first or post-`cargo clean` build can take several minutes; incremental ones are faster.

The signing key is needed because the build also produces a signed updater bundle (`createUpdaterArtifacts`); without it the build fails at the end. Never print the key or password. If `~/.tauri/workdesk-updater.key` is missing, stop and tell the user: that key is what installed apps use to verify updates, and it can't be regenerated without breaking them.

The app is code-signed with the self-signed "Workdesk Code Signing" certificate (`bundle.macOS.signingIdentity` in `tauri.conf.json`), which lives in the login Keychain; the files are in `~/.tauri/workdesk-codesign.*` and CI has it as the `WORKDESK_CODESIGN_P12` / `WORKDESK_CODESIGN_PASSWORD` secrets. A stable signature is what keeps macOS's "Always Allow" on the Workdesk Integrations Keychain item working from one build to the next. If the build fails because the identity can't be found (`security find-identity -p codesigning` doesn't list it), re-import it with `security import ~/.tauri/workdesk-codesign.p12 -k ~/Library/Keychains/login.keychain-db -P "$(cat ~/.tauri/workdesk-codesign.password)" -T /usr/bin/codesign`. Never generate a new certificate: that changes the signature, and every installed copy asks for Keychain access again.

The output is `src-tauri/target/release/bundle/macos/Workdesk.app`. If the build fails, show the relevant error lines (not the whole log), and don't install anything. A failure in the `bundle_dmg.sh` step after the `.app` was produced is OK to ignore: only the `.app` is installed. Say so in the report.

### 3. Install

```bash
.claude/skills/install/scripts/install.sh src-tauri/target/release/bundle/macos/Workdesk.app
```

Install only. Never quit, kill or relaunch Workdesk, and don't `open` it: the user has processes running in its panes (this session is usually one of them), and losing them is worse than running the old build a while longer. The script swaps the bundle in /Applications (keeping the old one as a backup, restored if the copy fails) and leaves the running app alone; the new build loads the next time the user restarts Workdesk themselves. Report the installed version and remind them of that.

### 4. Verifying

`defaults read /Applications/Workdesk.app/Contents/Info CFBundleShortVersionString` shows the installed version. The previous build is kept at `~/Library/Application Support/workdesk-ship/Workdesk.previous.app` if the user wants to roll back.

## Notifications

Only notify the user's phone if they ask (e.g. "install this and ping me"); use the `notify-phone` skill. Send it once the install finishes, or on a build failure, send the failure.
