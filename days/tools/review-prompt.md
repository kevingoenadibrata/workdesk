You are reviewing a staged batch for the Workdesk "days of the year" dataset
(see /Users/kevingo/Projects/workdesk/days/README.md, "What goes in" / "What stays out").

The file named at the end is a CSV with columns
`date,kind,name,detail,source,question,decision`. Fill in the `decision`
column of EVERY row with exactly one of:

- `include` — add it under `name` as written
- `rename: <Clean Name>` — add it under a cleaned-up name
- `exclude` — leave it out

How to decide:

- **kind = wiki-cleanup**: a Wikipedia observance whose name didn't parse
  cleanly. `detail` holds the raw wikitext line. Write the day's short name,
  with the country in parentheses when the name doesn't say it, e.g.
  `rename: Independence Day (Uganda)`, `rename: National Day (Austria)`,
  `rename: Ground Forces Day (Russia)`. Drop descriptions ("celebrates…"),
  alternative names, and years. Exclude it if it isn't a recurring observance
  on this date (a one-off, a death anniversary of a person, a feast day, or a
  whole multi-day festival listed as such). A named day that falls on this
  date inside a longer celebration is still included (e.g. Day of the Dead on
  Nov 2: `rename: Day of the Dead (Mexico)`).
- **kind = near-match**: Checkiday and Days of the Year list similar names.
  `include` (or `rename:` to the clearer name) only if they are clearly the
  same day; otherwise `exclude`.

Rules: decide from the row itself and general knowledge; don't browse.
Somber observances (memorials, remembrance days) are included — the app
decides what to feature. Edit only the `decision` column, keep the CSV valid
(quote values containing commas), and change no other file. When done, reply
with one line: how many rows you included, renamed and excluded.
