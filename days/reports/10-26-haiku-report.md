# 10-26 — Haiku report

Status: unsure

## CSV entries
```csv
10-26,"Accession Day (Jammu and Kashmir, India)",https://en.wikipedia.org/wiki/October_26
10-26,Angam Day (Nauru),https://en.wikipedia.org/wiki/October_26
10-26,Armed Forces Day (Benin),https://en.wikipedia.org/wiki/October_26
10-26,National Day (Austria),https://en.wikipedia.org/wiki/October_26;https://www.daysoftheyear.com/days/oct/26/
10-26,Intersex Awareness Day,https://en.wikipedia.org/wiki/October_26;https://www.checkiday.com/10/26/2026;https://www.daysoftheyear.com/days/oct/26/
10-26,National Day of the Deployed,https://www.checkiday.com/10/26/2026;https://www.daysoftheyear.com/days/oct/26/
10-26,National Financial Crime Fighter Day,https://www.checkiday.com/10/26/2026;https://www.daysoftheyear.com/days/oct/26/
10-26,National Mincemeat Day,https://www.checkiday.com/10/26/2026;https://www.daysoftheyear.com/days/oct/26/
10-26,National Mule Day,https://www.checkiday.com/10/26/2026;https://www.daysoftheyear.com/days/oct/26/
10-26,National Pumpkin Day,https://www.checkiday.com/10/26/2026;https://www.daysoftheyear.com/days/oct/26/
10-26,Howl at the Moon Day,https://www.checkiday.com/10/26/2026;https://www.daysoftheyear.com/days/oct/26/
10-26,Texas Chicken Fried Steak Day,https://www.checkiday.com/10/26/2026;https://www.daysoftheyear.com/days/oct/26/
```

## Left out
- Labour Day in New Zealand — movable (4th Monday of October; it falls on October 26 in 2026)
- Horseless Carriage Day — single source (Checkiday only)
- National Chocolate Cupcake Day — single source (Days of the Year only)
- National No Beard Day — single source (Days of the Year only)
- World Toy Camera Day — single source (Days of the Year only)
- World Menopause Day — single source (Days of the Year only)
- National Microneedling Day — single source (Days of the Year only)
- National Tennessee Day — single source (Days of the Year only)
- National Pension Tracing Day — single source (Days of the Year only)
- Truffle Days in Croatia — single source (Days of the Year only); a local multi-day festival
- Christian feast days and saints on the Wikipedia list (Alfred the Great, Amandus of Strasbourg, Beóán of Mortlach, Celine Borzecka, Cedd, Cuthbert of Canterbury, Demetrius of Thessaloniki, Eadfrith of Leominster, Eata of Hexham, Pope Evaristus, Fulk of Pavia, Philipp Nicolai / Johann Heermann / Paul Gerhardt, Quadragesimus, Quodvultdeus, Rusticus of Narbonne, Witta of Büraburg, Eastern Orthodox liturgics) — feast days
- Multi-day events on Checkiday (Disarmament Week, National Massage Therapy Awareness Week, the many month-long observances such as ADHD Awareness Month, the year-long and decade-long UN observances, and so on) — multi-day

## Unsure
- Texas Chicken Fried Steak Day — Checkiday lists "Texas Chicken Fried Steak Day" and Days of the Year lists "National Chicken Fried Steak Day" for the same date. I matched them as the same day because the subject and date are identical, but the names differ. Included as a best guess; check before relying on it.
- Accession Day (Jammu and Kashmir, India) — a regional observance listed on Wikipedia only. Included under the Wikipedia rule, but it is a regional rather than national day.

## Findings
### Wikipedia
Source: parsed via the API for page October_26 (the first request was rate-limited; a retry after a wait with the User-Agent header worked). The CSV uses https://en.wikipedia.org/wiki/October_26 as the page URL.
- Accession Day (Jammu and Kashmir, India) — included
- Angam Day (Nauru) — included
- Armed Forces Day (Benin) — included
- Christian feast day list (Alfred the Great, Amandus of Strasbourg, Beóán of Mortlach, Blessed Celine Borzecka, Cedd, Cuthbert of Canterbury, Demetrius of Thessaloniki, Eadfrith of Leominster, Eata of Hexham, Pope Evaristus, Fulk of Pavia, Philipp Nicolai / Johann Heermann / Paul Gerhardt, Quadragesimus, Quodvultdeus, Rusticus of Narbonne, Witta of Büraburg, Eastern Orthodox liturgics) — skipped
- National Day, Austria (anniversary of the Declaration of Neutrality, 1955) — included as "National Day (Austria)"
- Intersex Awareness Day — included

### Checkiday
Source: https://www.checkiday.com/10/26/2026 (fetched in full with curl; not truncated). Single-day observances for Monday, October 26th, 2026:
- Horseless Carriage Day
- Intersex Awareness Day
- National Day of the Deployed
- National Financial Crime Fighter Day
- National Mincemeat Day
- National Mule Day
- National Pumpkin Day
- Texas Chicken Fried Steak Day
- Howl at the Moon Day

Multi-day events continuing on this date (not used): Disarmament Week, National Massage Therapy Awareness Week, about 150 month-long, year-long and decade-long observances.

### Days of the Year
Source: https://www.daysoftheyear.com/days/oct/26/ (fetched in full with curl). Days listed for October 26:
- National Chocolate Cupcake Day
- National No Beard Day
- World Toy Camera Day
- World Menopause Day
- National Chicken Fried Steak Day
- National Pumpkin Day
- National Day of the Deployed
- National Microneedling Day
- Intersex Awareness Day
- Labour Day in New Zealand
- National Tennessee Day
- National Pension Tracing Day
- National Mincemeat Day
- National Mule Day
- Howl At The Moon Day
- National Financial Crime Fighter Day
- Austrian National Day
- Other holidays on the page: Truffle Days in Croatia

Matched with Checkiday for the fun-day rule: National Day of the Deployed, National Financial Crime Fighter Day, National Mincemeat Day, National Mule Day, National Pumpkin Day, Howl at the Moon Day, and Chicken Fried Steak Day (Texas variant, see Unsure). Intersex Awareness Day is also on Checkiday and Wikipedia. Austrian National Day matches the Wikipedia National Day (Austria) entry.
