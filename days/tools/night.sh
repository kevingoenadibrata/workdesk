#!/usr/bin/env bash
# Overnight run of the days pipeline: download → build → review → apply.
#
#   days/tools/night.sh            # every date (months already in days.csv are left alone)
#   days/tools/night.sh 11         # one month
#   REVIEW=0 days/tools/night.sh   # skip the model step; review items wait in days/staging/
#
# Only the review step uses tokens: one `claude -p` (Haiku) call per month that has
# review items, all run in parallel. Everything else is plain Python. Safe to re-run; downloads resume.
set -uo pipefail
cd "$(dirname "$0")/../.."

SEL="${1:-all}"
LOG="days/.cache/night-$(date +%Y%m%d-%H%M).log"
mkdir -p days/.cache
exec > >(tee -a "$LOG") 2>&1
echo "== days pipeline: $SEL — $(date)"

echo "== 1/4 download"
python3 days/tools/fetch.py "$SEL" || echo "!! some downloads failed (listed above); continuing with what we have"

echo "== 2/4 build"
python3 days/tools/build.py "$SEL" || echo "!! some dates failed to parse (listed above); they're skipped"

echo "== 3/4 review"
if [ "${REVIEW:-1}" = 1 ] && command -v claude >/dev/null; then
  for f in days/staging/*-review.csv; do
    [ -e "$f" ] || continue
    grep -q ',$' "$f" || { echo "$f: already decided"; continue; }   # blank decision = trailing comma
    echo "-- reviewing $f"
    # all months at once; prompt via stdin (--allowedTools is variadic and would swallow a trailing prompt)
    ( { cat days/tools/review-prompt.md; printf '\nFile to review: %s\n' "$PWD/$f"; } \
        | claude -p --model haiku --permission-mode acceptEdits --allowedTools "Read,Edit" \
        | sed "s|^|[$(basename "$f" -review.csv)] |" \
        || echo "!! review of $f failed; its items stay undecided" ) &
  done
  wait
else
  echo "skipped (REVIEW=0 or claude not on PATH)"
fi

echo "== 4/4 apply"
python3 days/tools/apply.py "$SEL" --skip-undecided

echo "== done — $(date). Log: $LOG"
echo "Dates covered: $(tail -n +2 days/days.csv | cut -d, -f1 | sort -u | wc -l | tr -d ' ') / 366"
