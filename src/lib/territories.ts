// The service footprint: which regions we sell into, and which one an address
// belongs to.
//
// Territories drive four things: which storm data is worth importing, how the
// prospect list is divided between crews, where the map jumps to, and the
// coverage rollups on the workbench.
//
// The bounds below are approximate service areas, not survey boundaries. Change
// them here and the whole app follows — nothing else hard-codes a region.
import { GeoBounds, GeoPoint } from "@/lib/geo";

export interface Territory {
  id: string;
  name: string;
  /** Two-letter states this region can contain. Used to resolve border cases. */
  states: string[];
  bounds: GeoBounds;
  /** Where the map lands when you jump to this territory. */
  center: GeoPoint;
  zoom: number;
  /** Recognisable places inside it, for the picker and for tests. */
  hubs: string[];
}

/**
 * Order is significant: the first territory whose bounds contain a point wins.
 * East Texas precedes North Texas so Tyler and Longview resolve east rather than
 * north, and West Louisiana precedes both so Shreveport does not land in Texas.
 */
export const TERRITORIES: Territory[] = [
  {
    id: "west-louisiana",
    name: "West Louisiana",
    states: ["LA"],
    bounds: { minLat: 28.9, minLng: -94.05, maxLat: 33.05, maxLng: -91.8 },
    center: { lat: 31.2, lng: -92.9 },
    zoom: 8,
    hubs: ["Shreveport", "Bossier City", "Alexandria", "Lake Charles", "Natchitoches", "Leesville"],
  },
  {
    id: "east-texas",
    name: "East Texas",
    states: ["TX"],
    // Piney Woods down through the upper Gulf Coast.
    bounds: { minLat: 29.4, minLng: -96.2, maxLat: 33.9, maxLng: -93.45 },
    center: { lat: 31.6, lng: -94.8 },
    zoom: 8,
    hubs: ["Tyler", "Longview", "Texarkana", "Nacogdoches", "Lufkin", "Beaumont", "Houston"],
  },
  {
    id: "north-texas",
    name: "North Texas",
    states: ["TX"],
    bounds: { minLat: 32.0, minLng: -99.6, maxLat: 34.6, maxLng: -94.6 },
    center: { lat: 32.9, lng: -97.1 },
    zoom: 9,
    hubs: ["Dallas", "Fort Worth", "Denton", "Sherman", "Wichita Falls", "Paris"],
  },
  {
    id: "central-texas",
    name: "Central Texas",
    states: ["TX"],
    bounds: { minLat: 29.7, minLng: -99.6, maxLat: 32.0, maxLng: -96.2 },
    center: { lat: 30.6, lng: -97.6 },
    zoom: 9,
    hubs: ["Austin", "Round Rock", "Georgetown", "Waco", "Killeen", "Temple", "San Marcos"],
  },
  {
    id: "south-texas",
    name: "South Texas",
    states: ["TX"],
    bounds: { minLat: 25.8, minLng: -100.0, maxLat: 29.7, maxLng: -96.2 },
    center: { lat: 28.4, lng: -98.2 },
    zoom: 8,
    hubs: ["San Antonio", "Corpus Christi", "Laredo", "McAllen", "Brownsville", "Victoria"],
  },
  {
    id: "west-texas",
    name: "West Texas",
    states: ["TX"],
    // Panhandle down through the Permian Basin and Far West Texas.
    bounds: { minLat: 25.8, minLng: -106.7, maxLat: 36.55, maxLng: -99.6 },
    center: { lat: 32.0, lng: -102.1 },
    zoom: 7,
    hubs: ["Lubbock", "Amarillo", "Midland", "Odessa", "Abilene", "San Angelo", "El Paso"],
  },
];

export const TERRITORY_IDS = TERRITORIES.map((t) => t.id);

const BY_ID = new Map(TERRITORIES.map((t) => [t.id, t]));

export function getTerritory(id: string | null | undefined): Territory | null {
  return id ? (BY_ID.get(id) ?? null) : null;
}

export function isTerritoryId(id: string): boolean {
  return BY_ID.has(id);
}

/** States, in the order we would import storm data for them. */
export const FOOTPRINT_STATES = [...new Set(TERRITORIES.flatMap((t) => t.states))];

/** Bounds enclosing the entire footprint — the default view for a fresh map. */
export const FOOTPRINT_BOUNDS: GeoBounds = TERRITORIES.reduce<GeoBounds>(
  (acc, t) => ({
    minLat: Math.min(acc.minLat, t.bounds.minLat),
    minLng: Math.min(acc.minLng, t.bounds.minLng),
    maxLat: Math.max(acc.maxLat, t.bounds.maxLat),
    maxLng: Math.max(acc.maxLng, t.bounds.maxLng),
  }),
  { minLat: 90, minLng: 180, maxLat: -90, maxLng: -180 },
);

function contains(bounds: GeoBounds, point: GeoPoint): boolean {
  return (
    point.lat >= bounds.minLat &&
    point.lat <= bounds.maxLat &&
    point.lng >= bounds.minLng &&
    point.lng <= bounds.maxLng
  );
}

/**
 * Which territory a point belongs to, or null if it is outside the footprint.
 *
 * Pass `state` whenever it is known. A bounding box cannot follow the Sabine
 * River, so Shreveport LA and Orange TX are inseparable on coordinates alone —
 * the state narrows the candidates first and settles those border cases exactly.
 */
export function territoryForPoint(point: GeoPoint, state?: string | null): Territory | null {
  const code = normalizeState(state);
  const candidates = code ? TERRITORIES.filter((t) => t.states.includes(code)) : TERRITORIES;
  return candidates.find((t) => contains(t.bounds, point)) ?? null;
}

export function territoryIdForPoint(point: GeoPoint, state?: string | null): string | null {
  return territoryForPoint(point, state)?.id ?? null;
}

const STATE_NAMES: Record<string, string> = {
  texas: "TX",
  louisiana: "LA",
};

/** Accepts "TX", "tx", "Texas" — Nominatim returns the full name, assessors the code. */
export function normalizeState(state?: string | null): string | null {
  if (!state) return null;
  const trimmed = state.trim();
  if (trimmed.length === 2) return trimmed.toUpperCase();
  return STATE_NAMES[trimmed.toLowerCase()] ?? null;
}
