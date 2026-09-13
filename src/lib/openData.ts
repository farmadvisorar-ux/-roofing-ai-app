// Open-data clients used to enrich a canvassed property.
//
// Everything here is free/open software or open data:
//   - Nominatim  (OpenStreetMap geocoder, AGPL)  -> street address for a pin
//   - Overpass   (OpenStreetMap query API, AGPL) -> building footprint + roof tags
//   - ArcGIS/Socrata county parcel endpoints     -> owner of record (per-county, opt-in)
//
// No provider is required: each one reports whether it is configured, and the
// pipeline merges whatever comes back. See docs/open-source-lead-stack.md.
import {
  GeoBounds,
  GeoPoint,
  pointInRing,
  ringAreaSqFt,
  ringPointOnSurface,
} from "@/lib/geo";

export type { GeoPoint };

/** Everything a provider can contribute about a property. All fields optional. */
export interface PropertyFacts {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  ownerName?: string | null;
  parcelId?: string | null;
  osmRef?: string | null;
  footprintSqFt?: number | null;
  buildingLevels?: number | null;
  roofShape?: string | null;
  roofMaterial?: string | null;
  yearBuilt?: number | null;

  // Buying signals (src/lib/signals.ts turns these into a score).
  assessedValue?: number | null;
  lastSaleDate?: string | null;
  lastSalePrice?: number | null;
  lastPermitDate?: string | null;
  lastPermitType?: string | null;
  roofPermitDate?: string | null;
  stormWindowYears?: number | null;
  severeStormDays?: number | null;
  peakGustMph?: number | null;
}

export interface OpenDataProvider {
  id: string;
  label: string;
  /** False when this deployment has not configured the provider (e.g. no parcel endpoint). */
  configured: boolean;
  lookup(point: GeoPoint): Promise<PropertyFacts | null>;
}

const REQUEST_TIMEOUT_MS = Number(process.env.ENRICHMENT_TIMEOUT_MS ?? 15000);
/** Overpass answers 503 when its slots are busy and 429 when rate-limited; both mean "retry later". */
const RETRY_STATUSES = new Set([429, 503]);
const MAX_ATTEMPTS = 2;

/**
 * OSM's usage policy asks for a descriptive User-Agent with contact info and at
 * most one request per second. Both are honoured here — see
 * https://operations.osmfoundation.org/policies/nominatim/
 */
function userAgent(): string {
  const contact = process.env.OSM_CONTACT_EMAIL ?? "unset-contact@example.invalid";
  return `RoofAI-Sheds-Canvassing/0.1 (+${contact})`;
}

/** Per-host politeness gate: serializes calls and spaces them out. */
const lastRequestAt = new Map<string, number>();
const hostQueue = new Map<string, Promise<unknown>>();

async function politeFetch(url: string, minIntervalMs: number, init?: RequestInit): Promise<Response> {
  const host = new URL(url).host;
  const attempt = async (): Promise<Response> => {
    const since = Date.now() - (lastRequestAt.get(host) ?? 0);
    const wait = minIntervalMs - since;
    if (wait > 0) await sleep(wait);
    lastRequestAt.set(host, Date.now());
    return fetch(url, {
      ...init,
      headers: { "User-Agent": userAgent(), ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      // These are third-party lookups on a POST path; never let Next cache them.
      cache: "no-store",
    });
  };

  const run = async (): Promise<Response> => {
    let res = await attempt();
    for (let n = 1; n < MAX_ATTEMPTS && RETRY_STATUSES.has(res.status); n++) {
      await sleep(retryDelayMs(res, n * minIntervalMs));
      res = await attempt();
    }
    return res;
  };

  // Chain onto this host's queue so two concurrent enrichments stay polite.
  const prior = hostQueue.get(host) ?? Promise.resolve();
  const next = prior.then(run, run);
  hostQueue.set(
    host,
    next.catch(() => undefined),
  );
  return next;
}

// ---------------------------------------------------------------------------
// Nominatim — reverse geocoding (pin -> street address)
// ---------------------------------------------------------------------------

interface NominatimAddress {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  state?: string;
  postcode?: string;
}

interface NominatimResponse {
  address?: NominatimAddress;
  error?: string;
}

export const nominatimProvider: OpenDataProvider = {
  id: "nominatim",
  label: "OpenStreetMap Nominatim (reverse geocode)",
  configured: true,
  async lookup(point) {
    const base = process.env.OSM_NOMINATIM_URL ?? "https://nominatim.openstreetmap.org";
    const url =
      `${base.replace(/\/$/, "")}/reverse?format=jsonv2&addressdetails=1&zoom=18` +
      `&lat=${encodeURIComponent(point.lat)}&lon=${encodeURIComponent(point.lng)}`;

    const res = await politeFetch(url, 1100);
    if (!res.ok) throw new Error(`Nominatim returned ${res.status}`);
    const body = (await res.json()) as NominatimResponse;
    if (body.error || !body.address) return null;

    const a = body.address;
    const street = [a.house_number, a.road].filter(Boolean).join(" ").trim();
    return {
      address: street || null,
      city: a.city ?? a.town ?? a.village ?? a.hamlet ?? null,
      state: a.state ?? null,
      zip: a.postcode ?? null,
    };
  },
};

// ---------------------------------------------------------------------------
// Overpass — the building under the pin (footprint, storeys, roof tags)
// ---------------------------------------------------------------------------

interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

/** Metres around the pin to look for a building. */
const BUILDING_SEARCH_RADIUS_M = 30;

export const overpassProvider: OpenDataProvider = {
  id: "overpass",
  label: "OpenStreetMap Overpass (building footprint + roof tags)",
  configured: true,
  async lookup(point) {
    const url = process.env.OSM_OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
    const query =
      `[out:json][timeout:25];` +
      `way(around:${BUILDING_SEARCH_RADIUS_M},${point.lat},${point.lng})["building"];` +
      `out tags geom;`;

    const res = await politeFetch(url, 1100, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: query }).toString(),
    });
    if (!res.ok) throw new Error(`Overpass returned ${res.status}`);

    const body = (await res.json()) as OverpassResponse;
    const building = pickBuilding(body.elements ?? [], point);
    if (!building) return null;

    return buildingFacts(building);
  },
};

function elementRing(element: OverpassElement): GeoPoint[] {
  return (element.geometry ?? []).map((p) => ({ lat: p.lat, lng: p.lon }));
}

/** Everything one OSM building element tells us. */
function buildingFacts(element: OverpassElement): PropertyFacts {
  const tags = element.tags ?? {};
  const ring = elementRing(element);
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ").trim();

  return {
    osmRef: `${element.type}/${element.id}`,
    footprintSqFt: ring.length >= 3 ? Math.round(ringAreaSqFt(ring)) : null,
    buildingLevels: parseIntOrNull(tags["building:levels"]),
    roofShape: tags["roof:shape"] ?? null,
    roofMaterial: tags["roof:material"] ?? null,
    yearBuilt: parseYearOrNull(tags["start_date"]),
    address: street || null,
    city: tags["addr:city"] ?? null,
    state: tags["addr:state"] ?? null,
    zip: tags["addr:postcode"] ?? null,
  };
}

// --- Area sweep: every building in a bounding box, in one query ------------

/** Structures that are never a roofing job — garden sheds, garages, kiosks. */
const SWEEP_SKIP_BUILDING_TYPES = new Set([
  "garage",
  "garages",
  "shed",
  "carport",
  "roof",
  "greenhouse",
  "hut",
  "bunker",
  "container",
  "tent",
  "kiosk",
  "transformer_tower",
  "silo",
  "storage_tank",
  "service",
]);

/** Below this a footprint is an outbuilding, not a house. */
const SWEEP_MIN_FOOTPRINT_SQFT = 400;

export interface BuildingCandidate {
  osmRef: string;
  /** Where the pin goes — the building's own centroid, not the tap point. */
  centroid: GeoPoint;
  facts: PropertyFacts;
}

/**
 * Every mappable building in an area, in a single Overpass call.
 *
 * This deliberately does not geocode or look up owners per building — that would
 * be one throttled request each. Most OSM buildings carry their own `addr:*`
 * tags, which is enough to work a street; run the full per-property enrichment
 * on the ones worth pursuing.
 */
export async function fetchBuildingsInBounds(
  bounds: GeoBounds,
  limit: number,
): Promise<BuildingCandidate[]> {
  const url = process.env.OSM_OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
  // Overpass bounding boxes are (south, west, north, east).
  const bbox = `${bounds.minLat},${bounds.minLng},${bounds.maxLat},${bounds.maxLng}`;
  const query = `[out:json][timeout:60];way["building"](${bbox});out tags geom ${limit};`;

  const res = await politeFetch(url, 1100, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query }).toString(),
  });
  if (!res.ok) throw new Error(`Overpass returned ${res.status}`);

  const body = (await res.json()) as OverpassResponse;
  const candidates: BuildingCandidate[] = [];

  for (const element of body.elements ?? []) {
    const ring = elementRing(element);
    if (ring.length < 3) continue;

    const buildingTag = element.tags?.building;
    if (buildingTag && SWEEP_SKIP_BUILDING_TYPES.has(buildingTag)) continue;

    const facts = buildingFacts(element);
    if ((facts.footprintSqFt ?? 0) < SWEEP_MIN_FOOTPRINT_SQFT) continue;

    const centroid = ringPointOnSurface(ring);
    if (!centroid) continue;

    candidates.push({ osmRef: facts.osmRef as string, centroid, facts });
  }

  return candidates;
}

/**
 * Prefer a building whose footprint actually contains the pin; otherwise take
 * the one whose centroid is nearest. A tap in a back yard still finds the house.
 */
function pickBuilding(elements: OverpassElement[], point: GeoPoint): OverpassElement | null {
  const withGeometry = elements.filter((el) => (el.geometry?.length ?? 0) >= 3);
  if (withGeometry.length === 0) return null;

  const containing = withGeometry.find((el) => pointInRing(point, elementRing(el)));
  if (containing) return containing;

  let best: OverpassElement | null = null;
  let bestDistance = Infinity;
  for (const el of withGeometry) {
    const ring = el.geometry ?? [];
    const cLat = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
    const cLng = ring.reduce((s, p) => s + p.lon, 0) / ring.length;
    // Squared degree distance is enough to rank candidates this close together.
    const d = (cLat - point.lat) ** 2 + (cLng - point.lng) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = el;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// County parcel data — owner of record. Opt-in, per deployment.
// ---------------------------------------------------------------------------

/**
 * Most US county assessors publish parcels on an ArcGIS FeatureServer layer.
 * Point PARCEL_API_URL at the layer (".../FeatureServer/0") and this queries the
 * parcel containing the pin. Owner/parcel-id field names vary by county, so they
 * are configurable, with the common spellings tried as a fallback.
 */
const OWNER_FIELD_CANDIDATES = ["OWNER", "OWNER_NAME", "OWNERNAME", "OWNERNME1", "OWN1", "OWNER1", "owner_name"];
const PARCEL_ID_FIELD_CANDIDATES = ["PARCELID", "PARCEL_ID", "APN", "PIN", "parcel_id"];
const VALUE_FIELD_CANDIDATES = [
  "TOTALVALUE",
  "TOTAL_VALUE",
  "ASSESSEDVALUE",
  "ASSESSED_VALUE",
  "MARKETVALUE",
  "APPRAISEDVALUE",
  "TOTVAL",
  "JUSTVALUE",
];
const SALE_DATE_FIELD_CANDIDATES = ["SALEDATE", "SALE_DATE", "LASTSALEDATE", "DEEDDATE", "TRANSFERDATE"];
const SALE_PRICE_FIELD_CANDIDATES = ["SALEPRICE", "SALE_PRICE", "SALEAMOUNT", "SALEAMT", "LASTSALEPRICE"];

interface ArcGisResponse {
  features?: { attributes?: Record<string, unknown> }[];
  error?: { message?: string };
}

export const parcelProvider: OpenDataProvider = {
  id: "parcel",
  label: "County assessor parcel layer (owner of record)",
  get configured() {
    return Boolean(process.env.PARCEL_API_URL);
  },
  async lookup(point) {
    const base = process.env.PARCEL_API_URL;
    if (!base) return null;

    const params = new URLSearchParams({
      f: "json",
      geometry: `${point.lng},${point.lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "*",
      returnGeometry: "false",
      resultRecordCount: "1",
    });
    const url = `${base.replace(/\/$/, "")}/query?${params.toString()}`;

    const res = await politeFetch(url, 250);
    if (!res.ok) throw new Error(`Parcel layer returned ${res.status}`);
    const body = (await res.json()) as ArcGisResponse;
    if (body.error) throw new Error(body.error.message ?? "Parcel layer error");

    const attributes = body.features?.[0]?.attributes;
    if (!attributes) return null;

    const saleDate = parseArcGisDate(
      pickField(attributes, process.env.PARCEL_SALE_DATE_FIELD, SALE_DATE_FIELD_CANDIDATES),
    );

    return {
      ownerName: pickField(attributes, process.env.PARCEL_OWNER_FIELD, OWNER_FIELD_CANDIDATES),
      parcelId: pickField(attributes, process.env.PARCEL_ID_FIELD, PARCEL_ID_FIELD_CANDIDATES),
      yearBuilt: parseYearOrNull(pickField(attributes, process.env.PARCEL_YEAR_BUILT_FIELD, ["YEARBUILT", "YEAR_BUILT"])),
      assessedValue: parsePositiveNumber(
        pickField(attributes, process.env.PARCEL_VALUE_FIELD, VALUE_FIELD_CANDIDATES),
      ),
      // A sale is only a signal if we can date it.
      lastSaleDate: saleDate ? saleDate.toISOString() : null,
      lastSalePrice: parsePositiveNumber(
        pickField(attributes, process.env.PARCEL_SALE_PRICE_FIELD, SALE_PRICE_FIELD_CANDIDATES),
      ),
    };
  },
};

/** Reads a configured field name if given, else the first candidate the record actually has. */
function pickField(
  attributes: Record<string, unknown>,
  configured: string | undefined,
  candidates: string[],
): string | null {
  const names = configured ? [configured] : candidates;
  const lowered = new Map(Object.keys(attributes).map((k) => [k.toLowerCase(), k]));
  for (const name of names) {
    const key = lowered.get(name.toLowerCase());
    if (key === undefined) continue;
    const value = attributes[key];
    if (value === null || value === undefined || value === "") continue;
    return String(value).trim();
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Honours Retry-After (delta-seconds form) when the server sends one, capped so a lookup can't hang. */
function retryDelayMs(res: Response, fallbackMs: number): number {
  const header = res.headers.get("Retry-After");
  const seconds = header ? Number.parseInt(header, 10) : Number.NaN;
  const ms = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : fallbackMs;
  return Math.min(ms, 5000);
}

/** Assessor tables use 0 for "unknown", so zero and negatives are not values. */
function parsePositiveNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseIntOrNull(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** OSM `start_date` can be "1974", "1974-06", or "C19"; take a leading 4-digit year. */
function parseYearOrNull(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /\b(1[6-9]\d{2}|20\d{2})\b/.exec(value);
  return match ? Number.parseInt(match[1], 10) : null;
}

// ---------------------------------------------------------------------------
// Storm exposure — why storm-chasing works, as a number
// ---------------------------------------------------------------------------

/** Years of weather history to look back over. */
const STORM_WINDOW_YEARS = Number(process.env.STORM_WINDOW_YEARS ?? 5);
/** Gust speed that starts doing roof damage. NWS calls 58 mph severe; roofers see
 *  granule loss and lifted shingles well below that, so the default is lower. */
const SEVERE_GUST_MPH = Number(process.env.SEVERE_GUST_MPH ?? 50);
const KMH_PER_MPH = 1.609344;
/** The archive lags real time by a few days. */
const ARCHIVE_LAG_DAYS = 6;

/**
 * Open-Meteo resolves to a ~0.1° grid, so every house on a street returns the
 * same weather. Caching by grid cell turns a 300-building sweep into one request
 * instead of three hundred — verified: three points across Round Rock all snap to
 * the same cell, while Georgetown 8 miles north snaps to a different one.
 */
const STORM_GRID_DEGREES = 0.1;
const STORM_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const stormCache = new Map<string, { at: number; facts: PropertyFacts | null }>();

interface OpenMeteoArchive {
  daily?: { time?: string[]; wind_gusts_10m_max?: (number | null)[] };
  error?: boolean;
  reason?: string;
}

export const stormProvider: OpenDataProvider = {
  id: "storm",
  label: "Open-Meteo historical archive (storm exposure)",
  configured: true,
  async lookup(point) {
    const cell = `${snap(point.lat)},${snap(point.lng)}`;
    const hit = stormCache.get(cell);
    if (hit && Date.now() - hit.at < STORM_CACHE_TTL_MS) return hit.facts;

    const end = new Date(Date.now() - ARCHIVE_LAG_DAYS * 86400000);
    const start = new Date(end);
    start.setFullYear(start.getFullYear() - STORM_WINDOW_YEARS);

    const base = process.env.OPEN_METEO_ARCHIVE_URL ?? "https://archive-api.open-meteo.com/v1/archive";
    const params = new URLSearchParams({
      latitude: String(snap(point.lat)),
      longitude: String(snap(point.lng)),
      start_date: isoDate(start),
      end_date: isoDate(end),
      daily: "wind_gusts_10m_max",
      timezone: "UTC",
    });

    const res = await politeFetch(`${base}?${params.toString()}`, 250);
    if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
    const body = (await res.json()) as OpenMeteoArchive;
    if (body.error) throw new Error(body.reason ?? "Open-Meteo error");

    const gustsKmh = (body.daily?.wind_gusts_10m_max ?? []).filter(
      (v): v is number => typeof v === "number",
    );
    if (gustsKmh.length === 0) {
      stormCache.set(cell, { at: Date.now(), facts: null });
      return null;
    }

    const gustsMph = gustsKmh.map((v) => v / KMH_PER_MPH);
    const facts: PropertyFacts = {
      stormWindowYears: STORM_WINDOW_YEARS,
      severeStormDays: gustsMph.filter((v) => v >= SEVERE_GUST_MPH).length,
      peakGustMph: Math.round(Math.max(...gustsMph) * 10) / 10,
    };
    stormCache.set(cell, { at: Date.now(), facts });
    return facts;
  },
};

function snap(degrees: number): number {
  return Math.round(degrees / STORM_GRID_DEGREES) * STORM_GRID_DEGREES;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Exposed so a sweep can prime the cache once for the whole area. */
export function clearStormCache(): void {
  stormCache.clear();
}

// ---------------------------------------------------------------------------
// Building permits — the strongest negative signal there is
// ---------------------------------------------------------------------------

const PERMIT_TYPE_FIELD_CANDIDATES = ["PERMITTYPE", "PERMIT_TYPE", "WORKTYPE", "WORK_TYPE", "DESCRIPTION", "PERMITCLASS"];
const PERMIT_DATE_FIELD_CANDIDATES = ["ISSUEDDATE", "ISSUE_DATE", "ISSUEDATE", "PERMITDATE", "APPLIEDDATE"];
/** Substrings that mark a permit as roof work. */
const ROOF_KEYWORDS = (process.env.PERMITS_ROOF_KEYWORDS ?? "roof,reroof,re-roof,shingle")
  .split(",")
  .map((k) => k.trim().toLowerCase())
  .filter(Boolean);
/** How far from the pin a permit still counts as this property's. */
const PERMIT_SEARCH_RADIUS_FT = 80;

/**
 * Many cities publish building permits on the same ArcGIS/Socrata infrastructure
 * as parcels. A roofing permit means that roof is already done — knowing that is
 * worth more than any positive signal, because it stops a wasted visit.
 */
export const permitsProvider: OpenDataProvider = {
  id: "permits",
  label: "Municipal building permits (recent roof work)",
  get configured() {
    return Boolean(process.env.PERMITS_API_URL);
  },
  async lookup(point) {
    const base = process.env.PERMITS_API_URL;
    if (!base) return null;

    const params = new URLSearchParams({
      f: "json",
      geometry: `${point.lng},${point.lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      distance: String(PERMIT_SEARCH_RADIUS_FT),
      units: "esriSRUnit_Foot",
      outFields: "*",
      returnGeometry: "false",
      resultRecordCount: "50",
    });

    const res = await politeFetch(`${base.replace(/\/$/, "")}/query?${params.toString()}`, 250);
    if (!res.ok) throw new Error(`Permits layer returned ${res.status}`);
    const body = (await res.json()) as ArcGisResponse;
    if (body.error) throw new Error(body.error.message ?? "Permits layer error");

    const records = (body.features ?? [])
      .map((f) => f.attributes)
      .filter((a): a is Record<string, unknown> => Boolean(a));
    if (records.length === 0) return null;

    let latest: { date: Date; type: string } | null = null;
    let latestRoof: { date: Date; type: string } | null = null;

    for (const record of records) {
      const type = pickField(record, process.env.PERMITS_TYPE_FIELD, PERMIT_TYPE_FIELD_CANDIDATES) ?? "";
      const rawDate = pickField(record, process.env.PERMITS_DATE_FIELD, PERMIT_DATE_FIELD_CANDIDATES);
      const date = parseArcGisDate(rawDate);
      if (!date) continue;

      if (!latest || date > latest.date) latest = { date, type };
      const haystack = type.toLowerCase();
      if (ROOF_KEYWORDS.some((k) => haystack.includes(k))) {
        if (!latestRoof || date > latestRoof.date) latestRoof = { date, type };
      }
    }

    if (!latest) return null;
    return {
      lastPermitDate: latest.date.toISOString(),
      lastPermitType: latest.type || null,
      roofPermitDate: latestRoof ? latestRoof.date.toISOString() : null,
    };
  },
};

/**
 * ArcGIS date fields come back as epoch milliseconds far more often than as
 * strings, and a bare number would otherwise parse as a year.
 */
function parseArcGisDate(value: string | null): Date | null {
  if (!value) return null;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && Math.abs(asNumber) > 1e11) {
    const date = new Date(asNumber);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Order matters: the merge is fill-empty-first, so the most authoritative source
 * for a field must come first. Parcel and permits are official records, the OSM
 * building beats the geocoder for address, and storm data overlaps with nothing.
 */
export const ALL_PROVIDERS: OpenDataProvider[] = [
  parcelProvider,
  permitsProvider,
  overpassProvider,
  nominatimProvider,
  stormProvider,
];
