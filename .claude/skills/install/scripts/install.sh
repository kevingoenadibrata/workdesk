#!/bin/bash
# Installs a freshly built Workdesk.app into /Applications. Install only:
# never quits or relaunches Workdesk, since the user has processes running in
# its panes. A running Workdesk keeps running the old build (its files stay
# open) and picks up the new one whenever the user restarts it.
#
# Usage: install.sh <path/to/built/Workdesk.app>
set -euo pipefail

SRC="${1:?usage: install.sh <path/to/Workdesk.app>}"
DEST="${WORKDESK_SHIP_DEST:-/Applications/Workdesk.app}" # override only for testing
STATE="$HOME/Library/Application Support/workdesk-ship"
BACKUP="$STATE/Workdesk.previous.app"

[ -x "$SRC/Contents/MacOS/workdesk" ] || { echo "error: $SRC is not a built Workdesk.app" >&2; exit 1; }

mkdir -p "$STATE"
rm -rf "$BACKUP"
# Move, don't overwrite in place: the running app keeps its open files, and
# the old bundle survives as a backup if the copy fails.
[ -d "$DEST" ] && mv "$DEST" "$BACKUP"

if ! ditto "$SRC" "$DEST"; then
  echo "error: copy failed; restoring the previous app" >&2
  rm -rf "$DEST"
  [ -d "$BACKUP" ] && mv "$BACKUP" "$DEST"
  exit 1
fi
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo "installed $(defaults read "$DEST/Contents/Info" CFBundleShortVersionString) to $DEST"
# Not `ps | grep -q`: under pipefail, grep quitting early SIGPIPEs ps and the
# pipeline reads as "not running".
if grep -qxF "$DEST/Contents/MacOS/workdesk" <<<"$(ps -axo command=)"; then
  echo "Workdesk is running the previous build; the new one loads when you next restart it."
fi
