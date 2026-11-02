# 10-06 — Haiku report

Status: success

## CSV entries
```csv
10-06,Day of Commemoration and National Mourning (Turkmenistan),https://en.wikipedia.org/wiki/October_6
10-06,Dukla Pass Victims Day (Slovakia),https://en.wikipedia.org/wiki/October_6
10-06,German-American Day,https://en.wikipedia.org/wiki/October_6;https://www.checkiday.com/10/6/2026;https://www.daysoftheyear.com/days/oct/06/
10-06,Memorial Day for the Martyrs of Arad (Hungary),https://en.wikipedia.org/wiki/October_6
10-06,Teachers' Day (Sri Lanka),https://en.wikipedia.org/wiki/October_6
10-06,Armed Forces Day (Egypt),https://en.wikipedia.org/wiki/October_6
10-06,Tishreen Liberation Day (Syria),https://en.wikipedia.org/wiki/October_6
10-06,Mad Hatter Day,https://www.checkiday.com/10/6/2026;https://www.daysoftheyear.com/days/oct/06/
10-06,National Badger Day,https://www.checkiday.com/10/6/2026;https://www.daysoftheyear.com/days/oct/06/
10-06,National Coaches Day,https://www.checkiday.com/10/6/2026;https://www.daysoftheyear.com/days/oct/06/
10-06,National Fruit at Work Day,https://www.checkiday.com/10/6/2026;https://www.daysoftheyear.com/days/oct/06/
10-06,National Noodle Day,https://www.checkiday.com/10/6/2026;https://www.daysoftheyear.com/days/oct/06/
10-06,National Orange Wine Day,https://www.checkiday.com/10/6/2026;https://www.daysoftheyear.com/days/oct/06/
10-06,National Physician Assistant Day,https://www.checkiday.com/10/6/2026;https://www.daysoftheyear.com/days/oct/06/
10-06,National Plus Size Appreciation Day,https://www.checkiday.com/10/6/2026;https://www.daysoftheyear.com/days/oct/06/
10-06,World Cerebral Palsy Day,https://www.checkiday.com/10/6/2026;https://www.daysoftheyear.com/days/oct/06/
```

## Left out
- World Space Week (October 4–10) — multi-day
- National PA Week — multi-day
- Customer Service Week, Drive Safely Work Week, Teller Appreciation Week, Get Organized Week, Mental Illness Awareness Week, National Chili Week, National Curry Week (UK), National Fire Prevention Week, National Human Service Awareness Week, National Metric Week, National Newspaper Week, National Pickled Pepper Week, National School Yearbook Week, National Walk Your Dog Week, Public Power Week, Skin Care Awareness Week, Universal Children's Week — multi-day (Checkiday weeks)
- Month-long Checkiday/Days of the Year entries (ADHD Awareness Month, Breast Cancer Awareness Month, National Book Month, etc.) — multi-day
- Come and Take It Day — single source (Checkiday only)
- Garlic Lovers Day — single source (Checkiday only)
- Jackie Mayer Rehab Day — single source (Checkiday only)
- National Taco Day — single source (Days of the Year only)
- National Transfer Money to Your Daughter Day — single source (Days of the Year only)
- Inbox Zero Day — single source (Days of the Year only)
- National Depression Screening Day — single source (Days of the Year only)
- National Energy Geek Day — single source (Days of the Year only)
- International Dysgraphia Awareness Day — single source (Days of the Year only)
- Christian feast days/saints on the Wikipedia list (Bruno of Cologne, Faith, Blessed Isidore De Loor, Blessed Juan de Palafox y Mendoza, Blessed Marie Rose Durocher, Mary Frances of the Five Wounds, Pardulphus, Sagar of Laodicea, William Tyndale commemoration) — feast days, skipped

## Unsure
None

## Findings
### Wikipedia
Source: parsed via the API for page October_6; the CSV uses https://en.wikipedia.org/wiki/October_6 as the page URL.
- Christian feast day list and Eastern Orthodox liturgics link — skipped
- World Space Week (October 4–10) — left out, multi-day
- Day of Commemoration and National Mourning (Turkmenistan) — included
- Dukla Pass Victims Day (Slovakia) — included
- German-American Day (United States) — included; also on Checkiday and Days of the Year
- Memorial Day for the Martyrs of Arad (Hungary) — included
- Teachers' Day (Sri Lanka) — included
- Yom Kippur War commemorations: Armed Forces Day (Egypt) — included
- Yom Kippur War commemorations: Tishreen Liberation Day (Syria) — included

### Checkiday
Source: https://www.checkiday.com/10/6/2026 (fetched OK). The "Holidays for Tuesday, October 6th, 2026" list has 13 entries:
- Come and Take It Day
- Garlic Lovers Day
- Jackie Mayer Rehab Day
- Mad Hatter Day
- National Badger Day
- National Coaches Day
- National Fruit at Work Day
- National German American Day
- National Noodle Day
- National Orange Wine Day
- National PA Day
- National Plus Size Appreciation Day
- World Cerebral Palsy Day

The page text is long (about 179,700 characters). The first WebFetch call covered characters 0–100000, and the second call at offset 100000 covered the rest. The rest holds only month-long, multi-day, yearly, and decade observances, so no further single-day entries were missed. The "Multi-day" entries listed above come from the first pass. "National PA Day" was matched to "National Physician Assistant Day" on Days of the Year; the match is clear (both are the same Oct 6 day).

### Days of the Year
Source: https://www.daysoftheyear.com/days/oct/06/ (fetched OK). The page's "National days" count is 16 (after de-duplicating three names that repeat in the guide):
- National Taco Day
- National Noodle Day
- National Mad Hatter Day
- World Cerebral Palsy Day
- National Coaches Day
- National Transfer Money to Your Daughter Day
- National Physician Assistant Day
- National Badger Day
- National German-American Day
- National Fruit at Work Day
- National Orange Wine Day
- National Plus Size Appreciation Day
- Inbox Zero Day
- National Depression Screening Day
- National Energy Geek Day
- International Dysgraphia Awareness Day

Matched with Checkiday (both sources): Mad Hatter Day, National Badger Day, National Coaches Day, National Fruit at Work Day, National German-American Day (same as Checkiday's "National German American Day"), National Noodle Day, National Orange Wine Day, National Physician Assistant Day (same as Checkiday's "National PA Day"), National Plus Size Appreciation Day, and World Cerebral Palsy Day.
