#!/usr/bin/env python3
"""Download the three source pages for each date into days/.cache/ (no LLM involved).

    python3 days/tools/fetch.py all          # every date; already-cached pages are skipped
    python3 days/tools/fetch.py 11           # one month
    python3 days/tools/fetch.py today --force

A few requests in flight per site (WORKERS), each worker pausing between requests,
a plain User-Agent (never personal info), and backoff on rate limits / timeouts. Safe to stop and re-run: it resumes.
"""
import argparse
import json
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from common import CACHE, cache_paths, select, urls

UA = "workdesk-days/1.0"
PAUSE = 1.0
WORKERS = {"wikipedia": 2, "checkiday": 6, "daysoftheyear": 3}   # parallel requests per site


def get(url, tries=6):
    delay = 5
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=25) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < tries:
                time.sleep(delay)
                delay *= 2
                continue
            raise
        except urllib.error.URLError:
            if attempt < tries:
                time.sleep(delay)
                delay *= 2
                continue
            raise


def valid(source, body):
    if source == "wikipedia":
        try:
            return "wikitext" in json.loads(body).get("parse", {})
        except ValueError:
            return False            # rate-limit pages come back as non-JSON
    return len(body) > 5000


def fetch_one(source, url, path):
    body = get(url)
    if not valid(source, body):                # one slow retry for soft rate-limits
        time.sleep(30)
        body = get(url)
    if not valid(source, body):
        raise RuntimeError("unexpected response")
    path.write_bytes(body)
    time.sleep(PAUSE)                          # per worker, so each site sees a steady trickle


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dates", help="all | today | 10 | 10-19 | 10-01..10-07")
    ap.add_argument("--force", action="store_true", help="re-download even if cached")
    args = ap.parse_args()

    CACHE.mkdir(exist_ok=True)
    dates = select(args.dates)
    jobs = {source: [] for source in WORKERS}
    left = {}
    for date in dates:
        u, paths = urls(date), cache_paths(date)
        left[date] = 0
        for source, path in paths.items():
            if path.exists() and not args.force:
                continue
            url = u["wiki_api"] if source == "wikipedia" else u[source]
            jobs[source].append((date, url, path))
            left[date] += 1

    failed, lock, done = [], threading.Lock(), [sum(1 for d in dates if not left[d])]
    total = len(dates)
    if done[0]:
        print(f"[{done[0]}/{total}] already cached", flush=True)

    def finish(date, source, err):
        with lock:
            if err:
                failed.append(f"{date} {source}: {err}")
            left[date] -= 1
            if not left[date]:
                done[0] += 1
                print(f"[{done[0]}/{total}] {date}", flush=True)

    def run(source, date, url, path):
        try:
            fetch_one(source, url, path)
            finish(date, source, None)
        except Exception as e:                  # keep going; build.py reports what's missing
            finish(date, source, e)

    # One pool per site: several requests in flight to each, so a slow response
    # (Checkiday often stalls 20s+) overlaps with the others instead of queueing.
    pools = [ThreadPoolExecutor(WORKERS[s]) for s in jobs]
    for pool, (source, items) in zip(pools, jobs.items()):
        for date, url, path in items:
            pool.submit(run, source, date, url, path)
    for pool in pools:
        pool.shutdown(wait=True)

    if failed:
        print("\nFailed (re-run to retry):", *failed, sep="\n  ", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
