# 10-07 — Haiku report

Status: unsure

## CSV entries
```csv
10-07,Teachers' Day (Laos),https://en.wikipedia.org/wiki/October_7
10-07,National Bathtub Day,https://www.checkiday.com/10/7/2026;https://www.daysoftheyear.com/days/oct/07/
10-07,National Forgiveness & Happiness Day,https://www.checkiday.com/10/7/2026;https://www.daysoftheyear.com/days/oct/07/
10-07,National Frappé Day,https://www.checkiday.com/10/7/2026;https://www.daysoftheyear.com/days/oct/07/
10-07,National Inner Beauty Day,https://www.checkiday.com/10/7/2026;https://www.daysoftheyear.com/days/oct/07/
10-07,National Kale Day,https://www.checkiday.com/10/7/2026;https://www.daysoftheyear.com/days/oct/07/
10-07,National LED Light Day,https://www.checkiday.com/10/7/2026;https://www.daysoftheyear.com/days/oct/07/
10-07,National Propane Day,https://www.checkiday.com/10/7/2026;https://www.daysoftheyear.com/days/oct/07/
10-07,National Pumpkin Seed Day,https://www.checkiday.com/10/7/2026;https://www.daysoftheyear.com/days/oct/07/
10-07,Random Acts of Poetry Day,https://www.checkiday.com/10/7/2026;https://www.daysoftheyear.com/days/oct/07/
10-07,Team Margot Stem Cell and Bone Marrow Registration Day,https://www.checkiday.com/10/7/2026;https://www.daysoftheyear.com/days/oct/07/
10-07,You Matter to Me Day,https://www.checkiday.com/10/7/2026;https://www.daysoftheyear.com/days/oct/07/
```

## Left out
- Balloons Around the World Day — single source (Checkiday only)
- National Chocolate Covered Pretzel Day — single source (Checkiday only)
- National Flower Day — single source (Checkiday only)
- Canadian Beer Day — single source (Days of the Year only)
- National Coffee with a Cop Day — single source (Days of the Year only)
- World Cotton Day — single source (Days of the Year only)
- World Day for Decent Work — single source (Days of the Year only)
- Trigeminal Neuralgia Awareness Day — single source (Days of the Year only)
- International Day of Peaceful Communication — single source (Days of the Year only)
- International Walk to School Day — movable (first Wednesday of October; Oct 7, 2026 is that Wednesday). Kept out of the CSV, see Unsure.
- Justina of Padua, Henry Muhlenberg, Osgyth, Our Lady of the Rosary, Pope Mark, Sergius and Bacchus, October 7 (Eastern Orthodox liturgics) — feast days, skipped
- Checkiday multi-day weeks and months (Customer Service Week, Breast Cancer Awareness Month, etc.) — multi-day

## Unsure
- International Walk to School Day (Checkiday; Days of the Year lists it as "International Walk and Bike to School Day") — the event is held on the first Wednesday of October, and Oct 7, 2026 is that Wednesday, so it is likely movable. Left out of the CSV; a human should confirm whether it belongs on this date.

## Findings
### Wikipedia
Source: parsed via the API for page October_7; the CSV uses https://en.wikipedia.org/wiki/October_7 as the page URL.
- Justina of Padua — feast day, skipped
- Henry Muhlenberg (some Lutheran churches, Episcopal Church USA) — saint/feast day, skipped
- Osgyth — saint, skipped
- Our Lady of the Rosary — feast day, skipped
- Pope Mark — saint, skipped
- Sergius and Bacchus — saints, skipped
- October 7 (Eastern Orthodox liturgics) — skipped
- Teachers' Day (Laos) — included (Wikipedia only)

### Checkiday
Source: https://www.checkiday.com/10/7/2026 (fetched OK). The single-day list for Wednesday, October 7, 2026 is complete (15 entries):
- Balloons Around the World Day
- Bathtub Day
- International Walk to School Day
- National Chocolate Covered Pretzel Day
- National Flower Day
- National Forgiveness & Happiness Day
- National Frappé Day
- National Inner Beauty Day
- National Kale Day
- National LED Light Day
- National Propane Day
- National Pumpkin Seed Day
- Random Acts of Poetry Day
- Team Margot Stem Cell and Bone Marrow Registration Day
- You Matter to Me Day

The multi-day section (weeks and months) was only partly read: the fetch was cut at 100000 of 180493 characters, so the rest of that section was not read. Multi-day events are excluded, so this does not affect the CSV.

### Days of the Year
Source: https://www.daysoftheyear.com/days/oct/07/ (fetched OK; the page lists 18 days, and the list itself is complete).
- National Frappe Day
- Canadian Beer Day
- Random Acts of Poetry Day
- National Kale Day
- National Pumpkin Seed Day
- National Coffee with a Cop Day
- Team Margot Stem Cell and Bone Marrow Awareness Day
- National Bathtub Day
- International Walk and Bike to School Day
- World Cotton Day
- World Day for Decent Work
- National Forgiveness & Happiness Day
- National Inner Beauty Day
- National LED Light Day
- National Propane Day
- Trigeminal Neuralgia Awareness Day
- You Matter To Me Day
- International Day of Peaceful Communication

Matched with Checkiday (both sources): National Frappé Day, Random Acts of Poetry Day, National Kale Day, National Pumpkin Seed Day, National Bathtub Day, International Walk to School Day (movable, see Unsure), National Forgiveness & Happiness Day, National Inner Beauty Day, National LED Light Day, National Propane Day, You Matter to Me Day, and Team Margot (the wording differs, "Registration" on Checkiday and "Awareness" on Days of the Year; same event, so kept).
