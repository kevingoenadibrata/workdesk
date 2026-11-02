# 10-29 — Haiku report

Status: success

## CSV entries
```csv
10-29,Coronation Day (Cambodia),https://en.wikipedia.org/wiki/October_29
10-29,National Cat Day (United States),https://en.wikipedia.org/wiki/October_29;https://www.checkiday.com/10/29/2026;https://www.daysoftheyear.com/days/oct/29/
10-29,Republic Day (Turkey),https://en.wikipedia.org/wiki/October_29
10-29,International Internet Day,https://www.checkiday.com/10/29/2026;https://www.daysoftheyear.com/days/oct/29/
10-29,National Hermit Day,https://www.checkiday.com/10/29/2026;https://www.daysoftheyear.com/days/oct/29/
10-29,National Oatmeal Day,https://www.checkiday.com/10/29/2026;https://www.daysoftheyear.com/days/oct/29/
10-29,World Psoriasis Day,https://www.checkiday.com/10/29/2026;https://www.daysoftheyear.com/days/oct/29/
10-29,World Stroke Day,https://www.checkiday.com/10/29/2026;https://www.daysoftheyear.com/days/oct/29/
```

## Left out
- International Carignan Day — movable (Checkiday: observed the last Thursday in October; Oct 29 2026 is that Thursday). Single source anyway.
- National Chocolate Cupcake Day — single source (Days of the Year only)
- National No Beard Day — single source (Days of the Year only)
- World Toy Camera Day — single source (Days of the Year only)
- World Menopause Day — single source (Days of the Year only). Checkiday's "World Menopause Month" is a multi-day entry, not the same day.
- RSPB Feed the Birds Day — single source (Days of the Year only)
- National Bandana Day — single source (Days of the Year only)
- World Ballet Day — single source (Days of the Year only)
- International Day of Care and Support — single source (Days of the Year only)
- Truffle Days in Croatia — single source (Days of the Year only); also a multi-day festival
- Christian feast days/saints on the Wikipedia list (Abraham of Rostov, Blessed Chiara Badano, Colman mac Duagh, Douai Martyrs, Gaetano Errico, James Hannington, Michele Rua, Narcissus of Jerusalem, Theuderius, October 29 (Eastern Orthodox liturgics)) — feast day
- Checkiday multi-day entries (Disarmament Week, National Massage Therapy Awareness Week, and the many October-long "Month" entries, plus year-long items) — multi-day

## Unsure
None

## Findings
### Wikipedia
Source: parsed via the API for page October_29 (one attempt was rate-limited; a retry with a User-Agent header after a short wait succeeded). The CSV uses https://en.wikipedia.org/wiki/October_29 as the page URL.
- Christian feast day section: Abraham of Rostov, Blessed Chiara Badano, Colman mac Duagh, Douai Martyrs, Gaetano Errico, James Hannington (Anglicanism), Michele Rua, Narcissus of Jerusalem, Theuderius, October 29 (Eastern Orthodox liturgics) — skipped (feast days)
- Coronation Day (Cambodia) — included
- National Cat Day (United States) — included; also on Checkiday and Days of the Year
- Republic Day (Turkey) — included

### Checkiday
Source: https://www.checkiday.com/10/29/2026 (fetched in full with curl; no truncation). Single-day list for Thursday, October 29th, 2026, 7 entries:
- International Carignan Day (observed the last Thursday in October)
- International Internet Day
- National Cat Day
- National Hermit Day
- National Oatmeal Day
- World Psoriasis Day
- World Stroke Day

Multi-day entries also on the page (excluded): Disarmament Week, National Massage Therapy Awareness Week, many October-long "Month" entries, and year-long items.

### Days of the Year
Source: https://www.daysoftheyear.com/days/oct/29/ (fetched in full with curl). Days listed for October 29:
- National Chocolate Cupcake Day
- National No Beard Day
- World Toy Camera Day
- World Menopause Day
- RSPB Feed the Birds Day
- National Cat Day
- National Internet Day
- World Stroke Day
- World Psoriasis Day
- National Oatmeal Day
- National Bandana Day
- World Ballet Day
- International Day of Care and Support
- National Hermit Day
- Truffle Days in Croatia (under "Other holidays")
