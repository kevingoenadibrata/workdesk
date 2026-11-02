# 10-09 — Haiku report

Status: success

## CSV entries
```csv
10-09,Curious Events Day,https://www.checkiday.com/10/9/2026;https://www.daysoftheyear.com/days/oct/09/
10-09,Fire Prevention Day,https://en.wikipedia.org/wiki/October_9;https://www.checkiday.com/10/9/2026;https://www.daysoftheyear.com/days/oct/09/
10-09,Hangul Day (South Korea),https://en.wikipedia.org/wiki/October_9
10-09,Independence Day (Uganda),https://en.wikipedia.org/wiki/October_9
10-09,Independence of Guayaquil (Ecuador),https://en.wikipedia.org/wiki/October_9
10-09,Indian Foreign Service Day,https://en.wikipedia.org/wiki/October_9
10-09,International Beer and Pizza Day,https://www.checkiday.com/10/9/2026;https://www.daysoftheyear.com/days/oct/09/
10-09,Leif Erikson Day,https://en.wikipedia.org/wiki/October_9;https://www.checkiday.com/10/9/2026;https://www.daysoftheyear.com/days/oct/09/
10-09,National Day of Commemorating the Holocaust (Romania),https://en.wikipedia.org/wiki/October_9
10-09,National Moldy Cheese Day,https://www.checkiday.com/10/9/2026;https://www.daysoftheyear.com/days/oct/09/
10-09,National Nanotechnology Day (United States),https://en.wikipedia.org/wiki/October_9
10-09,National Sneakers Day,https://www.checkiday.com/10/9/2026;https://www.daysoftheyear.com/days/oct/09/
10-09,Scrubs Day,https://www.checkiday.com/10/9/2026;https://www.daysoftheyear.com/days/oct/09/
10-09,World Post Day,https://en.wikipedia.org/wiki/October_9;https://www.checkiday.com/10/9/2026;https://www.daysoftheyear.com/days/oct/09/
```

## Left out
- Vet Nurse Day — movable (Checkiday: observed the second Friday in October)
- World Egg Day — movable (Checkiday: observed the second Friday in October)
- National Haunted House Day — movable (Checkiday: observed the second Friday in October)
- National Polenta Day (Italy) — single source (Checkiday only)
- National Pro-Life Cupcake Day — single source (Checkiday only)
- Nautilus Night — single source (Checkiday only)
- Submarine-Hoagie-Hero-Grinder Day — single source (Checkiday only)
- PANS/PANDAS Awareness Day — single source (Days of the Year only)
- National C60 Day — single source (Days of the Year only)
- Takayama Autumn Festival (Japan) — multi-day (festival runs over two days)
- Christian feast days and saints listed on Wikipedia (Abraham, Denis of Paris, Dionysius the Areopagite, Ghislain, Gunther of Bohemia, Innocencio of Mary Immaculate and Martyrs of Turon, John Henry Newman, John Leonardi, Luis Beltran, Robert Grosseteste, Wilfred Grenfell) and "October 9 (Eastern Orthodox liturgics)" — feast day

## Unsure
None

## Findings
### Wikipedia
Source: https://en.wikipedia.org/wiki/October_9 (fetched via API)
- Fire Prevention Day (Canada, United States)
- Hangul Day (South Korea)
- Independence Day (Uganda)
- Independence of Guayaquil from Spain in 1820 (Ecuador)
- Leif Erikson Day (United States, Iceland and Norway)
- National Day of Commemorating the Holocaust (Romania)
- National Nanotechnology Day (United States)
- Takayama Autumn Festival (Takayama, Japan)
- World Post Day
- Indian Foreign Service Day
- Christian feast day entries (saints and "October 9 (Eastern Orthodox liturgics)") — excluded

### Checkiday
Source: https://www.checkiday.com/10/9/2026
Fixed date:
- Curious Events Day
- Fire Prevention Day
- International Beer and Pizza Day
- Leif Erikson Day
- National Moldy Cheese Day
- National Polenta Day (Italy)
- National Pro-Life Cupcake Day
- National Sneakers Day
- Nautilus Night
- Scrubs Day
- Submarine-Hoagie-Hero-Grinder Day
- World Post Day

Movable date (second Friday in October):
- National Haunted House Day
- Vet Nurse Day
- World Egg Day

Truncation: the page is about 178,000 characters and the tool returned only the first 100,000. The single-day list is complete within that part; the cut-off falls in the multi-day events section (Customer Service Week, Drive Safely Work Week, International Cephalopod Awareness Days, Teller Appreciation Week, and others). The WebFetch tool here has no offset parameter, so the remainder was not read.

### Days of the Year
Source: https://www.daysoftheyear.com/days/oct/09/
- International Beer and Pizza Day
- World Egg Day
- Curious Events Day
- National Moldy Cheese Day
- World Post Day
- PANS/PANDAS Awareness Day
- Scrubs Day
- National Leif Erikson Day
- National Sneakers Day
- Vet Nurse Day
- National C60 Day
- Fire Prevention Day

Some descriptions were cut off on the page (PANS/PANDAS, Leif Erikson, Sneakers, C60). The count of 12 days matches the page's own count.
