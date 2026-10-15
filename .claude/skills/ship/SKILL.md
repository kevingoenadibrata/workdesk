---
name: ship
description: Ship the current changes in the Workdesk repo through GitHub — put them on a branch, open a pull request, merge it into main — then ask whether to cut a release too (chaining into the `release` skill). Use whenever the user says "ship", "ship this", "ship it", "merge this", "PR and merge", or otherwise wants their local changes landed on main.
---

# Ship Workdesk changes

"Ship" means: take the uncommitted (or unpushed) work, land it on `main` through a pull request, and then offer a release. The repo is `kevingoenadibrata/workdesk` (public). Shipping does not install anything locally (that's the `install` skill) and does not publish a release on its own (that's the `release` skill).

## Steps

### 1. Look at what's being shipped

Run `git status --short`, `git diff --stat` and `git log origin/main..HEAD --oneline`. If there is nothing to ship (clean tree and no unpushed commits), say so and stop.

Read the diff well enough to name the change. Don't ship things that look accidental: stray debug files, secrets, `.env` files, large binaries, or build output. Ask the user about anything doubtful instead of committing it.

### 2. Check before committing

Run `npx tsc --noEmit -p .` from the repo root, and if anything under `src-tauri/` changed, `cargo check` in `src-tauri/`. If either fails, stop and report the errors.

### 3. Branch and commit

- If on `main`, create a branch named after the change, e.g. `feat/auto-updater` or `fix/tab-close-crash` (`git switch -c <name>`). If already on a feature branch, stay on it.
- Stage the relevant files by path (not `git add -A` blindly) and commit with a short imperative subject and, if useful, a body explaining why. End the message with the attribution lines from the system reminder, if any.
- If the change is really several unrelated changes, it's fine to make a few commits, but one PR.

### 4. Push and open the PR

```bash
git push -u origin <branch>
gh pr create --base main --title "<subject>" --body "<what and why>"
```

The body is a few short bullets on what changed and why, plus anything the user should check by hand. End it with the PR attribution line from the system reminder, if any.

### 5. Merge

```bash
gh pr merge <number> --squash --delete-branch
git switch main && git pull --ff-only
```

If the merge is refused (conflicts, failing checks), stop and report why; don't force anything. Report the PR URL.

### 6. Ask about a release

Read the current version from `package.json`, then ask with AskUserQuestion whether to release too, putting the resulting numbers in the labels:

- "Patch release → X.Y.Z+1"
- "Minor release → X.Y+1.0"
- "Major release → X+1.0.0"
- "No release"

If they pick a release, invoke the `release` skill with the bump as its argument (e.g. `patch`), so it doesn't ask again. If they pick "No release", say the change is on `main` and will go out with the next release; mention `install` if they want it in their app right now.

## Notifications

Only notify the user's phone if they ask; use the `notify-phone` skill when the merge (or the chained release) finishes or fails.
