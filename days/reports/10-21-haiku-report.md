# 10-21 — Haiku report

Status: success

## CSV entries
```csv
10-21,Armed Forces Day (Honduras),https://en.wikipedia.org/wiki/October_21
10-21,Egyptian Naval Day,https://en.wikipedia.org/wiki/October_21
10-21,Indian Police Commemoration Day,https://en.wikipedia.org/wiki/October_21
10-21,National Nurses' Day (Thailand),https://en.wikipedia.org/wiki/October_21
10-21,Ndadaye Day (Burundi),https://en.wikipedia.org/wiki/October_21
10-21,Overseas Chinese Day (Republic of China),https://en.wikipedia.org/wiki/October_21
10-21,Trafalgar Day,https://en.wikipedia.org/wiki/October_21;https://www.daysoftheyear.com/days/oct/21/
10-21,Back to the Future Day,https://www.checkiday.com/10/21/2026;https://www.daysoftheyear.com/days/oct/21/
10-21,National Apple Day,https://www.checkiday.com/10/21/2026;https://www.daysoftheyear.com/days/oct/21/
10-21,Celebration of the Mind Day,https://www.checkiday.com/10/21/2026;https://www.daysoftheyear.com/days/oct/21/
10-21,Check Your Meds Day,https://www.checkiday.com/10/21/2026;https://www.daysoftheyear.com/days/oct/21/
10-21,Count Your Buttons Day,https://www.checkiday.com/10/21/2026;https://www.daysoftheyear.com/days/oct/21/
10-21,Global Iodine Deficiency Disorders Prevention Day,https://www.checkiday.com/10/21/2026;https://www.daysoftheyear.com/days/oct/21/
10-21,International Day of the Nacho,https://www.checkiday.com/10/21/2026;https://www.daysoftheyear.com/days/oct/21/
10-21,National Pets for Veterans Day,https://www.checkiday.com/10/21/2026;https://www.daysoftheyear.com/days/oct/21/
10-21,National Pumpkin Cheesecake Day,https://www.checkiday.com/10/21/2026;https://www.daysoftheyear.com/days/oct/21/
10-21,National Reptile Awareness Day,https://www.checkiday.com/10/21/2026;https://www.daysoftheyear.com/days/oct/21/
10-21,National Witch Hazel Day,https://www.checkiday.com/10/21/2026;https://www.daysoftheyear.com/days/oct/21/
```

## Left out
- Birth of the Báb (Twin Holy Birthdays, Baháʼí) — movable (Badíʿ calendar; Wikipedia dates it to Oct 21 only for 2017)
- Global Dignity Day — movable (third Wednesday in October; Oct 21, 2026 is that Wednesday); also on Days of the Year
- Hagfish Day — movable (third Wednesday in October); also on Days of the Year
- National Support Your Local Chamber of Commerce Day — movable (third Wednesday in October); also on Days of the Year
- Breast Reconstruction Awareness Day (BRA Day) — movable (third Wednesday in October); single source (Checkiday only)
- Love Your Body Day — movable (third Wednesday in October); single source (Checkiday only)
- International Pronouns Day — movable (third Wednesday in October); single source (Checkiday only)
- Medical Assistants Recognition Day — movable (Wednesday of third business week in October); single source (Checkiday only)
- Unity Day — movable (closest Wednesday to Oct 22); single source (Checkiday only)
- Vijayadashami — movable (Hindu lunar calendar), religious; single source (Days of the Year only)
- Babbling Day — single source (Checkiday only)
- Garbanzo Bean Day — single source (Checkiday only)
- National Mezcal Day — single source (Checkiday only)
- World Bolognese Ragù Day — single source (Checkiday only)
- Global Ethics Day — single source (Days of the Year only)
- Everyone Writes Day — single source (Days of the Year only)
- Weet-Bix Day — single source (Days of the Year only)
- SUDEP Action Day — single source (Days of the Year only)
- National Honey Day — single source (Days of the Year only)
- National Missouri Day — single source (Days of the Year only)
- Geelong Cup Day — single source (Days of the Year only)
- Seed Gathering Season — not a day, a season; single source (Days of the Year only)
- Christian feast days/saints on the Wikipedia list (Céline of Laon, Blessed Charles of Austria, Fintán of Taghmon, Hilarion, John of Bridlington, Laura of Saint Catherine of Siena, Malchus of Syria, Pedro Calungsod, Peter Yu Tae-chol, Severinus of Bordeaux, Tuda of Lindisfarne, Ursula, Viator of Lyons, October 21 (Eastern Orthodox liturgics)) — feast days, skipped

## Unsure
None

## Findings
### Wikipedia
Source: parsed via the API for page October_21 (fetched on the second try; the first attempt returned no output, the retry succeeded). The CSV uses https://en.wikipedia.org/wiki/October_21 as the page URL.
- Armed Forces Day (Honduras) — included
- Christian feast day list (saints, Blessed Charles of Austria, Eastern Orthodox liturgics link) — skipped
- Egyptian Naval Day (Egypt) — included
- Indian Police Commemoration Day (India) — included
- National Nurses' Day (Thailand) — included
- Ndadaye Day (Burundi) — included
- Overseas Chinese Day (Republic of China) — included
- Trafalgar Day (the British Empire, 19th and early 20th century) — included; also on Days of the Year
- Birth of the Báb (2017), Twin Holy Birthdays (Baháʼí Faith) — left out as movable

### Checkiday
Source: https://www.checkiday.com/10/21/2026 (fetched OK, full page, not truncated). "Holidays for Wednesday, October 21st, 2026" lists 23 single-day entries, then "On This Day in History" (a feature, not a day), then multi-day events (International Open Access Week, National Bulk Foods Week, National Chemistry Week, National Kraut Sandwich Week, National Snow Blower Maintenance Week, Rodent Awareness Week, and several monthly observances; all left out as multi-day):
- "Back to the Future" Day
- Apple Day
- Babbling Day
- Breast Reconstruction Awareness Day (third Wednesday in October)
- Celebration of the Mind Day
- Check Your Meds Day
- Count Your Buttons Day
- Garbanzo Bean Day
- Global Dignity Day (third Wednesday in October)
- Global Iodine Deficiency Disorders Prevention Day
- Hagfish Day (third Wednesday in October)
- International Day of the Nacho
- International Pronouns Day (third Wednesday in October)
- Love Your Body Day (third Wednesday in October)
- Medical Assistants Recognition Day (Wednesday of third business week in October)
- National Mezcal Day
- National Pets for Veterans Day
- National Pumpkin Cheesecake Day
- National Support Your Local Chamber of Commerce Day (third Wednesday in October)
- National Witch Hazel Day
- Reptile Awareness Day
- Unity Day (closest Wednesday to October 22)
- World Bolognese Ragù Day

### Days of the Year
Source: https://www.daysoftheyear.com/days/oct/21/ (fetched OK). The page header says "Skip to all 23 days", but the page body contains 26 distinct day cards dated 21 OCT WED, listed here as found:
- National Apple Day
- International Day of the Nacho
- Back To The Future Day
- National Pumpkin Cheesecake Day
- Global Dignity Day
- Trafalgar Day
- Geelong Cup Day
- National Reptile Awareness Day
- Global Ethics Day
- Weet-Bix Day
- Everyone Writes Day
- Support Your Local Chamber of Commerce Day
- SUDEP Action Day
- Celebration of the Mind Day
- National Check Your Meds Day
- National Pets for Veterans Day
- National Honey Day
- Count Your Buttons Day
- Hagfish Day
- National Missouri Day
- National Witch Hazel Day
- Global Iodine Deficiency Disorders Prevention Day
- Vijayadashami
- Seed Gathering Season
