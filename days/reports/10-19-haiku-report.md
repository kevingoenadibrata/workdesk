# 10-19 — Haiku report

Status: success

## CSV entries
```csv
10-19,Constitution Day (Niue),https://en.wikipedia.org/wiki/October_19
10-19,Evaluate Your Life Day,https://www.checkiday.com/10/19/2026;https://www.daysoftheyear.com/days/oct/19/
10-19,International Gin and Tonic Day,https://www.checkiday.com/10/19/2026;https://www.daysoftheyear.com/days/oct/19/
10-19,National LGBT Center Awareness Day,https://www.checkiday.com/10/19/2026;https://www.daysoftheyear.com/days/oct/19/
10-19,National New Friends Day,https://www.checkiday.com/10/19/2026;https://www.daysoftheyear.com/days/oct/19/
10-19,National Seafood Bisque Day,https://www.checkiday.com/10/19/2026;https://www.daysoftheyear.com/days/oct/19/
10-19,Oxfordshire Day,https://en.wikipedia.org/wiki/October_19
10-19,World Pediatric Bone and Joint Day,https://www.checkiday.com/10/19/2026;https://www.daysoftheyear.com/days/oct/19/
```

## Left out
- Dress Like a Dork Day — single source (Checkiday only)
- Rainforest Day — single source (Checkiday only)
- International Adjust your Chair Day — movable (Checkiday: "Observed the third Monday in October"); also single source
- Multicultural Diversity Day (National Multicultural Diversity Day) — movable (Checkiday: third Monday in October); also single source
- National Clean Your Virtual Desktop Day — movable (Checkiday: third Monday in October); listed by both sites, so movable is the only reason it is out
- Christian feast days / saints (Wikipedia) — feast days (Aaron, Blessed Agnes of Jesus, Aquilinus of Évreux, Desiderius of Auxerre, Frideswide, Henry Martyn, Isaac Jogues / Jean de Brébeuf and Companions, Blessed Jerzy Popiełuszko, Paul of the Cross, Ptolemaeus and Lucius, Varus, Veranus of Cavaillon, William Carey, October 19 Eastern Orthodox liturgics)
- Checkiday multi-day section (e.g. Week-long and 7–47-day events starting or continuing on Oct 19) — multi-day
- Days of the Year "Other holidays on October 19" (National Chemistry Week, National Baking Week, National Parenting Week, Free Speech Week, etc.) — multi-day

## Unsure
None

## Findings
### Wikipedia
(Holidays and observances, non-feast items only; the API was fetched for page=October_19 with a User-Agent header, the first attempt without one returned no JSON)
- Constitution Day, in honor of Niue's independence (self-governing in free association with New Zealand) in 1974 (Niue) — included
- Oxfordshire Day — included
- Feast days / saints, skipped: Aaron (Coptic Orthodox Church of Alexandria), Blessed Agnes of Jesus, Aquilinus of Évreux, Desiderius (Didier) of Auxerre, Frideswide, Henry Martyn (Anglican Communion), Isaac Jogues, Jean de Brébeuf, and Companions, Blessed Jerzy Popiełuszko, Paul of the Cross, Ptolemaeus and Lucius, Varus, Veranus of Cavaillon, William Carey (Episcopal Church), October 19 (Eastern Orthodox liturgics)

### Checkiday
(https://www.checkiday.com/10/19/2026, fetched in full with curl and text-extracted; the single-day list was complete before the multi-day section)
- Dress Like a Dork Day
- Evaluate Your Life Day
- International Adjust your Chair Day (third Monday in October)
- International Gin and Tonic Day
- LGBT Center Awareness Day
- Multicultural Diversity Day (third Monday in October)
- National Clean Your Virtual Desktop Day (third Monday in October)
- National Seafood Bisque Day
- New Friends Day
- Rainforest Day
- World Pediatric Bone and Joint Day

### Days of the Year
(https://www.daysoftheyear.com/days/oct/19/, fetched in full with curl and text-extracted; the page reports "Skip to all 7 days")
- International Gin and Tonic Day
- National New Friends Day
- National Clean Your Virtual Desktop Day
- National LGBT Center Awareness Day
- Evaluate Your Life Day
- National Seafood Bisque Day
- World Pediatric Bone and Joint Day
