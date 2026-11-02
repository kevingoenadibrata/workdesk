# 10-25 — Haiku report

Status: unsure

## CSV entries
```csv
10-25,Armed Forces Day (Romania),https://en.wikipedia.org/wiki/October_25
10-25,Republic Day (Kazakhstan),https://en.wikipedia.org/wiki/October_25
10-25,Retrocession Day (Taiwan),https://en.wikipedia.org/wiki/October_25
10-25,Thanksgiving Day (Grenada),https://en.wikipedia.org/wiki/October_25
10-25,International Artist Day,https://www.checkiday.com/10/25/2026;https://www.daysoftheyear.com/days/oct/25/
10-25,National Greasy Foods Day,https://www.checkiday.com/10/25/2026;https://www.daysoftheyear.com/days/oct/25/
10-25,National I Care About You Day,https://www.checkiday.com/10/25/2026;https://www.daysoftheyear.com/days/oct/25/
10-25,National Merri Music Day,https://www.checkiday.com/10/25/2026;https://www.daysoftheyear.com/days/oct/25/
10-25,National Mother-in-Law Day,https://www.checkiday.com/10/25/2026;https://www.daysoftheyear.com/days/oct/25/
10-25,National Tight Ends Day,https://www.checkiday.com/10/25/2026;https://www.daysoftheyear.com/days/oct/25/
10-25,Punk for a Day Day,https://www.checkiday.com/10/25/2026;https://www.daysoftheyear.com/days/oct/25/
10-25,Sourest Day,https://www.checkiday.com/10/25/2026;https://www.daysoftheyear.com/days/oct/25/
10-25,World Pasta Day,https://www.checkiday.com/10/25/2026;https://www.daysoftheyear.com/days/oct/25/
```

## Left out
- Visit a Cemetery Day — single source (Checkiday only)
- National Cartoonists Against Crime Day — single source (Checkiday only)
- World Pizza Makers Day — single source (Checkiday only)
- Opera Day — single source (Days of the Year only)
- World Opera Day — single source (Days of the Year only)
- National Jamaican Jerk Day — single source (Days of the Year only)
- Crisp Sandwich Day — single source (Days of the Year only)
- National Fine Art Appreciation Day — single source (Days of the Year only)
- National Chucky Day — single source (Days of the Year only)
- National Hope for Henry Day — single source (Days of the Year only)
- Tirana Marathon — single source (Days of the Year only), and an event rather than a day
- Chicken Soup for the Soul Week — multi-day (week)
- British Summertime Ends — movable (UK clocks go back on the last Sunday of October); listed on Days of the Year only
- Christian feast days and saints on Wikipedia (Bernat Calbó, Pope Boniface I, Canna, Blessed Carlo Gnocchi, Crysanthus and Daria, Crispin and Crispinian, Fructus, Gaudentius of Brescia, Goeznovius, Minias of Florence, Mar Nestorius, Tabitha (Dorcas), Tegulus, Blessed Thaddeus McCarthy, The Six Welsh Martyrs, The Hallowing of Nestorius, "October 25 (Eastern Orthodox liturgics)") — feast day

## Unsure
- Day of the Basque Country (Wikipedia) — left out of the CSV. Wikipedia gives October 25, but Euskal Herriaren Eguna is traditionally tied to a Sunday, and October 25, 2026 is a Sunday. Not verified against a source that gives the rule, so it is kept out until checked.
- Sovereignty Day (Slovenia) (Wikipedia) — left out of the CSV. I recall Slovenia's Sovereignty Day as 25 June, not October 25. The Wikipedia entry on this page was not checked against a second source.
- Sourest Day — in the CSV because both fun-day sites list it for October 25, 2026, but the name gives no movability hint, and I did not open its description on either site to confirm it is fixed.

## Findings
### Wikipedia
Source: https://en.wikipedia.org/wiki/October_25 (read via the REST HTML endpoint, `https://en.wikipedia.org/api/rest_v1/page/html/October_25`, because the action API returned a rate-limit error)
- Armed Forces Day (Romania)
- Day of the Basque Country (Basque Country)
- Republic Day (Kazakhstan)
- Retrocession Day and the memorial day for the Battle of Guningtou (Taiwan)
- Sovereignty Day (Slovenia)
- Thanksgiving Day (Grenada)
- Christian feast day entries (saints and "October 25 (Eastern Orthodox liturgics)") — excluded

### Checkiday
Source: https://www.checkiday.com/10/25/2026 (WebFetch; the page is long and was cut off after 100,000 characters)
Single-day observances, listed for Sunday, October 25, 2026:
- Chicken Soup for the Soul Week (multi-day, excluded)
- International Artist Day
- Mother-In-Law Day
- National Cartoonists Against Crime Day
- National Greasy Foods Day
- National I Care About You Day
- National Merri Music Day
- National Tight Ends Day
- Punk for a Day Day
- Sourest Day
- Visit a Cemetery Day
- World Pasta Day
- World Pizza Makers Day

Also listed: National Massage Therapy Awareness Week (multi-day, excluded) and a long month-long list (for example Breast Cancer Awareness Month, Fire Prevention Month). The month-long list was not read to the end. The single-day section is complete before the cut-off.

### Days of the Year
Source: https://www.daysoftheyear.com/days/oct/25/
- Opera Day
- International Artist Day
- World Pasta Day
- World Opera Day
- National Greasy Foods Day
- National Jamaican Jerk Day
- Crisp Sandwich Day
- Tirana Marathon
- National Tight Ends Day
- Sourest Day
- National Fine Art Appreciation Day
- National Mother-in-Law Day
- National Merri Music Day
- National Chucky Day
- National I Care About You Day
- Punk for a Day Day
- National Hope for Henry Day
- British Summertime Ends
