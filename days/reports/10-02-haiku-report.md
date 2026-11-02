# 10-02 — Haiku report

Status: unsure

## CSV entries
```csv
10-02,Batik Day (Indonesia),https://en.wikipedia.org/wiki/October_2;https://www.daysoftheyear.com/days/oct/02/
10-02,Gandhi Jayanti (India),https://en.wikipedia.org/wiki/October_2
10-02,Independence Day (Guinea),https://en.wikipedia.org/wiki/October_2
10-02,National Grandparents Day (Italy),https://en.wikipedia.org/wiki/October_2
10-02,International Day of Non-Violence,https://en.wikipedia.org/wiki/October_2;https://www.checkiday.com/10/2/2026;https://www.daysoftheyear.com/days/oct/02/
10-02,Audiophile Day,https://www.checkiday.com/10/2/2026;https://www.daysoftheyear.com/days/oct/02/
10-02,Kids Music Day,https://www.checkiday.com/10/2/2026;https://www.daysoftheyear.com/days/oct/02/
10-02,Manufacturing Day,https://www.checkiday.com/10/2/2026;https://www.daysoftheyear.com/days/oct/02/
10-02,National Fried Scallops Day,https://www.checkiday.com/10/2/2026;https://www.daysoftheyear.com/days/oct/02/
10-02,National Name Your Car Day,https://www.checkiday.com/10/2/2026;https://www.daysoftheyear.com/days/oct/02/
10-02,National Produce Misting Day,https://www.checkiday.com/10/2/2026;https://www.daysoftheyear.com/days/oct/02/
10-02,National Smarties Day,https://www.checkiday.com/10/2/2026;https://www.daysoftheyear.com/days/oct/02/
10-02,World Farm Animals Day,https://www.checkiday.com/10/2/2026;https://www.daysoftheyear.com/days/oct/02/
```

## Left out
- World Smile Day — movable (1st Friday of October; Oct 2, 2026 is that Friday). Listed by both fun-day sites.
- Guardian Angels Day (Checkiday) / Guardian Angel Day (Days of the Year) — feast day (Memorial of the Holy Guardian Angels).
- Memorial of the Holy Guardian Angels, Blessed Antoine Chevrier, Denha I of Tikrit, Blessed Jan Beyzym, Blessed Maria Antonina Kratochwil, Blessed María Francisca Ricart Olmos, Leodegar, October 2 (Eastern Orthodox liturgics) — feast days / saints (Wikipedia).
- National Denim Day — single source (Checkiday only).
- National Diversity Day — single source (Checkiday only).
- National Research Maniacs Food Day — single source (Checkiday only).
- Phileas Fogg's Wager Day — single source (Checkiday only).
- World No Alcohol Day — single source (Checkiday only).
- College Radio Day — single source (Days of the Year only).
- National Body Language Day — single source (Days of the Year only).
- Wakey Wakey Hospice PJ Day — single source (Days of the Year only).
- National Report Long Term Acute Care Hospital Fraud Day — single source (Days of the Year only).
- Canine Companion Day — single source (Days of the Year only).
- Sekaten — single source (Days of the Year only).
- National Custodial Worker Day (Checkiday) / National Custodial Worker Recognition Day (Days of the Year) — unsure, possibly movable; see Unsure.
- Plaidurday — unsure, possibly movable; see Unsure.
- Multi-day and month-long items on Checkiday (National Walk Your Dog Week, National Wild Rice Week, Universal Children's Week, the many "... Month" entries, etc.) — multi-day, excluded.

## Unsure
- National Custodial Worker Day / National Custodial Worker Recognition Day: both sites list it on Oct 2, but I can't confirm from the pages that it is fixed rather than a weekday-based date in October, so it is left out of the CSV. Also the two names differ slightly.
- Plaidurday: the name implies a Saturday observance. Both sites list it on Oct 2 (a Friday in 2026), so it may be date-variable. Left out of the CSV.
- Batik Day (Indonesia) and World Farm Animals Day are included on a name match only ("National Batik Day" vs "Batik Day"; "World Day for Farmed Animals" vs "World Farm Animals Day"). I judged these to be the same day.
- Wikipedia source URL: the API was used to read the section, and the CSV source uses the public page https://en.wikipedia.org/wiki/October_2 (the form the README uses), not the API URL.

## Findings
### Wikipedia
(Holidays and observances, non-feast items only; the API was fetched for page=October_2)
- Batik Day (Indonesia) — included
- Gandhi Jayanti (India) — included
- International Day of Non-Violence — included
- Independence Day (Guinea) — celebrates independence from France, 1958 — included
- National Grandparents Day (Italy) — included
- Feast days / saints, skipped: Blessed Antoine Chevrier, Denha I of Tikrit (Syriac Orthodox), Blessed Jan Beyzym, Blessed Maria Antonina Kratochwil, Blessed María Francisca Ricart Olmos, Memorial of the Holy Guardian Angels, Leodegar, October 2 (Eastern Orthodox liturgics)

### Checkiday
(https://www.checkiday.com/10/2/2026, single-day list; the page was truncated in the multi-day section, and the single-day list was complete before the cut)
- Audiophile Day
- Guardian Angels Day
- International Day of Non-Violence
- Kids Music Day
- Manufacturing Day
- National Custodial Worker Day
- National Denim Day
- National Diversity Day
- National Fried Scallops Day
- National Name Your Car Day
- National Produce Misting Day
- National Research Maniacs Food Day
- National Smarties Day
- Phileas Fogg's Wager Day
- Plaidurday
- World Day for Farmed Animals
- World No Alcohol Day
- World Smile Day

### Days of the Year
(https://www.daysoftheyear.com/days/oct/02/. The /oct/2/ URL returned 404, so the /oct/02/ form was used. The list is not truncated.)
- World Smile Day
- Kids Music Day
- College Radio Day
- Audiophile Day
- World Farm Animals Day
- International Day of Non-Violence
- National Batik Day
- National Body Language Day
- Plaidurday
- National Name Your Car Day
- Manufacturing Day
- National Custodian Day
- Guardian Angel Day
- National Smarties Day
- National Custodial Worker Recognition Day
- Wakey Wakey Hospice PJ Day
- National Fried Scallops Day
- National Report Long Term Acute Care Hospital Fraud Day
- National Produce Misting Day
- Canine Companion Day
- Sekaten
