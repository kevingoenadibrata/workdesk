# 10-23 — Haiku report

Status: success

## CSV entries
```csv
10-23,National Mole Day,https://en.wikipedia.org/wiki/October_23;https://www.checkiday.com/10/23/2026;https://www.daysoftheyear.com/days/oct/23/
10-23,Event Organizers Day,https://www.checkiday.com/10/23/2026;https://www.daysoftheyear.com/days/oct/23/
10-23,Global Champagne Day,https://www.checkiday.com/10/23/2026;https://www.daysoftheyear.com/days/oct/23/
10-23,National Boston Cream Pie Day,https://www.checkiday.com/10/23/2026;https://www.daysoftheyear.com/days/oct/23/
10-23,National Croc Day,https://www.checkiday.com/10/23/2026;https://www.daysoftheyear.com/days/oct/23/
10-23,National Horror Movie Day,https://www.checkiday.com/10/23/2026;https://www.daysoftheyear.com/days/oct/23/
10-23,National iPod Day,https://www.checkiday.com/10/23/2026;https://www.daysoftheyear.com/days/oct/23/
10-23,National Paralegal Day,https://www.checkiday.com/10/23/2026;https://www.daysoftheyear.com/days/oct/23/
10-23,National Slap Your Coworker Day,https://www.checkiday.com/10/23/2026;https://www.daysoftheyear.com/days/oct/23/
10-23,National TV Talk Show Host Day,https://www.checkiday.com/10/23/2026;https://www.daysoftheyear.com/days/oct/23/
```

## Left out
- Canning Day (National Canning Day) — single source (Checkiday only)
- National Pharmacy Buyer Day — single source (Checkiday only)
- Swallows Depart from San Juan Capistrano Day — single source (Checkiday only)
- International Snow Leopard Day — single source (Days of the Year only)
- Medical Assistants Recognition Day — single source (Days of the Year only)
- Christian feast days/saints on the Wikipedia list (Feast of the Most Holy Redeemer, James the Just, Æthelflæd of Romsey, Boethius, John of Capistrano, etc.) — feast days, skipped
- Weeks and months listed on both fun-day sites (e.g. National Chemistry Week, Dysautonomia Awareness Month, Red Ribbon Week, Bat Appreciation Month) — multi-day
- Trending entries on Days of the Year (National Chocolate Cupcake Day, World Menopause Day, etc.) — dated October 18 or elsewhere, not this date

## Unsure
None

## Findings
### Wikipedia
Source: parsed via the API for page October_23; the CSV uses https://en.wikipedia.org/wiki/October_23 as the page URL.
- Christian feast day list (saints, Blessed, Eastern Orthodox liturgics link, Christmas/Feast of Señor Noemi) — skipped
- Mole Day (International observance) — included as "National Mole Day", also on Checkiday and Days of the Year

### Checkiday
Source: https://www.checkiday.com/10/23/2026 (raw HTML fetched with curl; the WebFetch summary was truncated at 100000 characters, but the day list is at the top of the page and was complete in the raw HTML). The "Holidays for Friday, October 23rd, 2026" list has 13 single-day entries:
- Event Organizers Day
- Global Champagne Day
- National Boston Cream Pie Day
- National Canning Day
- National Croc Day
- National Horror Movie Day
- National iPod Day
- National Mole Day
- National Pharmacy Buyer Day
- National Slap Your Irritating Co-Worker Day
- Paralegal Day
- Swallows Depart from San Juan Capistrano Day
- TV Talk Show Host Day

Also listed: "On This Day in History" (a feature, not a day) and a "Multi-day Events Continuing on Friday, October 23rd, 2026" section (weeks, months, and UN decades), all of which were not used.

### Days of the Year
Source: https://www.daysoftheyear.com/days/oct/23/ (raw HTML fetched with curl; two WebFetch summaries of this page disagreed with each other, so the raw HTML was used). The "October 23 Holidays" section lists 12 single-day entries:
- Global Champagne Day
- International Snow Leopard Day
- Medical Assistants Recognition Day
- National Boston Cream Pie Day
- National Croc Day
- National Horror Movie Day
- National iPod Day
- National Mole Day
- National Paralegal Day
- National Slap Your Coworker Day
- National TV Talk Show Host Day
- Event Organizers Day

Also listed under "Other holidays on October 23": weeks and months (e.g. National Chemistry Week, Free Speech Week, Red Ribbon Week), which are multi-day and were not used.

### Name matching notes
- "National Slap Your Irritating Co-Worker Day" (Checkiday) and "National Slap Your Coworker Day" (Days of the Year) are the same day; the CSV uses the Days of the Year wording.
- "Paralegal Day" (Checkiday) and "National Paralegal Day" (Days of the Year), and "TV Talk Show Host Day" and "National TV Talk Show Host Day", were matched the same way.
