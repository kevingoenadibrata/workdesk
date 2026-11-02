"""Shared helpers for the days pipeline: dates, paths, page parsing, name matching."""
import calendar
import csv
import datetime as dt
import html
import json
import re
import unicodedata
from pathlib import Path

DAYS = Path(__file__).resolve().parent.parent          # days/
CACHE = DAYS / ".cache"                                  # downloaded pages (gitignored)
STAGING = DAYS / "staging"                               # build output awaiting review/apply
DAYS_CSV = DAYS / "days.csv"
MOVABLE_CSV = DAYS / "movable.csv"

MONTHS = list(calendar.month_name)[1:]                   # January…
MON = [m[:3].lower() for m in MONTHS]                    # jan… (Days of the Year uses "sept")
MON[8] = "sept"

# Checkiday pages are per year. Any year works for fixed days; Feb 29 needs a leap year.
CHECKIDAY_YEAR = 2026
LEAP_YEAR = 2028


# ---------- dates ----------

def all_dates():
    """Every MM-DD of a leap year, so Feb 29 is included (366 dates)."""
    d, out = dt.date(2028, 1, 1), []
    while d.year == 2028:
        out.append(d.strftime("%m-%d"))
        d += dt.timedelta(days=1)
    return out


def select(spec):
    """'all' | 'today' | '10' (a month) | '10-19' (a date) | '10-01..10-07' -> list of MM-DD."""
    dates = all_dates()
    if spec == "all":
        return dates
    if spec == "today":
        return [dt.date.today().strftime("%m-%d")]
    if ".." in spec:
        a, b = spec.split("..")
        return [d for d in dates if a <= d <= b]
    if re.fullmatch(r"\d{1,2}", spec):
        return [d for d in dates if d.startswith(f"{int(spec):02d}-")]
    if re.fullmatch(r"\d{2}-\d{2}", spec) and spec in dates:
        return [spec]
    raise SystemExit(f"Unknown date selector: {spec!r} (use all, today, 10, 10-19 or 10-01..10-07)")


def urls(date):
    m, d = int(date[:2]), int(date[3:])
    year = LEAP_YEAR if date == "02-29" else CHECKIDAY_YEAR
    return {
        "wikipedia": f"https://en.wikipedia.org/wiki/{MONTHS[m - 1]}_{d}",
        "wiki_api": f"https://en.wikipedia.org/w/api.php?action=parse&page={MONTHS[m - 1]}_{d}"
                    "&prop=wikitext&format=json&formatversion=2",
        "checkiday": f"https://www.checkiday.com/{m}/{d}/{year}",
        "daysoftheyear": f"https://www.daysoftheyear.com/days/{MON[m - 1]}/{d:02d}/",
    }


def cache_paths(date):
    return {
        "wikipedia": CACHE / f"wiki-{date}.json",
        "checkiday": CACHE / f"ck-{date}.html",
        "daysoftheyear": CACHE / f"doty-{date}.html",
    }


# ---------- text ----------

def clean(s):
    s = html.unescape(re.sub(r"<[^>]+>", " ", s))
    return re.sub(r"\s+", " ", s.replace("​", "")).strip()


STOP = {"national", "international", "world", "global", "day", "the", "of", "a", "and", "s", "us", "u"}


def _stem(w):
    return w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w


def toks(name):
    """Comparable words of a day name: lowercase, unaccented, singular, no filler words, no parentheticals."""
    s = re.sub("[\u2122\u00ae\u00a9]", "", html.unescape(name))          # ™ ® ©
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower().replace("&", " and ").replace("'", "")
    s = re.sub(r"\(.*?\)", " ", s)
    return frozenset(_stem(w) for w in re.findall(r"[a-z0-9]+", s) if w not in STOP)


def same_day(a_names, b_names):
    """True if any name of A clearly names the same day as any name of B (one's words ⊆ the other's)."""
    for a in a_names:
        for b in b_names:
            ta, tb = toks(a), toks(b)
            if ta and tb and (ta <= tb or tb <= ta):
                return True
    return False


def similarity(a_names, b_names):
    best = 0.0
    for a in a_names:
        for b in b_names:
            ta, tb = toks(a), toks(b)
            if ta and tb:
                best = max(best, len(ta & tb) / len(ta | tb))
    return best


# ---------- page parsers ----------

class ParseError(Exception):
    pass


def parse_checkiday(page):
    """Single-day cards -> [{name, aka: [...], rule}]. rule is the 'Observed …' text, '' if absent."""
    page = re.split(r"Multi-day Events (?:Continuing|Starting)", page)[0]
    out = []
    for card in page.split('<div class="holiday mdl-card')[1:]:
        m = re.search(r'<h2 class="mdl-card__title-text">(.*?)</h2>', card, re.S)
        if not m:
            continue
        name = clean(m.group(1))
        sup = re.search(r'<div class="mdl-card__supporting-text"[^>]*>(.*?)</div>', card, re.S)
        sup = clean(sup.group(1)) if sup else ""
        aka = re.search(r"Also known as (.+?)(?= Observed |$)", sup)
        aka = [a.strip() for a in re.split(r",\s*|\s+and\s+", aka.group(1))] if aka else []
        rule = re.search(r"Observed (.+)$", sup)
        out.append({"name": name, "aka": [a for a in aka if a], "rule": rule.group(1).strip() if rule else ""})
    if not out:
        raise ParseError("no Checkiday cards found — has the page layout changed?")
    return out


def parse_doty(page):
    """Cards under 'National days and holidays on <date>' -> [name]. Earlier cards are other dates."""
    i = page.find("National days and holidays on")
    if i < 0:
        raise ParseError("Days of the Year heading not found — has the page layout changed?")
    j = page.find('<h2 class="heading', i + 10)
    section = page[i:j if j > 0 else None]
    names = [clean(n) for n in re.findall(r'class="card__title"><a [^>]*>(.*?)</a>', section, re.S)]
    if not names:
        raise ParseError("no Days of the Year cards found — has the page layout changed?")
    return names


def is_movable(rule):
    """Checkiday writes 'annually on October 17th' for fixed days; anything else is a weekday/lunar rule."""
    return bool(rule) and not rule.lower().startswith("annually on")


FEAST = re.compile(r"feast day|feast of|liturgics|martyrology", re.I)
# Not single-day observances: week/season starts, fiscal years, one-off year-specific entries.
NOT_A_DAY = re.compile(r"\bweek\b|fiscal year|\bseason\b|\(\d{4}\)|^beginning of|^the beginning of"
                       r"|\d+\s*[–-]\s*\d+|^earliest day|^latest day", re.I)  # date ranges = multi-day
# Parent lines that are categories, whose sub-bullets are complete names on their own.
CATEGORY = re.compile(r"related|observances|commemorations|celebrations|holidays", re.I)


def _strip_markup(s):
    s = re.sub(r"<ref[^>]*/>", "", s)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"\{\{\s*flag(?:u|country|icon)?\s*\|([^|}]+)[^}]*\}\}", r"\1", s, flags=re.I)
    s = re.sub(r"\{\{([A-Z]{3})\}\}", r"\1", s)                     # {{TWN}} country codes
    s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    s = re.sub(r"\[https?://\S+[^\]]*\]", "", s)                     # external links
    return re.sub(r"'{2,}", "", s)


def _wikitext_to_text(s):
    return clean(re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", _strip_markup(s)))


def _cut_description(s):
    """Keep the name part: cut at the first ', ' / ' or ' / dash that is outside parentheses."""
    depth = 0
    for i, ch in enumerate(s):
        depth += ch == "("
        depth -= ch == ")"
        if depth == 0 and (s.startswith(", ", i) or s.startswith(" or ", i) or s.startswith(" – ", i)
                           or s.startswith(" — ", i) or s.startswith(" - ", i)):
            return s[:i]
    return s


def _wiki_name(body):
    """'[[Independence Day (Cyprus)|Independence Day]], celebrates …' -> 'Independence Day (Cyprus)'."""
    full = _strip_markup(body).strip()
    body = _cut_description(full)
    _wiki_name.was_cut = body != full
    # A lone link whose target carries the disambiguator: prefer the target.
    m = re.fullmatch(r"\[\[([^|\]]+)\|([^\]]+)\]\](.*)", body.strip())
    if m and "(" in m.group(1) and "(" not in m.group(2):
        body = f"[[{m.group(1)}]]{m.group(3)}"
    name = _wikitext_to_text(body).strip(" ,;:")
    # '[[Calan Gaeaf]], celebrations start … ([[Wales]])': the cut dropped the country at the end
    tail = re.search(r"\(([^()]+)\)\W*$", full)
    where = _wikitext_to_text(tail.group(1)) if tail else ""
    if _wiki_name.was_cut and "(" not in name and where and not re.search(r"\d|^international$|^worldwide$", where, re.I):
        name += f" ({where})"
    return name


def parse_wikipedia(raw_json):
    """'Holidays and observances' -> [{name, raw}] with feast days removed.

    A top-level line ending in ':' (e.g. 'Independence Day:') takes its sub-bullets
    as 'Parent (Child)'. Lines that still look messy are flagged for review by build.py.
    """
    text = json.loads(raw_json)["parse"]["wikitext"]
    i = text.find("Holidays and observances")
    if i < 0:
        raise ParseError("Wikipedia 'Holidays and observances' section not found")
    section = text[i:text.find("\n==", i + 30) if text.find("\n==", i + 30) > 0 else None]
    out, parent, skip_children = [], None, False
    for line in section.splitlines():
        if re.match(r"^\*\s*[^*]", line):
            body = line.lstrip("*").strip()
            skip_children = bool(FEAST.search(body))
            parent = _wiki_name(body.rstrip().rstrip(":")) if body.rstrip().endswith(":") else None
            parent_is_category = parent is not None and bool(CATEGORY.search(body))
            # 'All Saints' Day, a holy day …, and its related observance:' is a day itself
            if parent is not None and _wiki_name.was_cut and not FEAST.search(body):
                out.append({"name": parent, "raw": line, "unsure": False})
            if skip_children or parent is not None:
                continue
            name = _wiki_name(body)
            # 'Independence Day, celebrates … [[Uganda]] …' lost its country when cut: needs a human/model
            out.append({"name": name, "raw": line, "unsure": _wiki_name.was_cut and "(" not in name})
        elif re.match(r"^\*\*", line):
            if skip_children or parent is None:
                continue
            child = _wiki_name(line.lstrip("*").strip())
            if parent_is_category or "(" in child or len(toks(child)) > 1:
                name = child                                       # a full name on its own
            else:
                name = f"{parent} ({child})"                       # 'Independence Day' + 'Palau'
            out.append({"name": name, "raw": line, "unsure": False})
    for o in out:                                   # '(International)' says nothing a reader needs
        o["name"] = re.sub(r"\s*\((?:international(?: observance)?|worldwide)\)$", "", o["name"], flags=re.I)
    return [o for o in out if o["name"] and not NOT_A_DAY.search(o["name"])]


# ---------- csv io ----------

def read_csv(path):
    if not Path(path).exists():
        return []
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def write_csv(path, fieldnames, rows):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
