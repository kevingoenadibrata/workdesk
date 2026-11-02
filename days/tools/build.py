#!/usr/bin/env python3
"""Turn cached pages into rows, deterministically. Writes per month into days/staging/:

    MM.csv          rows accepted automatically            (date,name,source)
    MM-review.csv   the few calls a model or human must make (decision column blank)

and merges newly found movable days into days/movable.csv.

    python3 days/tools/build.py all
    python3 days/tools/build.py 11

Rules (see README "What goes in"):
  - Wikipedia observances go in (feast days dropped). Messy lines -> review.
  - Fun days go in when BOTH Checkiday and Days of the Year list them.
  - Checkiday days whose rule isn't "annually on <date>" are movable -> movable.csv.
  - Names that are close but not clearly the same across the two sites -> review.
"""
import argparse
import re
import sys
from collections import defaultdict

from common import (MOVABLE_CSV, STAGING, ParseError, cache_paths, is_movable, parse_checkiday,
                    parse_doty, parse_wikipedia, read_csv, same_day, select, similarity, toks, urls,
                    write_csv)

FEAST_FUN = re.compile(r"\bfeast\b|\bsaint\b|\bst\. |guardian angel", re.I)   # religious feasts, not fun days
NEAR = 0.4          # word overlap that's worth a second look


def build_date(date):
    p, u = cache_paths(date), urls(date)
    missing = [s for s, path in p.items() if not path.exists()]
    if missing:
        raise ParseError(f"not downloaded: {', '.join(missing)} (run fetch.py)")
    ck = parse_checkiday(p["checkiday"].read_text(errors="replace"))
    doty = parse_doty(p["daysoftheyear"].read_text(errors="replace"))
    wiki = parse_wikipedia(p["wikipedia"].read_text())

    rows, review, movable = [], [], []
    ck_fixed = [c for c in ck if not is_movable(c["rule"]) and not FEAST_FUN.search(c["name"])]
    for c in ck:
        if is_movable(c["rule"]):
            movable.append({"name": c["name"], "rule": c["rule"], "source": u["checkiday"]})

    def names(c):
        return [c["name"], *c["aka"]]

    # Wikipedia observances
    for w in wiki:
        name = w["name"]
        src = [u["wikipedia"]]
        # credit the fun-day sites too when they list the same thing
        if any(toks_equal(name, names(c)) for c in ck_fixed):
            src.append(u["checkiday"])
        if any(toks_equal(name, [d]) for d in doty):
            src.append(u["daysoftheyear"])
        if messy(name) or w["unsure"]:
            review.append(item(date, "wiki-cleanup", name, w["raw"].strip()[:300], src,
                               "Wikipedia line didn't parse cleanly. Rename to a clean day name, or exclude."))
        else:
            rows.append({"date": date, "name": name, "source": ";".join(src)})

    taken = {r["name"].lower() for r in rows}

    # Fun days: on both Checkiday and Days of the Year
    used_doty = set()
    for c in ck_fixed:
        hit = next((d for d in doty if same_day(names(c), [d])), None)
        if hit:
            used_doty.add(hit)
            if c["name"].lower() not in taken and not any(toks_equal(c["name"], [r["name"]]) for r in rows):
                rows.append({"date": date, "name": c["name"],
                             "source": f'{u["checkiday"]};{u["daysoftheyear"]}'})
            continue
        near = max(doty, key=lambda d: similarity(names(c), [d]), default=None)
        if near and similarity(names(c), [near]) >= NEAR:
            used_doty.add(near)
            review.append(item(date, "near-match", c["name"], f'Checkiday: "{c["name"]}" / Days of the Year: "{near}"',
                               [u["checkiday"], u["daysoftheyear"]],
                               "Same day on both sites? include (optionally rename) or exclude."))
    return rows, review, movable


def toks_equal(name, others):
    """Stricter than same_day: identical words, for crediting extra sources to a Wikipedia row."""
    return any(toks(name) == toks(o) and toks(name) for o in others)


def messy(name):
    return (any(ch in name for ch in "{}[]|<>=\"") or len(name) > 70 or name.count("(") > 1
            or re.search(r"celebrat|anniversary of|in honou?r|also known|formerly", name, re.I))


def item(date, kind, name, detail, sources, question):
    return {"date": date, "kind": kind, "name": name, "detail": detail,
            "source": ";".join(sources), "question": question, "decision": ""}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dates", help="all | today | 10 | 10-19 | 10-01..10-07")
    args = ap.parse_args()

    STAGING.mkdir(exist_ok=True)
    by_month_rows, by_month_review = defaultdict(list), defaultdict(list)
    new_movable, errors = [], []
    for date in select(args.dates):
        try:
            rows, review, movable = build_date(date)
        except (ParseError, KeyError, ValueError) as e:
            errors.append(f"{date}: {e}")
            continue
        by_month_rows[date[:2]] += rows
        by_month_review[date[:2]] += review
        new_movable += movable

    for mm, rows in by_month_rows.items():
        write_csv(STAGING / f"{mm}.csv", ["date", "name", "source"], rows)
        review = by_month_review[mm]
        path = STAGING / f"{mm}-review.csv"
        if review:
            write_csv(path, ["date", "kind", "name", "detail", "source", "question", "decision"], review)
        elif path.exists():
            path.unlink()
        print(f"{mm}: {len(rows)} rows, {len(review)} to review", flush=True)

    # merge movable days (dedupe by name)
    existing = {r["name"].lower(): r for r in read_csv(MOVABLE_CSV)}
    for m in new_movable:
        existing.setdefault(m["name"].lower(), m)
    write_csv(MOVABLE_CSV, ["name", "rule", "source"], sorted(existing.values(), key=lambda r: r["name"].lower()))

    if errors:
        print("\nErrors (these dates were skipped):", *errors, sep="\n  ", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
