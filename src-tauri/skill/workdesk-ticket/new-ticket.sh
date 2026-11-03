#!/bin/bash
# Writes a ticket into Workdesk's backlog (installed by Workdesk; see SKILL.md).
#
#   new-ticket.sh --title "Title" [--project NAME] < description.md
#
# The ticket goes to ~/.workdesk/inbox/tickets as a small text file, which the
# running Workdesk turns into a WD-n ticket and answers with its id.
set -euo pipefail

title=""
project=""
while [ $# -gt 0 ]; do
  case "$1" in
    -t|--title) title="${2-}"; shift 2 ;;
    -p|--project) project="${2-}"; shift 2 ;;
    --title=*) title="${1#*=}"; shift ;;
    --project=*) project="${1#*=}"; shift ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "new-ticket.sh: unknown argument: $1 (the description goes on stdin)" >&2; exit 2 ;;
  esac
done

# Titles and projects are one line each.
oneline() { printf '%s' "$1" | tr '\r\n\t' '   ' | sed -e 's/^ *//' -e 's/ *$//'; }
title=$(oneline "$title")
project=$(oneline "$project")
if [ -z "$title" ]; then
  echo "new-ticket.sh: give the ticket a --title" >&2
  exit 2
fi

body=""
if [ ! -t 0 ]; then body=$(cat); fi

# The repository this was run in (its main checkout, when in a worktree).
repo=""
if common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null); then
  if [ "$(basename "$common")" = ".git" ]; then repo=$(dirname "$common"); else repo=$(git rev-parse --show-toplevel 2>/dev/null || true); fi
fi
# A ticket for another project isn't linked to this repository.
if [ -z "$project" ] && [ -n "$repo" ]; then project=$(basename "$repo"); fi
if [ -n "$repo" ] && [ "$project" != "$(basename "$repo")" ]; then repo=""; fi

inbox="$HOME/.workdesk/inbox/tickets"
mkdir -p "$inbox"
name="$(date +%s)-$$-$RANDOM"
# Written aside, then moved in whole, so Workdesk never reads half a ticket.
{
  printf 'title: %s\n' "$title"
  printf 'project: %s\n' "$project"
  if [ -n "$repo" ]; then printf 'repo: %s\n' "$repo"; fi
  printf -- '---\n%s\n' "$body"
} > "$inbox/$name.tmp"
mv "$inbox/$name.tmp" "$inbox/$name.md"

# Workdesk answers with the id in <name>.done within a second or two when it's open.
for _ in $(seq 1 30); do
  if [ -f "$inbox/$name.done" ]; then
    id=$(cat "$inbox/$name.done")
    rm -f "$inbox/$name.done"
    echo "Created $id: $title"
    exit 0
  fi
  sleep 0.2
done
echo "Queued: Workdesk isn't answering, so it will add \"$title\" to its backlog the next time it's open."
