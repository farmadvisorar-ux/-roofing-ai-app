# RoofAI Sheds

A shed sales app with three pieces baked into one codebase:

1. **A proprietary, plugin-free 3D engine** — hand-written WebGL2 renderer (no three.js, no
   Babylon, no Unity WebGL export) that runs in any modern browser. It procedurally builds shed
   geometry (walls, gable/lean-to/gambrel roofs, doors, windows) from a config object.
2. **AR placement from a customer's phone** — the same engine drives a WebXR (`immersive-ar`)
   hit-test session so a customer can drop the shed onto their real yard. Browsers without WebXR
   (e.g. iOS Safari) get a camera-passthrough fallback that reuses the same renderer.
3. **A CRM with financing/RTO baked in** — every configurator quote automatically creates a
   Contact + Lead + saved shed config, tracked through a pipeline (New → Contacted → Quoted →
   Negotiating → Won/Lost), with cash/finance/rent-to-own contract generation, amortization
   schedules, and e-signature capture.
4. **A canvassing map that generates its own leads** — tap a roof, and it is pinned, looked up in
   open data (address, owner of record, building footprint, roof shape), measured, priced, and
   convertible into a pipeline lead in one step. Or sweep the whole visible block at once and get
   every roof in it pinned and priced, ranked best-first. Built on OpenStreetMap and county parcel
   layers, with a from-scratch tile map rather than a mapping SDK.
5. **A defined service footprint** — six regions across Texas and western Louisiana (North, East,
   West, South and Central Texas, plus West Louisiana). Every roof is assigned to one, storm data
   is imported to match, the map jumps between them, and the workbench shows live coverage per
   region. See [docs/service-footprint.md](docs/service-footprint.md).
6. **Buying signals and an explainable score** — roof age against material service life, observed
   NOAA hail near the address, ownership changes, assessed value, wind exposure, and roofing
   permits that suppress a roof already done. Every point is attributable to a named signal, and
   missing data lowers confidence rather than scoring as bad. The `/prospects` workbench sorts,
   filters, exports and bulk-converts on it, and every change is recorded in a per-property audit
   trail.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4
- Prisma 7 + SQLite (via the `better-sqlite3` driver adapter)
- No 3D/AR libraries — `src/engine/*` is a from-scratch WebGL2 renderer, math library, orbit
  controls, and WebXR session controller
- `qrcode` for generating the "scan to view in AR" QR codes (unrelated to the 3D/AR rendering
  itself)
- No mapping library either — `src/components/map/TileMap.tsx` is a small slippy map written
  against the Web Mercator formulas, over OpenStreetMap raster tiles
- Property enrichment runs on open data only: OpenStreetMap (Nominatim + Overpass) and your
  county's parcel layer. See [docs/open-source-lead-stack.md](docs/open-source-lead-stack.md).

## Getting started

```bash
npm install
npx prisma migrate dev   # creates dev.db and applies the schema
npm run db:seed          # optional: adds sample leads and canvassing pins
npm run import:storms    # optional: NOAA hail/wind reports, for the hail signal
npm run dev
```

`import:storms` pulls the last 10 years of NOAA SPC severe-weather reports (public
domain) into a local table, scoped by default to the service footprint's states —
Texas and Louisiana. Narrow it with `-- --territory east-texas`, widen it with
`-- --all-states`. Without it the hail signal simply reports itself as unavailable.

Open `http://localhost:3000`:

- `/configurator` — design a shed in 3D, get a live price, submit a quote (creates a CRM lead)
- `/map` — canvassing map: tap roofs to pin, enrich, measure and price them, then convert to leads
- `/prospects` — workbench over every canvassed roof: score, filters, sorting, CSV export, bulk
  convert, and a drawer explaining each score signal by signal
- `/ar?leadId=...` (or `/ar?<config query params>`) — open on a phone to place the shed in AR
- `/crm` — pipeline board of leads
- `/crm/leads/[id]` — lead detail, saved 3D config, AR QR code
- `/crm/leads/[id]/contract` — build a cash/finance/RTO contract, sign it

## How the pieces fit together

```
src/engine/        proprietary WebGL2 3D engine (math, geometry, renderer, orbit controls, WebXR)
src/lib/shed.ts     shed configuration type + pricing model (shared client/server)
src/lib/financing.ts loan/RTO payment math (shared client/server)
src/lib/roofing.ts   roof measurement + re-roof estimate math (shared client/server)
src/lib/openData.ts  OpenStreetMap / parcel / permit / weather clients
src/lib/localSignals.ts  hail and neighbourhood signals queried from our own tables
src/lib/territories.ts  the service footprint: regions, bounds, point-to-region lookup
src/lib/signals.ts   the lead scoring model (see docs/lead-scoring.md)
src/lib/propertyEnrichment.ts  runs those lookups, merges them, prices the roof, saves it
src/lib/propertyScoring.ts  scores a stored property and appends to its audit trail
src/components/     React UI: 3D viewer, AR viewer, configurator, CRM screens
src/components/map/  canvassing map: tile map, pins, property detail panel
src/components/prospects/  workbench table, score breakdown, signals, activity trail
src/app/api/         REST-ish route handlers backed by Prisma (leads, contracts, properties)
prisma/schema.prisma  Contact / Lead / ShedConfig / Contract / Property / StormEvent models
```

## Service footprint

Six regions across Texas and western Louisiana, defined once in
`src/lib/territories.ts`: **West Louisiana**, **East Texas**, **North Texas**,
**Central Texas**, **South Texas** and **West Texas**. Properties are assigned on
write, the storm import scopes itself to the footprint's states, the map has a
jump control, and `/prospects` shows roofs, unworked count, average score and hail
history per region. Full detail, including how to change the boundaries and the
Sabine River caveat: [docs/service-footprint.md](docs/service-footprint.md).

## Scoring

Each roof carries a 0–100 score built from roof age, observed hail, ownership
changes, job size, wind exposure, assessed value and nearby won work, with a
roofing permit acting as a suppressor rather than a penalty. Missing signals lower
*confidence* instead of the score, and a score built on thin evidence is damped
toward a neutral prior so one lucky signal cannot rank an unknown roof above a
qualified one. Full model, weights and caveats:
[docs/lead-scoring.md](docs/lead-scoring.md).

The configurator builds a `ShedConfigInput` client-side, renders it with `buildShedMesh()` +
`Renderer`, and on "Get my quote" POSTs it to `/api/leads`, which atomically creates a `Contact`,
`Lead` (stage `NEW`, source `CONFIGURATOR`), and `ShedConfig` row — so every 3D session is already
a tracked CRM lead, not a separate import step. The AR link encodes the same config so it can be
opened on a phone without a round trip, or `?leadId=` to reload a saved quote's exact config.

## Canvassing → lead

A tap on the map `POST`s to `/api/properties`, which drops a pin (deduplicating
against any pin already within 30 ft of the same roof) and runs the enrichment
pipeline: the county parcel layer for the owner of record, Overpass for the OSM
building footprint and roof tags, Nominatim for the street address. The footprint
is turned into an actual sloped roof area — pitch inferred from roof shape, plus a
complexity factor for hips and curves — and priced per square, with surcharges for
steep pitches, upper storeys and premium materials.

Providers are optional and independent: any of them being unconfigured or down
leaves the property `PARTIAL` with the reasons recorded, never a failed request.
An owner name is only ever taken from a parcel record — the pipeline does not
invent one — and derived placeholder figures never overwrite real data or promote
a property to `ENRICHED`.

`POST /api/properties/:id/lead` then creates the Contact + Lead (source
`CANVASSING`) with the roof estimate as its pipeline value, and it shows up on
`/crm` alongside configurator quotes. Unlike the configurator form, it does not
require an email or phone — when you are door-knocking you have an address long
before you have contact details.

### Sweeping a whole block

**Sweep this view** (`POST /api/properties/sweep`) pins every building in the
visible area in one Overpass query rather than one tap at a time. Most OSM
buildings carry their own `addr:*` tags, so a sweep usually gets addresses for
free; it deliberately does *not* geocode or look up owners per building, since
that would be hundreds of throttled requests. Run the full per-property
enrichment on the roofs worth pursuing.

Sweeps are safe to repeat: a building's OSM way id is its identity, so re-sweeping
a block adds only what is new. Proximity de-duplication applies only to
hand-dropped pins, which have no id — two OSM buildings are two buildings even
when they share a party wall. Garages, sheds and footprints under 400 sq ft are
skipped, and the area is capped at 1 sq mi per sweep.

## Notes on the AR fallback

True 6DoF world-tracked AR requires WebXR `immersive-ar` (Chrome on Android today). Browsers
without it get a simplified camera-passthrough preview: the shed is rendered over the live rear
camera feed and you look around it with touch-orbit rather than by moving the phone. Both paths
render through the same `src/engine` renderer and mesh — there's no separate "fallback 3D".
