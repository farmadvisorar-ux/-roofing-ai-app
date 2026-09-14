# The service footprint

The app sells into eight regions across Texas and Louisiana. They are
defined in one place — `src/lib/territories.ts` — and everything else follows
from it: which storm data gets imported, how prospects are divided, where the map
jumps to, and the coverage rollups on the workbench.

| Territory | States | Hubs |
| --- | --- | --- |
| **West Louisiana** | LA | Shreveport, Bossier City, Alexandria, Lake Charles, Natchitoches, Leesville |
| **Northeast Louisiana** | LA | Tallulah, Lake Providence, Vidalia, St. Joseph, Winnsboro |
| **Southeast Louisiana** | LA | Baton Rouge, New Orleans, Metairie, Slidell, Hammond, Houma, Thibodaux |
| **East Texas** | TX | Tyler, Longview, Texarkana, Nacogdoches, Lufkin, Beaumont, Houston |
| **North Texas** | TX | Dallas, Fort Worth, Denton, Sherman, Wichita Falls, Paris |
| **Central Texas** | TX | Austin, Round Rock, Georgetown, Waco, Killeen, Temple, San Marcos |
| **South Texas** | TX | San Antonio, Corpus Christi, Laredo, McAllen, Brownsville, Victoria |
| **West Texas** | TX | Lubbock, Amarillo, Midland, Odessa, Abilene, San Angelo, El Paso |

Central Texas is not one of the four Texas regions usually named, but without it
Austin, Round Rock and Waco fall in a hole between north and south. It is
included so the footprint tiles Texas without gaps.

The three Louisiana regions tile the state the same way. West Louisiana runs from
the Sabine across to the Ouachita — it already covers Monroe and Lafayette —
while Northeast and Southeast Louisiana cover everything east of it, including
the Capital Region and Greater New Orleans.

## How a roof is assigned

`territoryForPoint(point, state)` returns the first region whose bounds contain
the point, filtered by state when the state is known. Assignment happens in
`rescoreProperty`, which every write path runs through, so a pin dropped before
enrichment gets a bounding-box guess that the geocoded state later corrects.

Order matters, and is deliberate: East Texas precedes North Texas so Tyler and
Longview resolve east; the Louisiana regions precede both so Shreveport does not
land in Texas.

Verified against 52 real city coordinates across all eight regions.

### The Sabine River caveat

A bounding box cannot follow a river. Shreveport LA (-93.75) and Orange TX
(-93.74) are a quarter of a degree apart across the state line and inseparable on
coordinates alone — on bounds only, Orange resolves to West Louisiana.

That is why the state is used first when it is known, and reverse geocoding
supplies it for anything enriched. A pin dropped and not yet enriched near the
Sabine can be assigned to the wrong side until its lookup runs, which then fixes
it. If that matters for your billing, replace the bounds test with a
point-in-polygon check against real state boundaries; nothing else has to change.

## Storm data follows the footprint

`npm run import:storms` scopes itself to the footprint's states by default —
there is no value in carrying Montana hail in a Texas and Louisiana database.

```bash
npm run import:storms                          # TX + LA archive + annual preliminary
npm run import:storms:recent                   # the daily feed — fresh storms
npm run import:storms -- --territory east-texas  # one region's bounds
npm run import:storms -- --state TX,LA,OK      # explicit states
npm run import:storms -- --all-states          # nationwide
```

Run `import:storms` when SPC publishes a new archive (annually) and
`import:storms:recent` on a schedule — nightly is plenty. The daily catch-up
records which days it has fetched, so a repeat run costs almost nothing.

A territory import pads the region's bounds slightly, because hail just outside a
boundary still falls on roofs just inside it.

The import is idempotent, and a failure in one source no longer discards another
that already succeeded — the run reports which sources failed and exits non-zero
so CI notices, with everything that did import committed.

## Changing the footprint

Add, remove or reshape a region in `src/lib/territories.ts`. Then:

1. Re-run `npm run import:storms` and `npm run import:storms:recent` so the new
   area has both historical and current hail.
2. Re-score existing properties so they pick up the new assignment — enriching a
   property reassigns it, and `rescoreProperty` does so on every write.

Nothing outside that file hard-codes a region. `GET /api/territories` serves the
definitions with live coverage, the workbench and the map both read from it, and
the `territory` query parameter on the list, export and bulk endpoints accepts any
id in it plus `none` for roofs outside the footprint.

## Reading the coverage row

Each card shows roofs held, how many are still unworked, the average score, and
the region's hail history. When there has been no hail inside the recent window,
the card shows the total and the **date of the most recent report** rather than a
bare zero — the SPC annual archive lags to the previous calendar year, and a zero
would otherwise read as "no hail here" when it means "no hail since the data
ends".
