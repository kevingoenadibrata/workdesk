# 10-20 — Haiku report

Status: unsure

## CSV entries
```csv
10-20,Community Media Day,https://www.checkiday.com/10/20/2026;https://www.daysoftheyear.com/days/oct/20/
10-20,Heroes' Day (Kenya),https://en.wikipedia.org/wiki/October_20
10-20,Information Overload Awareness Day,https://www.checkiday.com/10/20/2026;https://www.daysoftheyear.com/days/oct/20/
10-20,International Chefs Day,https://www.checkiday.com/10/20/2026;https://www.daysoftheyear.com/days/oct/20/
10-20,Miss American Rose Day,https://www.checkiday.com/10/20/2026;https://www.daysoftheyear.com/days/oct/20/
10-20,National Brandied Fruit Day,https://www.checkiday.com/10/20/2026;https://www.daysoftheyear.com/days/oct/20/
10-20,National Call-in Day For Health Reform,https://www.checkiday.com/10/20/2026;https://www.daysoftheyear.com/days/oct/20/
10-20,National Chicken and Waffles Day,https://www.checkiday.com/10/20/2026;https://www.daysoftheyear.com/days/oct/20/
10-20,National Day on Writing,https://www.checkiday.com/10/20/2026;https://www.daysoftheyear.com/days/oct/20/
10-20,National Pharmacy Technician Day,https://www.checkiday.com/10/20/2026;https://www.daysoftheyear.com/days/oct/20/
10-20,National Share the Warmth Day,https://www.checkiday.com/10/20/2026;https://www.daysoftheyear.com/days/oct/20/
10-20,National Suspenders Day,https://www.checkiday.com/10/20/2026;https://www.daysoftheyear.com/days/oct/20/
10-20,National Youth Confidence Day,https://www.checkiday.com/10/20/2026;https://www.daysoftheyear.com/days/oct/20/
10-20,Office Chocolate Day,https://www.checkiday.com/10/20/2026;https://www.daysoftheyear.com/days/oct/20/
10-20,Pro-Life Day of Silent Solidarity,https://www.checkiday.com/10/20/2026;https://www.daysoftheyear.com/days/oct/20/
10-20,Revolution Day (Guatemala),https://en.wikipedia.org/wiki/October_20
10-20,Vietnamese Women's Day,https://en.wikipedia.org/wiki/October_20
10-20,World Osteoporosis Day,https://en.wikipedia.org/wiki/October_20;https://www.checkiday.com/10/20/2026;https://www.daysoftheyear.com/days/oct/20/
10-20,World Statistics Day,https://en.wikipedia.org/wiki/October_20;https://www.daysoftheyear.com/days/oct/20/
```

## Left out
- Disabled Women's Equal Pay Day — single source (Checkiday only)
- The International Day of the Air Traffic Controller — single source (Checkiday only)
- National Mozzarella Stick Day — single source (Checkiday only)
- World Calvados Day — single source (Checkiday only)
- International Mastocytosis & Mast Cell Disease Awareness Day — single source (Days of the Year only)
- National Sasquatch Awareness Day — single source (Days of the Year only)
- Talent Transformation Day — single source (Days of the Year only)
- Arbor Day (Czech Republic) — not in CSV, see Unsure
- Christian feast days / saints (Acca of Hexham, Aderald, Artemius, Caprasius of Agen, Franz Alexander Kern, Irene of Tomar, Jakub Strzemię, Magdalene of Nagasaki, Paul of the Cross, Maria Bertilla Boscardin, Mater Admirabilis, Eastern Orthodox liturgics) — feast days
- Checkiday multi-day list (e.g. International Open Access Week, National Chemistry Week, ADHD Awareness Month, Breast Cancer Awareness Month, and about 80 more) — multi-day events

## Unsure
- Arbor Day (Czech Republic) — Wikipedia lists it on October 20, but I could not load the Arbor Day article to confirm the Czech date (the API fetch failed), and Czech Arbor Day is usually in spring. Left out of the CSV until verified.
- Information Overload Awareness Day — Checkiday's name and Days of the Year's "Information Overload Day" look like the same day, so I matched them and put it in the CSV. Confirm if the match is wrong.
- World Statistics Day — Wikipedia and Days of the Year both list it on October 20, but the UN observes it only every five years (2025 was the last one), so it is not an annual day. Included because the date is fixed and both sources list it.
- Checkiday's multi-day list was truncated at 100,000 characters (the page is 177,712). It was not needed, since multi-day events are excluded, and the day list (the first section) is complete.
- Weekday check: none of the names is weekday-specific, and no known movable day from the README list appears for this date.

## Findings
### Wikipedia
- Holidays and observances (non-saint items):
  - Arbor Day (Czech Republic)
  - Heroes' Day (Kenya)
  - Revolution Day (Guatemala), one of the two Patriotic Days (Guatemala)
  - Vietnamese Women's Day (Vietnam)
  - World Osteoporosis Day
  - World Statistics Day
- Christian feast days (skipped): see Left out.

### Checkiday
- Holidays for Tuesday, October 20, 2026 (19 named days):
  Community Media Day; Disabled Women's Equal Pay Day; Information Overload Awareness Day; International Chefs Day; Miss American Rose Day; National Brandied Fruit Day; National Call-in Day For Health Reform; National Chicken and Waffles Day; National Day on Writing; National Mozzarella Stick Day; National Pharmacy Technician Day; National Share the Warmth Day; National Suspenders Day; National Youth Confidence Day; Office Chocolate Day; Pro-Life Day of Silent Solidarity; The International Day of the Air Traffic Controller; World Calvados Day; World Osteoporosis Day
- Also a "On This Day in History" card (not an observance).
- Multi-day events continuing on the date were not used (see Left out).

### Days of the Year
- 19 observances listed for October 20:
  International Chefs Day; National Brandied Fruit Day; Office Chocolate Day; World Osteoporosis Day; National Day on Writing; Community Media Day; Pharmacy Technician Day; Pro-Life Day of Silent Solidarity; World Statistics Day; International Mastocytosis & Mast Cell Disease Awareness Day; National Chicken and Waffles Day; National Sasquatch Awareness Day; Suspenders Day; National Share the Warmth Day; National Youth Confidence Day; Information Overload Day; Talent Transformation Day; Miss American Rose Day; National Call-In Day for Health Reform
- None are described as movable or weekday-specific.
