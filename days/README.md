# Days of the Year

A day for every date — national holidays, international observances and the
fun ones (Pancake Day, Spreadsheet Day…) — collected so Workdesk can show
"today is…" easter eggs. The goal is all 366 dates (Feb 29 included).

| File | What |
|---|---|
| `days.csv` | The data. One row per day; a date can have many rows. Fixed-date days only. |
| `movable.csv` | Days on a weekday rule (`name,rule,source`, e.g. "the third Saturday in October"). Kept for Phase 3, which will compute their date each year. |
| `days.html` | A simple viewer: table, filter box, today highlighted, coverage count. |
| `reports/` | October's per-date agent reports — reference for what the rules should produce. |
| `tools/` | The collection pipeline (below). |

View it locally (browsers block `fetch` over `file://`):

```sh
python3 -m http.server 8000 -d days   # from the repo root
open http://localhost:8000/days.html
```

## CSV format

```csv
date,name,source
10-17,Spreadsheet Day,https://www.checkiday.com/10/17/2026;https://www.daysoftheyear.com/days/oct/17/
10-17,Loyalty Day (Argentina),https://en.wikipedia.org/wiki/October_17
```

- `date` — `MM-DD`, zero-padded (`01-05`, `10-17`).
- `name` — the day's name as the sources write it. Wrap it in double quotes if
  it contains a comma; double any quote inside it (`""`).
- `source` — the full URL of every page you saw the day listed on (e.g.
  `https://www.checkiday.com/10/17/2026`), `;`-separated. For Wikipedia use
  the readable page (`https://en.wikipedia.org/wiki/October_17`), not the API
  URL you fetched it through.
  The viewer shows each as a link labelled with its site.
- Keep rows sorted by date. No duplicates on the same date (match names
  case-insensitively, ignoring a leading "National").

## The plan

### Phase 1 — national holidays
Official public holidays come from a calendar, not from scraping:
[`date-holidays`](https://github.com/commenthol/date-holidays) (offline, ~200
countries, computes movable holidays) is the intended source in the app, with
the Google/Apple public holiday ICS feeds as a cross-check. Wikipedia's per-date
pages also list national observances by country, which is how they get into
the CSV today.

### Phase 2 — a fun day for every date
Go date by date ("query today"), collecting from the sources below and keeping
only what passes the rules. Do January in full first to tune the picks, then
the remaining months.

### Phase 3 — wiring into Workdesk (later)
A `src/days.ts` built from the CSV: national holiday wins on a date, a fun day
is the secondary line. Shown in the Home header, an optional first-launch-of-
the-day toast, and holiday app-icon variants for the big ones. When picking
the one day to feature, prefer: dev/tech days → pop-culture → food/silly →
wholesome awareness. Never feature somber or memorial days.

## The pipeline (`tools/`)

Collection is scripted; a model is only used for the few calls a script can't
make. No LLM tokens are spent on downloading or matching.

| Step | Command | What it does |
|---|---|---|
| 1. Download | `python3 days/tools/fetch.py <dates>` | Fetches the 3 source pages per date into `days/.cache/`, one request at a time with backoff. Resumes; cached pages are skipped. A full year is ~1,100 requests (~25 min, a few in flight per site). |
| 2. Build | `python3 days/tools/build.py <dates>` | Parses the pages and applies the rules below. Writes `days/staging/MM.csv` (accepted rows) and `MM-review.csv` (calls to make), and merges new movable days into `movable.csv`. Fails loudly if a page yields nothing (layout change). |
| 3. Review | Haiku via `claude -p` (in `night.sh`), or you | Fills the `decision` column of each `MM-review.csv`: `include`, `rename: <name>` or `exclude`. Instructions: `tools/review-prompt.md`. Typically ~25 items a month. |
| 4. Apply | `python3 days/tools/apply.py <dates>` | Merges staged dates into `days.csv`. Dates already in `days.csv` are skipped unless `--force` (which replaces only those dates); undecided items block their month unless `--skip-undecided`. |

`<dates>` is `all`, `today`, a month (`11`), a date (`11-05`) or a range
(`11-01..11-07`). Feb 29 is included (Checkiday is read for 2028 for it).

**Overnight:** `days/tools/night.sh` (or `days/tools/night.sh 11`) runs all
four steps and logs to `days/.cache/night-*.log`. `REVIEW=0` skips the model
step and leaves review files for later.

### "Query today"

Run the four steps for `today` (or the named date), resolving the review file
yourself instead of calling `claude -p`. Then report what was added, the day
you'd feature for Workdesk, and anything left out and why.

### Sources

1. **Wikipedia** — "Holidays and observances" of the date's page, read via the
   API (`action=parse&prop=wikitext`). Cited as the readable page URL.
2. **Checkiday** — `https://www.checkiday.com/M/D/YYYY`. Each card states its
   rule: "Observed annually on October 17th" (fixed) or "Observed the third
   Saturday in October" (movable).
3. **Days of the Year** — `https://www.daysoftheyear.com/days/mon/DD/`
   (zero-padded day). Only the cards after "National days and holidays on" are
   that date; earlier cards are other dates.

`nationaldaycalendar.com` blocks fetches. Web-search summaries get dates wrong
— always read the pages.

### What goes in

- **Wikipedia observances** — international days and countries' national days,
  from one source. Country in parentheses when the name doesn't say it:
  `National Police Day (Thailand)`.
- **Fun / unofficial days** — only if **both** Checkiday and Days of the Year
  list it (filters out made-up days). Names are matched on their words, ignoring
  "National/International/World/Day", plurals, accents and ™.

### What stays out

- Christian feast days / saints' days.
- **Movable days** — anything Checkiday doesn't mark "annually on <date>"; they
  go to `movable.csv` with their rule, for Phase 3 to compute each year.
- Days only one fun-day site lists; multi-day events (weeks, months, date ranges).

### Notes for whoever edits the parser

- Use a plain User-Agent (`workdesk-days/1.0`) — never an email or other
  personal info. Wikipedia rate-limits bursts; `fetch.py` backs off.
- Test parser changes offline against the cached October pages
  (`build.py 10`) and compare with the hand-verified October rows in
  `days.csv` — it should come out at ~381 rows and ~21 review items (327 named exactly
  as the verified rows; most of the rest differ only in a country suffix).
- `reports/` holds the October agent reports, kept as reference for what the
  rules should produce.

## Progress

| Date | Added | Notes |
|---|---|---|
| October | 382 | All 31 dates, run by Haiku agents (one per date) and compiled/verified by Opus on 2026-10-17. Every row checked against the downloaded source pages; 27 movable days moved out using Checkiday's rules. 123 movable days in `movable.csv`. |
| Nov 1–3 | 52 | Pipeline trial run (`night.sh 11-01..11-03`) on 2026-10-20, Haiku review of 3 items. Spot-checked against the pages. |
| All other dates | 4,133 | Full pipeline run on 2026-10-21 (~30 min: parallel downloads, 12 parallel Haiku reviews). 366/366 dates, 4,567 rows total. Not hand-verified like October; spot-checked. |
