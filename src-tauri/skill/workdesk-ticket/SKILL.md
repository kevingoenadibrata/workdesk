---
name: workdesk-ticket
description: Write a ticket into Workdesk's own backlog (a WD-n ticket on Workdesk's Home board). Use when the user asks to "write a ticket", "make a Workdesk ticket", "add this to the backlog", "file a follow-up", "ticket this for later", or when work is found that should be done separately from the current task and the user agrees it should be ticketed.
---

# Write a Workdesk ticket

Workdesk keeps its own tickets (ids like `WD-12`) on this Mac. This skill adds one to its backlog, where the user can start a session on it from Home.

Run the bundled script, with the description on stdin:

```bash
{{DIR}}/new-ticket.sh --title "Fix the login redirect loop" <<'EOF'
What's wrong, what done looks like, and anything the next agent needs:
file paths, error text, steps to reproduce.
EOF
```

- `--title` (required): one line, short and specific, written as the thing to do.
- `--project NAME` (optional): the project it belongs to. By default it's the current git repository's name, and the ticket is linked to that repository so a session started from it opens there. Only set it when the ticket is for a different project.
- The description is Markdown. Write it so someone with no context could pick it up: say why, not just what. Leave it empty only for a self-explanatory title.

The script prints the new ticket's id (`Created WD-31: …`). If Workdesk isn't running, it says the ticket is queued: Workdesk adds it the next time it opens. Either outcome is a success; tell the user the id, or that it's queued.

## Rules

- Write a ticket only when the user asked for one, or agreed to one you proposed. Don't file tickets on your own initiative.
- One ticket per piece of work. Several tickets mean several runs of the script.
- Don't put secrets, tokens or passwords in a ticket.
- This writes Workdesk's own tickets only. For GitHub issues, Linear or ClickUp, use those services' own tools.
