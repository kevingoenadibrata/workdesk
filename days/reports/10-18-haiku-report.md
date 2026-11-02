# 10-18 — Haiku report

Status: success

## CSV entries
```csv
10-18,Alaska Day (United States),https://en.wikipedia.org/wiki/October_18;https://www.daysoftheyear.com/days/oct/18/
10-18,Day of Restoration of Independence (Azerbaijan),https://en.wikipedia.org/wiki/October_18
10-18,Necktie Day (Croatia),https://en.wikipedia.org/wiki/October_18;https://www.checkiday.com/10/18/2026;https://www.daysoftheyear.com/days/oct/18/
10-18,Persons Day (Canada),https://en.wikipedia.org/wiki/October_18
10-18,World Menopause Day,https://en.wikipedia.org/wiki/October_18;https://www.checkiday.com/10/18/2026;https://www.daysoftheyear.com/days/oct/18/
10-18,National Chocolate Cupcake Day,https://www.checkiday.com/10/18/2026;https://www.daysoftheyear.com/days/oct/18/
10-18,National Exascale Day,https://www.checkiday.com/10/18/2026;https://www.daysoftheyear.com/days/oct/18/
10-18,National No Beard Day,https://www.checkiday.com/10/18/2026;https://www.daysoftheyear.com/days/oct/18/
```

## Left out
- International Legging Day — single source (Checkiday only)
- Ride To Work Day — single source (Days of the Year only)
- National Mashed Potato Day — single source (Days of the Year only)
- Loud Shirt Day — single source (Days of the Year only)
- Health Care Aide Day — single source (Days of the Year only)
- World Okapi Day — single source (Days of the Year only)
- National Speak Up for Victims of Sexual Abuse Day — single source (Days of the Year only)
- National Prayer Day (Zambia) — single source (Days of the Year only)
- World Toy Camera Day — movable (Checkiday: "third Sunday in October"; Oct 18, 2026 is that Sunday)
- National Sunday School Teacher Appreciation Day — movable (Checkiday and Days of the Year: "third Sunday of October"; Oct 18, 2026 is that Sunday)
- Christian feast days/saints on the Wikipedia list (Asclepiades of Antioch, Isaac Jogues, Luke the Evangelist, Monon, Peter of Alcantara, October 18 (Eastern Orthodox liturgics)) — feast days, skipped
- Multi-day and month-long events on Checkiday (National Bulk Foods Week, National Chemistry Week, National Kraut Sandwich Week, Rodent Awareness Week, Oktoberfest-style weeks/months, and the rest of its "Continuing" lists) — multi-day

## Unsure
None

## Findings
### Wikipedia
Source: parsed via the API for page October_18 (retried once after a rate-limit response); the CSV uses https://en.wikipedia.org/wiki/October_18 as the page URL.
- Alaska Day (Alaska, United States) — included; also on Days of the Year as "National Alaska Day"
- Day of Restoration of Independence (Azerbaijan) — included
- Necktie Day (Croatia) — included; also on Checkiday ("International Necktie Day (Croatia)") and Days of the Year ("Necktie Day")
- Persons Day (Canada) — included
- World Menopause Day (International Menopause Society link) — included; also on Checkiday and Days of the Year
- Christian feast day list (saints, Eastern Orthodox liturgics link) — skipped

### Checkiday
Source: https://www.checkiday.com/10/18/2026 (fetched OK, full page). The "Holidays for Sunday, October 18th, 2026" list has 8 entries:
- International Legging Day — left out (single source)
- International Necktie Day (Croatia) — included
- National Chocolate Cupcake Day — included
- National Exascale Day — included
- National No Beard Day — included
- National Sunday School Teacher Appreciation Day — left out (movable, third Sunday)
- World Menopause Day — included
- World Toy Camera Day — left out (movable, third Sunday)

### Days of the Year
Source: https://www.daysoftheyear.com/days/oct/18/ (fetched OK; page reports 15 days for October 18):
- Ride To Work Day — left out (single source)
- World Menopause Day — included
- National Chocolate Cupcake Day — included
- National Mashed Potato Day — left out (single source)
- Sunday School Teacher Appreciation Day — left out (movable, third Sunday)
- Necktie Day (Croatia) — included
- Loud Shirt Day — left out (single source)
- Health Care Aide Day — left out (single source)
- National Alaska Day — included (matched to Wikipedia's Alaska Day)
- National Exascale Day — included
- World Toy Camera Day — left out (movable, third Sunday)
- National No Beard Day — included
- World Okapi Day — left out (single source)
- National Speak Up for Victims of Sexual Abuse Day — left out (single source)
- National Prayer Day (Zambia) — left out (single source)
