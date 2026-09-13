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
   convertible into a pipeline lead in one step. Built on OpenStreetMap and county parcel layers,
   with a from-scratch tile map rather than a mapping SDK.

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
npm run dev
```

Open `http://localhost:3000`:

- `/configurator` — design a shed in 3D, get a live price, submit a quote (creates a CRM lead)
- `/map` — canvassing map: tap roofs to pin, enrich, measure and price them, then convert to leads
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
src/lib/openData.ts  OpenStreetMap / parcel-layer clients used to enrich a property
src/lib/propertyEnrichment.ts  runs those lookups, merges them, prices the roof, saves it
src/components/     React UI: 3D viewer, AR viewer, configurator, CRM screens
src/components/map/  canvassing map: tile map, pins, property detail panel
src/app/api/         REST-ish route handlers backed by Prisma (leads, contracts, properties)
prisma/schema.prisma  Contact / Lead / ShedConfig / Contract / Property models
```

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

## Notes on the AR fallback

True 6DoF world-tracked AR requires WebXR `immersive-ar` (Chrome on Android today). Browsers
without it get a simplified camera-passthrough preview: the shed is rendered over the live rear
camera feed and you look around it with touch-orbit rather than by moving the phone. Both paths
render through the same `src/engine` renderer and mesh — there's no separate "fallback 3D".
