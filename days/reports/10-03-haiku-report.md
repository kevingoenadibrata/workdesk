# 10-03 — Haiku report

Status: success

## CSV entries
```csv
10-03,"3 October Festival (Leiden, Netherlands)",https://en.wikipedia.org/wiki/October_3
10-03,German Unity Day,https://en.wikipedia.org/wiki/October_3
10-03,Mean Girls Day,https://en.wikipedia.org/wiki/October_3;https://www.checkiday.com/10/3/2026;https://www.daysoftheyear.com/days/oct/03/
10-03,Morazán Day (Honduras),https://en.wikipedia.org/wiki/October_3
10-03,National Day (Iraq),https://en.wikipedia.org/wiki/October_3
10-03,National Foundation Day (South Korea),https://en.wikipedia.org/wiki/October_3
10-03,National Boyfriend Day,https://www.checkiday.com/10/3/2026;https://www.daysoftheyear.com/days/oct/03/
10-03,National Techies Day,https://www.checkiday.com/10/3/2026;https://www.daysoftheyear.com/days/oct/03/
10-03,International Frugal Fun Day,https://www.checkiday.com/10/3/2026;https://www.daysoftheyear.com/days/oct/03/
10-03,National Virus Appreciation Day,https://www.checkiday.com/10/3/2026;https://www.daysoftheyear.com/days/oct/03/
10-03,World Card Making Day,https://www.checkiday.com/10/3/2026;https://www.daysoftheyear.com/days/oct/03/
```

## Left out
- Digital Scrapbooking Day — single source (Checkiday only)
- Global Smoothie Day — single source (Checkiday only)
- Inter-American Water Day — single source (Checkiday only)
- Look at the Leaves Day — single source (Checkiday only)
- National Butterfly and Hummingbird Day — single source (Checkiday only)
- National Caramel Custard Day — single source (Checkiday only)
- National Family TV Show Day — single source (Checkiday only)
- National Soft Taco Day — single source (Checkiday only)
- Shemini Atzeret — movable (Hebrew calendar date) and a religious holiday, not a fun day; single source (Checkiday only)
- National No Sugar Day — single source (Days of the Year only)
- National Mead Day — single source (Days of the Year only)
- Buy British Day — single source (Days of the Year only)
- Wales International Film Festival — single source (Days of the Year only); festival
- World Temperance Day — single source (Days of the Year only)
- World Romance Scam Prevention Day — single source (Days of the Year only)
- International Crumhorn Day — single source (Days of the Year only)
- National Wide Awakes Day — single source (Days of the Year only)
- British Carrot Awareness Day — single source (Days of the Year only)
- Christian feast days/saints on the Wikipedia list (Abd-al-Masih, Adalgott, Dionysius the Areopagite, Gerard of Brogne, Théodore Guérin, etc.) — feast days, skipped

## Unsure
None

## Findings
### Wikipedia
Source: parsed via the API for page October_3; the CSV uses https://en.wikipedia.org/wiki/October_3 as the page URL.
- 3 October Festival (Leiden, Netherlands) — included
- German Unity Day (Germany) — included
- Mean Girls Day (Cultural impact section) — included; also on Checkiday and Days of the Year
- Morazán Day (Honduras) — included
- National Day (Iraq) — included
- National Foundation Day / Gaecheonjeol (South Korea) — included as "National Foundation Day (South Korea)"
- Christian feast day list (saints, Blessed, Eastern Orthodox liturgics link) — skipped

### Checkiday
Source: https://www.checkiday.com/10/3/2026 (fetched OK). The "Holidays for Saturday, October 3rd, 2026" list has 16 entries, of which 15 are days and "On This Day in History" is a feature, not a day:
- Digital Scrapbooking Day
- Global Smoothie Day
- Inter-American Water Day
- International Frugal Fun Day
- Look at the Leaves Day
- Mean Girls Appreciation Day
- National Boyfriend Day
- National Butterfly and Hummingbird Day
- National Caramel Custard Day
- National Family TV Show Day
- National Soft Taco Day
- National Techies Day
- National Virus Appreciation Day
- Shemini Atzeret
- World Card Making Day
- On This Day in History (not a day)

The later part of the page (fetched at offset 100000) holds month-long and multi-year observances (National Pasta Month, Hispanic Heritage Month, UN decades, etc.), which are multi-day and were not used. A separate "Multi-day Events Continuing on Saturday, October 3rd" section was also not used.

### Days of the Year
Source: https://www.daysoftheyear.com/days/oct/03/ (the /days/oct/3/ variant returned 404). Lists 15 national days:
- National Boyfriend Day
- National No Sugar Day
- National Techies Day
- Mean Girls Day
- National Mead Day
- Buy British Day
- Frugal Fun Day
- Virus Appreciation Day
- World Card Making Day
- Wales International Film Festival
- World Temperance Day
- World Romance Scam Prevention Day
- International Crumhorn Day
- National Wide Awakes Day
- British Carrot Awareness Day

Matched with Checkiday (both sources): National Boyfriend Day, National Techies Day, International Frugal Fun Day (Frugal Fun Day), National Virus Appreciation Day (Virus Appreciation Day), World Card Making Day, and Mean Girls Day (Checkiday's "Mean Girls Appreciation Day").
