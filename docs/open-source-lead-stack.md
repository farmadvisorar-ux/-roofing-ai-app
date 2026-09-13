# The open-source stack behind the lead system

Every part of the canvassing → enrichment → pipeline flow in this app is built on
free software and open data. Nothing here requires a per-seat SaaS contract or a
proprietary mapping SDK, and no key is needed to run it.

## What this repo actually uses

| Piece | What it does here | Licence |
| --- | --- | --- |
| [OpenStreetMap](https://www.openstreetmap.org/) raster tiles | The map you canvass on (`src/components/map/TileMap.tsx`) | Data ODbL 1.0 |
| [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) | Building footprint, `building:levels`, `roof:shape`, `roof:material`, `start_date` — one building at a time, or every building in an area for a sweep | AGPL-3.0 (data ODbL) |
| [Nominatim](https://nominatim.org/) | Reverse geocoding a pin to a street address | GPL-2.0 (data ODbL) |
| County assessor parcel layers (ArcGIS / Socrata / CKAN) | Owner of record and parcel ID | Per-county, usually public record |
| [Prisma](https://www.prisma.io/) + SQLite | `Property`, `Lead`, `Contact`, `Contract` storage | Apache-2.0 / public domain |
| [Next.js](https://nextjs.org/) + [React](https://react.dev/) + [Tailwind](https://tailwindcss.com/) | App, API routes, UI | MIT |

The map itself is written directly against the Web Mercator formulas rather than
pulling in Leaflet or MapLibre — the same choice `src/engine/` makes for 3D. If
you would rather have a full mapping library, the open-source options are
[Leaflet](https://leafletjs.com/) (BSD-2, raster, tiny),
[MapLibre GL JS](https://maplibre.org/) (BSD-3, vector, GPU) and
[OpenLayers](https://openlayers.org/) (BSD-2, projection-heavy GIS work).

## Configuration

Nothing below is required — with none of it set, the OSM lookups still run and the
parcel lookup is simply reported as not configured.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OSM_CONTACT_EMAIL` | *(unset)* | Contact address in the User-Agent. **Set this** before any real use; the OSM policy requires it. |
| `OSM_NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | Point at your own Nominatim instance. |
| `OSM_OVERPASS_URL` | `https://overpass-api.de/api/interpreter` | Point at your own Overpass instance. |
| `PARCEL_API_URL` | *(unset)* | County parcel ArcGIS layer, e.g. `https://…/FeatureServer/0`. Enables owner lookup. |
| `PARCEL_OWNER_FIELD` | auto-detected | Owner column name, if it isn't one of the common spellings. |
| `PARCEL_ID_FIELD` | auto-detected | Parcel-number column name. |
| `PARCEL_YEAR_BUILT_FIELD` | auto-detected | Year-built column name. |
| `ENRICHMENT_TIMEOUT_MS` | `15000` | Per-request timeout. |
| `PROPERTY_ENRICHMENT_OFFLINE` | *(unset)* | `1` skips the network entirely and uses derived placeholders. Handy for dev and demos. |
| `NEXT_PUBLIC_TILE_URL` | OSM tiles | Your own tile server, e.g. a self-hosted TileServer GL. |
| `NEXT_PUBLIC_TILE_ATTRIBUTION` | `© OpenStreetMap contributors` | Attribution shown on the map. |

### Using the public endpoints responsibly

The public OSM services are donated infrastructure with published usage policies,
and the code here follows them: a descriptive `User-Agent`, requests to each host
serialised at roughly one per second, one retry that honours `Retry-After`, and
visible tile attribution. They are fine for development and light field use. For
anything sustained, **run your own** — Nominatim, Overpass and a tile server all
self-host with Docker — or use a paid provider. Public Nominatim in particular
blocks datacenter IP ranges, so a cloud deployment needs its own instance.

Parcel data is public record in most US counties but the *portal* may have its own
terms. Check the county's licence before bulk use.

## The wider menu

Categories worth knowing when building any lead system, all open source.

**Geocoding & addresses.** [Nominatim](https://nominatim.org/),
[Photon](https://photon.komoot.io/) (typeahead), [Pelias](https://pelias.io/).
[libpostal](https://github.com/openvenues/libpostal) is the one to reach for early:
address de-duplication is the hardest problem in a property lead system, and
libpostal parses and normalises messy addresses into comparable parts.
[OpenAddresses](https://openaddresses.io/) publishes bulk address points.

**Building & parcel data.** OSM buildings via Overpass;
[Microsoft Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints)
(ODbL) and [Google Open Buildings](https://sites.research.google/open-buildings/)
(CC BY 4.0) cover roofs OSM has missed — both are worth importing for a roofing
product. [Overture Maps](https://overturemaps.org/) merges several of these.

**Storage & geospatial queries.** PostgreSQL with
[PostGIS](https://postgis.net/) once you outgrow SQLite — real spatial indexes,
radius and polygon queries, territory assignment. SQLite has
[SpatiaLite](https://www.gaia-gis.it/fossil/libspatialite/) if you want to stay
single-file.

**Routing for door-knocking.** [OSRM](https://project-osrm.org/) or
[Valhalla](https://valhalla.github.io/valhalla/) turn a day's pin list into a
drive order.

**Off-the-shelf CRM**, if you would rather not own the pipeline code:
[Twenty](https://twenty.com/), [EspoCRM](https://www.espocrm.com/),
[SuiteCRM](https://suitecrm.com/), [Odoo](https://www.odoo.com/) CRM,
[Krayin](https://krayincrm.com/).

**Around the edges.** Forms — [Formbricks](https://formbricks.com/),
[Typebot](https://typebot.io/). Background jobs — [BullMQ](https://bullmq.io/),
[pg-boss](https://github.com/timgit/pg-boss). Shared inbox and follow-up —
[Chatwoot](https://www.chatwoot.com/), [Listmonk](https://listmonk.app/),
[Novu](https://novu.co/). E-signature, if you outgrow `SignaturePad` —
[DocuSeal](https://www.docuseal.co/), [OpenSign](https://www.opensignlabs.com/).
Auth — [Better Auth](https://www.better-auth.com/), [Auth.js](https://authjs.dev/),
[Keycloak](https://www.keycloak.org/). Product analytics —
[PostHog](https://posthog.com/), [Umami](https://umami.is/).
Self-hosting — [Coolify](https://coolify.io/), [Dokploy](https://dokploy.com/).

## How the pieces fit in this codebase

```
src/lib/geo.ts                Mercator-free small-area maths: distances, bounds, ring geometry
src/lib/openData.ts           provider clients (Nominatim, Overpass, parcel) + politeness/retry
src/lib/roofing.ts            footprint -> sloped roof area -> squares -> price range
src/lib/propertyEnrichment.ts orchestration: run providers, merge, price, persist
src/lib/propertiesApi.ts      browser client for the routes below
src/app/api/properties/*      REST-ish handlers (list/create, sweep, detail, enrich, convert)
src/components/map/*          from-scratch tile map, pins, prospect list, detail panel
prisma/schema.prisma          the Property model and its link to Lead
```

### Two ways to canvass

**One roof at a time.** Tapping the map runs the full chain — parcel layer for the
owner, Overpass for the building, Nominatim for the address — for that one pin.

**A whole block at once.** *Sweep this view* runs a single Overpass query over the
viewport and takes each building's own tags. No per-building geocoding or parcel
lookup: those are throttled to roughly one request per second, so a 200-building
block would take several minutes and hammer donated infrastructure. Sweep for
coverage, then enrich the roofs worth pursuing.

A building's OSM way id is its identity, so re-sweeping only adds what is new.
Proximity de-duplication is reserved for hand-dropped pins, which have no id —
applying it to OSM buildings would silently drop one half of every terraced pair.

Provider results are merged **fill-empty-first**, in order of authority: the parcel
layer, then the OSM building, then the geocoder. A provider that returns nothing
never blanks a field that already had a value.

Two rules the pipeline keeps deliberately:

- **An owner name is never invented.** When the parcel layer is unavailable the
  field stays empty. A plausible-looking wrong name on a door-knock list is worse
  than a blank one.
- **Placeholders never outrank real data.** When every lookup fails, derived
  figures fill genuine gaps only — a rep's hand measurement survives a re-run —
  and the record stays `PARTIAL`, never `ENRICHED`, so nobody quotes off a guess.
  A sweep, which never consults the parcel layer, therefore leaves every owner
  blank rather than guessing from the address.
