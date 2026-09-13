// Open-data clients used to enrich a canvassed property.
//
// Everything here is free/open software or open data:
//   - Nominatim  (OpenStreetMap geocoder, AGPL)  -> street address for a pin
//   - Overpass   (OpenStreetMap query API, AGPL) -> building footprint + roof tags
//   - ArcGIS/Socrata county parcel endpoints     -> owner of record (per-county, opt-in)
//
// No provider is required: each one reports whether it is configured, and the
// pipeline merges whatever comes back. See docs/open-source-lead-stack.md.
import { ringAreaSqFt } from "@/lib/roofing";

export interface GeoPoint {
  lat: number;
  lng: number;
}

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

    const tags = building.tags ?? {};
    const ring = (building.geometry ?? []).map((p) => ({ lat: p.lat, lng: p.lon }));
    const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ").trim();

    return {
      osmRef: `${building.type}/${building.id}`,
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
  },
};

/**
 * Prefer a building whose footprint actually contains the pin; otherwise take
 * the one whose centroid is nearest. A tap in a back yard still finds the house.
 */
function pickBuilding(elements: OverpassElement[], point: GeoPoint): OverpassElement | null {
  const withGeometry = elements.filter((el) => (el.geometry?.length ?? 0) >= 3);
  if (withGeometry.length === 0) return null;

  const containing = withGeometry.find((el) =>
    pointInRing(point, (el.geometry ?? []).map((p) => ({ lat: p.lat, lng: p.lon }))),
  );
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

/** Standard even-odd ray cast. */
export function pointInRing(point: GeoPoint, ring: GeoPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const straddles = a.lat > point.lat !== b.lat > point.lat;
    if (!straddles) continue;
    const x = ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (point.lng < x) inside = !inside;
  }
  return inside;
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

    return {
      ownerName: pickField(attributes, process.env.PARCEL_OWNER_FIELD, OWNER_FIELD_CANDIDATES),
      parcelId: pickField(attributes, process.env.PARCEL_ID_FIELD, PARCEL_ID_FIELD_CANDIDATES),
      yearBuilt: parseYearOrNull(pickField(attributes, process.env.PARCEL_YEAR_BUILT_FIELD, ["YEARBUILT", "YEAR_BUILT"])),
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

export const ALL_PROVIDERS: OpenDataProvider[] = [parcelProvider, overpassProvider, nominatimProvider];
