#!/usr/bin/env python3
"""Merge staged months into days/days.csv.

    python3 days/tools/apply.py all                     # every staged month
    python3 days/tools/apply.py 11 --skip-undecided     # apply what's decided, leave the rest

Review decisions (days/staging/MM-review.csv, `decision` column):
    include            add it as named
    rename: New Name   add it under New Name
    exclude            drop it
    (blank)            undecided — its month is refused unless --skip-undecided

Dates that already have rows in days.csv are skipped (done before) unless
--force, which replaces just those dates' rows. Other dates are never touched.
"""
import argparse
import re
import sys

from common import DAYS_CSV, STAGING, read_csv, select, write_csv


def dedupe(rows):
    """Same name twice on a date (e.g. Earth Day from Wikipedia and from the fun-day
    sites): keep the first row and merge the other's sources into it."""
    seen, out = {}, []
    for r in rows:
        key = (r["date"], re.sub(r"^national ", "", r["name"].strip().lower()))
        if key in seen:
            srcs = seen[key]["source"].split(";")
            seen[key]["source"] = ";".join(srcs + [s for s in r["source"].split(";") if s not in srcs])
        else:
            seen[key] = r
            out.append(r)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dates", help="all | today | 10 | 10-19 | 10-01..10-07")
    ap.add_argument("--skip-undecided", action="store_true")
    ap.add_argument("--force", action="store_true", help="replace dates already in days.csv")
    args = ap.parse_args()

    wanted = set(select(args.dates))
    months = sorted({d[:2] for d in wanted})
    current = read_csv(DAYS_CSV)
    done = {r["date"] for r in current}
    problems = []

    for mm in months:
        staged = STAGING / f"{mm}.csv"
        if not staged.exists():
            continue
        rows = [r for r in read_csv(staged) if r["date"] in wanted]
        undecided = 0
        for r in read_csv(STAGING / f"{mm}-review.csv"):
            if r["date"] not in wanted:
                continue
            d = r["decision"].strip()
            if d.lower() == "include":
                rows.append({"date": r["date"], "name": r["name"], "source": r["source"]})
            elif d.lower().startswith("rename:"):
                rows.append({"date": r["date"], "name": d.split(":", 1)[1].strip(), "source": r["source"]})
            elif d.lower() == "exclude":
                pass
            else:
                undecided += 1
        if undecided and not args.skip_undecided:
            problems.append(f"{mm}: {undecided} undecided review items")
            continue
        dates = {r["date"] for r in rows}
        skipped = sorted(dates & done) if not args.force else []
        rows = [r for r in rows if r["date"] not in skipped]
        dates -= set(skipped)
        current = [r for r in current if r["date"] not in dates] + rows
        msg = f"{mm}: applied {len(rows)} rows on {len(dates)} dates"
        if skipped:
            msg += f"; {len(skipped)} dates already in days.csv skipped (use --force to replace)"
        if undecided:
            msg += f" ({undecided} undecided left out)"
        print(msg)

    current = dedupe(current)
    current.sort(key=lambda r: r["date"])                  # stable: keeps order within a date
    write_csv(DAYS_CSV, ["date", "name", "source"], current)
    if problems:
        print("\nNot applied:", *problems, sep="\n  ", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
