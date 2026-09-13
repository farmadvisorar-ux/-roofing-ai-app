# How a roof gets scored

Every canvassed property carries a 0–100 score. It answers one question: **of the
roofs on this street, which should the rep knock on first?**

The score is deliberately explainable. Every point is attributable to a named
signal, visible in the app on both the map panel and the prospects drawer,
because "why is this an 84?" has to have an answer a sales manager can argue
with.

## The signals

| Signal | Weight | Where it comes from | What it means |
| --- | --- | --- | --- |
| Roof age | 28 | `yearBuilt` (OSM `start_date` or the assessor) vs the service life of `roofMaterial` | The strongest predictor in roofing. Ramps from nothing at half life to full at end of life. |
| Hail exposure | 25 | NOAA SPC storm reports, imported locally | Observed hail near the address. Size decides whether the roof is damaged, recency whether the owner can still claim. |
| Recent sale | 14 | County assessor parcel layer | A new owner is making decisions about the house. |
| Job size | 13 | Measured roof squares | Revenue per door knocked. |
| Wind exposure | 8 | Open-Meteo historical archive | Damaging-gust days. A minor signal — see the caveat below. |
| Property value | 8 | Assessor | Ability to pay. |
| Neighbourhood | 4 | Our own won leads nearby | Social proof on the doorstep, and a tighter route. |

Plus one **suppressor**, which is a multiplier rather than points:

| Signal | Effect | Source |
| --- | --- | --- |
| Roofing permit | Scales the whole score down, easing back over 12 years | Municipal permits layer |

A roofing permit pulled two years ago means that roof is done. No combination of
age and hail makes it worth a visit, so permits are allowed to override
everything else rather than being averaged in with them.

## Three rules the model keeps

**1. Missing data is not bad data.** A property with no year built is not a cold
lead, it is an unknown one. Unavailable signals are dropped from the denominator
and reported as reduced *confidence* rather than dragging the score down.

**2. Thin evidence cannot produce a strong claim.** Normalising over only the
signals we have would let a single lucky one — "it's a big roof" — rank an
otherwise unknown property above a fully-qualified lead, sending reps to the
wrong doors. The normalised score is therefore shrunk toward a neutral prior (25)
in proportion to how much of the model had data:

```
final = (base × confidence + 25 × (1 − confidence)) × suppression
```

Both figures are shown, so the drawer can say "76 on the signals we have,
adjusted to 61 for coverage".

**3. Below 25% coverage, a property is UNRATED, not cold.** "Cold" is a verdict.
A roof nobody has looked up has not earned one, and labelling it cold would
quietly bury it in a sorted work queue.

## Bands

`HOT` ≥ 70 · `WARM` ≥ 50 · `COOL` ≥ 30 · `COLD` below · `UNRATED` under 25%
confidence, whatever the number.

## Why hail is imported rather than fetched

Hail is the signal that decides which roofs are worth knocking on, and it is not
available from a general weather API. Open-Meteo's archive is ERA5 reanalysis,
which resolves sustained wind well but does not resolve convection at all —
querying it for hail-bearing thunderstorm codes returns zero days for Denver,
Miami and central Texas alike. Worse, ranking on max wind gust alone puts Seattle
*above* Texas hail alley, which is exactly backwards for roofing.

So hail comes from NOAA's Storm Prediction Center, which publishes every US hail
and wind report since 1955 as public-domain CSV. `npm run import:storms` loads
them into the local `StormEvent` table:

```bash
npm run import:storms                            # archive + annual preliminary
npm run import:storms:recent                     # the daily feed, for fresh storms
npm run import:storms -- --territory east-texas  # one region
npm run import:storms -- --state TX,LA           # explicit states
npm run import:storms -- --all-states            # nationwide
```

With no scope given both import the states in the
[service footprint](service-footprint.md) rather than the whole country. The two
commands cover different feeds — see below.

## Three feeds, three freshnesses

SPC publishes the same events three ways, trading quality against currency:

| Feed | File | Covers | Quality |
| --- | --- | --- | --- |
| Archive | `1955-YYYY_hail.csv.zip` | through the last completed review | Quality-controlled |
| Annual | `YYYY_hail.csv` | this year so far, once published | Preliminary |
| Daily | `YYMMDD_rpts_hail.csv` | one convective day | Preliminary |

Selling on fresh storms needs the daily feed; trusting the numbers needs the
archive. So all three are ingested, preliminary rows carry `preliminary: true`,
and when the archive later covers a year its preliminary rows for that year are
deleted. The feeds share no identifier — the same storm arrives under different
keys — so superseding by year is what stops one event being counted twice.

`npm run import:storms` handles the archive and annual tiers and discovers the
newest archive year rather than assuming one. `npm run import:storms:recent`
handles the daily tier: it records which days it has pulled, so it is safe on a
cron and asks only for what it is missing. Today and yesterday are deliberately
re-fetched each run, because those files are still filling.

### Two format traps, both verified against the real files

**Archive timestamps are CST, not UTC.** The `tz` column is `3`, SPC's code for
CST, and every modern row uses it. Reading those times as UTC dates a third of
all reports a day early — and makes the archive disagree with the daily feed
about the same physical event.

**A daily file covers a convective day, 12Z to 12Z.** A report timed before 1200
belongs to the *following* calendar day. Get this wrong and two thirds of a busy
evening's hail lands on the wrong date.

Both are handled, and the cross-check that proves it: one New Mexico report
appears in `250615_rpts_hail.csv` at `Time=0000` and in the archive at
`2025-06-15 18:00:00`. Parsed correctly, both resolve to the same instant —
`2025-06-16T00:00:00Z`.

Holding them locally means scoring a property costs an indexed radius query
(single-digit milliseconds) instead of a third-party API call per address — which
is what makes scoring a 300-building sweep practical. Re-running the import is
idempotent.

Wind exposure still comes from Open-Meteo, honestly labelled as wind and weighted
accordingly. Its responses are cached by grid cell: Open-Meteo resolves to about
0.1°, so every house on a street returns the same weather and a whole sweep costs
one request.

## Tuning

| Variable | Default | Effect |
| --- | --- | --- |
| `HAIL_SEARCH_RADIUS_MI` | `10` | How far from the pin hail still counts. |
| `HAIL_WINDOW_YEARS` | `5` | Hail lookback. |
| `NEIGHBOUR_RADIUS_MI` | `0.5` | What counts as "nearby" for won work. |
| `STORM_WINDOW_YEARS` | `5` | Wind lookback. |
| `SEVERE_GUST_MPH` | `50` | Gust speed that counts as a damaging day. |
| `SPC_HAIL_URL` / `SPC_WIND_URL` | SPC archives | Point at a newer or mirrored archive. |

## Known limits

- **Preliminary reports are unverified.** The daily feed is raw spotter and
  public reports; SPC removes duplicates and corrects sizes during quality
  control. A score resting on a preliminary report says so, in the workbench
  drawer and on the territory card. Treat a preliminary 4" report as a reason to
  go and look, not as a measurement.
- **Permits and assessor data are per-county.** Both are unconfigured by default;
  without them, four of the seven signals are unavailable and scores are
  correspondingly low-confidence.
- **The weights are a starting point, not a fitted model.** They encode ordinary
  roofing-sales reasoning. With enough closed/lost outcomes they should be
  refitted against what actually converted.
