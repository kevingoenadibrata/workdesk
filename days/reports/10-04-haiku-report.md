# 10-04 — Haiku report

Status: unsure

## CSV entries
```csv
10-04,Cinnamon Roll Day,https://en.wikipedia.org/wiki/October_4;https://www.checkiday.com/10/4/2026;https://www.daysoftheyear.com/days/oct/04/
10-04,World Animal Day,https://en.wikipedia.org/wiki/October_4;https://www.checkiday.com/10/4/2026;https://www.daysoftheyear.com/days/oct/04/
10-04,Improve Your Office Day,https://www.checkiday.com/10/4/2026;https://www.daysoftheyear.com/days/oct/04/
10-04,Change a Light Day,https://www.checkiday.com/10/4/2026;https://www.daysoftheyear.com/days/oct/04/
10-04,National Vodka Day,https://www.checkiday.com/10/4/2026;https://www.daysoftheyear.com/days/oct/04/
10-04,National GOE Day,https://www.checkiday.com/10/4/2026;https://www.daysoftheyear.com/days/oct/04/
10-04,International Blessings of The Fishing Fleet Day,https://www.checkiday.com/10/4/2026;https://www.daysoftheyear.com/days/oct/04/
10-04,National Ships-in-Bottles Day,https://www.checkiday.com/10/4/2026;https://www.daysoftheyear.com/days/oct/04/
10-04,Day of Peace and Reconciliation (Mozambique),https://en.wikipedia.org/wiki/October_4
10-04,Independence Day (Lesotho),https://en.wikipedia.org/wiki/October_4
```

## Left out
- Feast of Saint Francis of Assisi; Christian feast days/saints on the Wikipedia list (Amun, Aurea of Paris, Francis of Assisi, Blessed Francis Xavier Seelos, Petronius of Bologna, Conclusion of Creationtide) — feast day
- World Communion Sunday — Christian observance and movable (first Sunday of October)
- Simchat Torah — movable (Hebrew calendar) and religious
- World Space Week (beginning) — multi-day event
- Country Inn Bed and Breakfast Day, eDay, International African Diaspora Day, International Toot Your Flute Day, National Taco Day, Ten-Four Day — single source (Checkiday only)
- National Good Buddy Day, National Truckers Day, No Disposable Cup Day, National Get Out N Drive Day — single source (Days of the Year only)

## Unsure
- National Golf Day (Checkiday) / National Golf Lover's Day (Days of the Year) — both sources list a golf day on October 4, but the names differ enough that I did not judge them clearly the same day, so it is left out of the CSV. A human should decide whether to merge them as one entry with both sources.
- National Ships-in-Bottles Day (Checkiday) matched with Ship in A Bottle Day (Days of the Year) — included as the same day. Flagging it as a judgment call.

## Findings
### Wikipedia
Source: parsed via the API for page October_4 (Holidays and observances section); the CSV uses https://en.wikipedia.org/wiki/October_4 as the page URL.
- Christian feast days/saints (Amun, Aurea of Paris, Francis of Assisi, Blessed Francis Xavier Seelos, Petronius of Bologna, Conclusion of Creationtide, Eastern Orthodox liturgics link) — skipped
- Feast of St Francis of Assisi (patron saints of Italy) — skipped
- Cinnamon Roll Day (Sweden and Finland) — included
- Day of Peace and Reconciliation (Mozambique) — included
- Independence Day (Lesotho) — included
- The beginning of World Space Week (International) — left out, multi-day
- World Animal Day — included

### Checkiday
Source: https://www.checkiday.com/10/4/2026 (fetched OK; the "Holidays for" section was complete). Listed for Sunday, October 4th, 2026:
- Change a Light Day
- Cinnamon Roll Day
- Country Inn Bed and Breakfast Day
- eDay
- Feast of Saint Francis of Assisi
- Improve Your Office Day
- International African Diaspora Day
- International Blessings of The Fishing Fleet Day
- International Toot Your Flute Day
- National GOE Day
- National Golf Day
- National Ships-in-Bottles Day
- National Taco Day
- National Vodka Day
- Simchat Torah
- Ten-Four Day
- World Animal Day
- World Communion Sunday
- On This Day in History (not a day)

The page is longer than 100000 characters; the later part holds multi-day events, which were not used. The offset-100000 continuation was not fetched because the holiday list was complete in the first read.

### Days of the Year
Source: https://www.daysoftheyear.com/days/oct/04/ (fetched OK). Lists 15 days:
- National Cinnamon Roll Day
- National Golf Lover's Day
- National Good Buddy Day
- National Vodka Day
- St. Francis of Assisi Feast Day
- National Truckers Day
- World Animal Day
- Improve Your Office Day
- Change A Light Day
- Ship in A Bottle Day
- No Disposable Cup Day
- International Blessings of The Fishing Fleet Day
- National Get Out N Drive Day
- National GOE Day
- World Communion Sunday
