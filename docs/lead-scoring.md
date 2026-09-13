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
npm run import:storms                    # last 10 years, hail and wind, nationwide
npm run import:storms -- --state TX      # one state
npm run import:storms -- --years 5 --kind hail
```

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

- **The SPC annual archive lags.** It covers through the previous calendar year,
  so the freshest hail is missing until the next release. A deployment that sells
  on fresh storms should also ingest SPC's current-year preliminary reports.
- **Permits and assessor data are per-county.** Both are unconfigured by default;
  without them, four of the seven signals are unavailable and scores are
  correspondingly low-confidence.
- **The weights are a starting point, not a fitted model.** They encode ordinary
  roofing-sales reasoning. With enough closed/lost outcomes they should be
  refitted against what actually converted.
