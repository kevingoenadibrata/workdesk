# 10-12 — Haiku report

Status: unsure

## CSV entries
```csv
10-12,Children's Day (Brazil),https://en.wikipedia.org/wiki/October_12
10-12,Columbus Day (Honduras),https://en.wikipedia.org/wiki/October_12
10-12,Fiesta Nacional de España (Spain),https://en.wikipedia.org/wiki/October_12;https://www.daysoftheyear.com/days/oct/12/
10-12,Día de la Resistencia Indígena (Venezuela),https://en.wikipedia.org/wiki/October_12
10-12,Día de las Américas (Belize),https://en.wikipedia.org/wiki/October_12
10-12,Día de las Culturas (Costa Rica),https://en.wikipedia.org/wiki/October_12
10-12,Día del Respeto a la Diversidad Cultural (Argentina),https://en.wikipedia.org/wiki/October_12;https://www.daysoftheyear.com/days/oct/12/
10-12,"Día de la Raza (El Salvador, Uruguay)",https://en.wikipedia.org/wiki/October_12;https://www.daysoftheyear.com/days/oct/12/
10-12,Discovery Day (The Bahamas),https://en.wikipedia.org/wiki/October_12
10-12,Feast for Life (Crowleymas),https://en.wikipedia.org/wiki/October_12
10-12,Hafez Day (Iran),https://en.wikipedia.org/wiki/October_12
10-12,Independence Day (Equatorial Guinea),https://en.wikipedia.org/wiki/October_12
10-12,International Day Against DRM,https://en.wikipedia.org/wiki/October_12
10-12,National Farmer's Day,https://www.checkiday.com/10/12/2026;https://www.daysoftheyear.com/days/oct/12/
10-12,National Pulled Pork Day,https://www.checkiday.com/10/12/2026;https://www.daysoftheyear.com/days/oct/12/
10-12,World Arthritis Day,https://www.checkiday.com/10/12/2026;https://www.daysoftheyear.com/days/oct/12/
10-12,National Gumbo Day,https://www.checkiday.com/10/12/2026;https://www.daysoftheyear.com/days/oct/12/
10-12,National Savings Day,https://www.checkiday.com/10/12/2026;https://www.daysoftheyear.com/days/oct/12/
10-12,International Moment of Frustration Scream Day,https://www.checkiday.com/10/12/2026;https://www.daysoftheyear.com/days/oct/12/
10-12,National Online Banking Day,https://www.checkiday.com/10/12/2026;https://www.daysoftheyear.com/days/oct/12/
10-12,National Kick-Butt Day,https://www.checkiday.com/10/12/2026;https://www.daysoftheyear.com/days/oct/12/
10-12,Freethought Day,https://www.checkiday.com/10/12/2026;https://www.daysoftheyear.com/days/oct/12/
```

## Left out
- Columbus Day — movable (2nd Monday of October in the US); also on Checkiday and Days of the Year
- Indigenous Peoples' Day — movable (2nd Monday of October)
- Thanksgiving (Canada) — movable (2nd Monday of October)
- Native American Day — single source (Checkiday only); also movable in the US
- Cookbook Launch Day — single source (Checkiday only)
- National Vermont Day — single source (Days of the Year only)
- National Heritage Day in the Turks and Caicos Islands — single source (Days of the Year only)
- Lady of Aparecida (Our Lady of Aparecida) — feast day
- Edith Cavell and Elizabeth Fry (Church of England) — feast day / commemoration
- Christian feast days and saints on the Wikipedia list (Domnina of Anazarbus, Fiacc, Our Lady of the Pillar, Blessed Louis Brisson, Radim Gaudentius, Blessed Roman Sitko, Seraphin of Montegranaro, Thomas Bullaker, Wilfrid of Ripon, Carlo Acutis, Eastern Orthodox liturgics link) — feast days
- Multi-day and month-long events on Checkiday (Bone and Joint Action Week, International Cephalopod Awareness Days, American Beer Week, Freethought Week, National School Lunch Week, and the monthly observances such as ADHD Awareness Month) — multi-day

## Unsure
- Discovery Day (The Bahamas) — listed on Wikipedia for October 12, but I could not confirm from the sources that the Bahamas observes it on the fixed date every year (it may be moved to a nearby weekday in some years). Included as a best guess; check before relying on it.
- National Online Banking Day — Checkiday says "Online Banking Day" and Days of the Year says "National Online Bank Day". Matched as the same day; the names differ slightly.
- Checkiday's page was truncated at about 100,000 characters (page is about 176,000). WebFetch gives no offset parameter, so the remainder was not read. The single-day list comes before the multi-day and monthly sections, so the single-day list appears complete, but a late single-day entry could have been missed.

## Findings
### Wikipedia
Source: parsed via the API for page October_12. The CSV uses https://en.wikipedia.org/wiki/October_12 as the page URL.
- Christian feast day list (Domnina of Anazarbus, Edith Cavell and Elizabeth Fry, Fiacc, Our Lady of the Pillar, Our Lady of Aparecida, Blessed Louis Brisson, Radim Gaudentius, Blessed Roman Sitko, Seraphin of Montegranaro, Thomas Bullaker, Wilfrid of Ripon, Carlo Acutis, Eastern Orthodox liturgics) — skipped
- Children's Day (Brazil) — included
- Columbus Day (Honduras) — included
- Columbus-related observances: Día de la Hispanidad / Fiesta Nacional de España, also Armed Forces Day (Spain) — included as "Fiesta Nacional de España (Spain)"
- Día de la Raza (El Salvador, Uruguay) — included
- Día de la Resistencia Indígena (Venezuela) — included
- Día de las Américas (Belize) — included
- Día de las Culturas (Costa Rica) — included
- Día del Respeto a la Diversidad Cultural (Argentina) — included
- Discovery Day (The Bahamas) — included, see Unsure
- Feast for Life of Aleister Crowley, "Crowleymas" (Thelema) — included as "Feast for Life (Crowleymas)"
- Hafez Day (Iran) — included
- Independence Day (Equatorial Guinea) — included
- International Day Against DRM — included

### Checkiday
Source: https://www.checkiday.com/10/12/2026 (fetched; truncated at about 100,000 characters). Days listed for Monday, October 12th, 2026 (single-day observances):
- Columbus Day
- Cookbook Launch Day
- Freethought Day
- Indigenous Peoples' Day
- International Moment of Frustration Scream Day
- National Farmer's Day
- National Gumbo Day
- National Kick-Butt Day
- National Online Banking Day
- National Savings Day
- Native American Day
- Pulled Pork Day
- Thanksgiving (Canada)
- World Arthritis Day

Multi-day events starting or continuing on the date (not used): Bone and Joint Action Week; International Cephalopod Awareness Days; American Beer Week; Freethought Week; Improve Your Home Office Week; International Credit Union Week; National Chestnut Week; National Food Bank Week; National Home-based Business Week; National PA Week; National School Lunch Week; Pet Peeve Week; Teen Read Week; plus about 90 month-long observances, of which only the first part was read.

"On This Day in History" is also on the page; it is not a day.

### Days of the Year
Source: https://www.daysoftheyear.com/days/oct/12/ (fetched). Days listed for October 12:
- National Farmers Day
- National Pulled Pork Day
- World Arthritis Day
- National Gumbo Day
- National Savings Day
- International Moment of Frustration Scream Day
- National Online Bank Day
- National Heritage Day in the Turks and Caicos Islands
- National Kick Butt Day
- National Freethought Day
- National Vermont Day
- Canadian Thanksgiving
- Indigenous Peoples' Day
- Columbus Day
- Lady of Aparecida
- National Day of Spain
- Day of Respect for Cultural Diversity
- Día de la Raza

Matched with Checkiday for the fun-day rule: National Farmer's Day, National Pulled Pork Day, World Arthritis Day, National Gumbo Day, National Savings Day, International Moment of Frustration Scream Day, National Online Banking Day, National Kick-Butt Day, Freethought Day. Columbus Day, Indigenous Peoples' Day and Canadian Thanksgiving also match Checkiday but are movable. Days of the Year also lists National Day of Spain, Day of Respect for Cultural Diversity and Día de la Raza, which match Wikipedia entries.
