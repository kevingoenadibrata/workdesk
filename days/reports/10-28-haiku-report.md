# 10-28 — Haiku report

Status: unsure

## CSV entries
```csv
10-28,Day of the Establishment of an Independent Czecho-Slovak State (Czech Republic),https://en.wikipedia.org/wiki/October_28;https://www.daysoftheyear.com/days/oct/28/
10-28,International Animation Day,https://en.wikipedia.org/wiki/October_28;https://www.checkiday.com/10/28/2026;https://www.daysoftheyear.com/days/oct/28/
10-28,Ohi Day (Greece),https://en.wikipedia.org/wiki/October_28
10-28,Youth Pledge Day (Indonesia),https://en.wikipedia.org/wiki/October_28
10-28,Liberation Day (Ukraine),https://en.wikipedia.org/wiki/October_28
10-28,National First Responders Day,https://www.checkiday.com/10/28/2026;https://www.daysoftheyear.com/days/oct/28/
10-28,National Chocolate Day,https://www.checkiday.com/10/28/2026;https://www.daysoftheyear.com/days/oct/28/
10-28,National Internal Medicine Day,https://www.checkiday.com/10/28/2026;https://www.daysoftheyear.com/days/oct/28/
10-28,Plush Animal Lover's Day,https://www.checkiday.com/10/28/2026;https://www.daysoftheyear.com/days/oct/28/
10-28,Wild Foods Day,https://www.checkiday.com/10/28/2026;https://www.daysoftheyear.com/days/oct/28/
```

## Left out
- Lung Health Day — movable (fourth Wednesday of October; Oct 28 2026 is that Wednesday). Also single source (Checkiday only).
- Separation of Church and State Day — single source (Checkiday only)
- Statue of Liberty Dedication Day — single source (Checkiday only)
- Chucks-N-Pearls Day — single source (Days of the Year only)
- National Immigrants Day — single source (Days of the Year only)
- St. Jude's Feast Day — feast day
- Christian feast days/saints on the Wikipedia list (Abdias of Babylon, Abgar V of Edessa, Eadsige, Faro, Fidelis of Como, Firmilian, Godwin of Stavelot, Job of Pochayiv, Simon and Jude, Lord of Miracles (Lima), October 28 (Eastern Orthodox liturgics)) — feast day
- Prefectural Earthquake Disaster Prevention Day (Gifu Prefecture) — sub-national observance, see Unsure
- Multi-day events on Checkiday and Days of the Year (Disarmament Week, National Massage Therapy Awareness Week, Global Media and Information Literacy Week, the month-long observances, the UN decades, etc.) — multi-day

## Unsure
- Prefectural Earthquake Disaster Prevention Day (Gifu Prefecture) — a Wikipedia observance, but it is prefecture-level rather than national or international, so I left it out. Please decide whether regional days belong in the dataset.
- Liberation Day (Ukraine) — included as a national observance from Wikipedia. The Wikipedia entry is an anniversary of liberation from Nazi occupation, not a memorial day, but it is commemorative in tone. Please confirm.
- Name match for National First Responders Day — Checkiday lists it as "Honoring the Nation's First Responders Day" (also known as National First Responders Day) and Days of the Year as "National First Responders Day". Same day, so merged under the Days of the Year name.

## Findings
### Wikipedia
Source: parsed via the API for page October_28 (one rate-limited attempt, then succeeded after a short wait with a User-Agent header). The CSV uses https://en.wikipedia.org/wiki/October_28 as the page URL.
- Day of the Establishment of an Independent Czecho-Slovak State (Czech Republic and Slovakia) — included; also on Days of the Year as "Czech Independence Day"
- International Animation Day (ASIFA) — included; also on Checkiday and Days of the Year
- Ohi Day (Greece, Cyprus and Greek communities) — included
- Prefectural Earthquake Disaster Prevention Day (Gifu Prefecture) — not included, see Unsure
- Youth Pledge Day / Hari Sumpah Pemuda (Indonesia) — included
- Anniversary of the liberation of Ukraine from the Nazis (Liberation Day (Ukraine)) — included, see Unsure
- Christian feast days and saints — skipped

### Checkiday
Source: https://www.checkiday.com/10/28/2026 (fetched with curl, full page, no truncation). Single-day list for Wednesday, October 28th, 2026, 10 entries:
- Honoring the Nation's First Responders Day (also known as National First Responders Day)
- International Animation Day
- Lung Health Day (observed the fourth Wednesday in October)
- National Chocolate Day
- National Internal Medicine Day
- Plush Animal Lover's Day
- Separation of Church and State Day
- St. Jude's Feast Day
- Statue of Liberty Dedication Day
- Wild Foods Day

### Days of the Year
Source: https://www.daysoftheyear.com/days/oct/28/ (fetched with curl, full page). Lists 9 national days:
- International Animation Day
- Plush Animal Lover's Day
- Chucks-N-Pearls Day
- National Chocolate Day
- National First Responders Day
- Wild Foods Day
- National Immigrants Day
- National Internal Medicine Day
- Czech Independence Day

Matched with Checkiday (both sources): International Animation Day, National First Responders Day, National Chocolate Day, National Internal Medicine Day, Plush Animal Lover's Day, Wild Foods Day.
