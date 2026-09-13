// Small-area geographic helpers shared by the property routes.
//
// Everything here uses a local equirectangular approximation: over a city block
// the error is far smaller than the error in any roof estimate, and it avoids
// dragging in a projection library for what is a handful of formulas.

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface GeoBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** Feet per degree of latitude — near enough constant everywhere. */
export const FT_PER_DEG_LAT = 364000;

/** Two pins closer than this are the same roof. */
export const DEDUPE_RADIUS_FT = 30;

/** Feet per degree of longitude, which shrinks towards the poles. */
export function ftPerDegLng(lat: number): number {
  return FT_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

export function distanceFt(a: GeoPoint, b: GeoPoint): number {
  const latRef = (a.lat + b.lat) / 2;
  return Math.hypot((a.lat - b.lat) * FT_PER_DEG_LAT, (a.lng - b.lng) * ftPerDegLng(latRef));
}

/** Degree deltas spanning a radius in feet, guarded where a foot spans unbounded longitude. */
export function degreeDeltas(lat: number, radiusFt: number): { latDelta: number; lngDelta: number } {
  const perDegLng = ftPerDegLng(lat);
  return {
    latDelta: radiusFt / FT_PER_DEG_LAT,
    lngDelta: perDegLng > 1 ? radiusFt / perDegLng : 180,
  };
}

/** Rough ground area of a bounding box, in square miles. */
export function boundsAreaSqMi(bounds: GeoBounds): number {
  const latRef = (bounds.minLat + bounds.maxLat) / 2;
  const heightFt = (bounds.maxLat - bounds.minLat) * FT_PER_DEG_LAT;
  const widthFt = (bounds.maxLng - bounds.minLng) * ftPerDegLng(latRef);
  return Math.abs(heightFt * widthFt) / (5280 * 5280);
}

export function isValidBounds(bounds: GeoBounds): boolean {
  const values = [bounds.minLat, bounds.minLng, bounds.maxLat, bounds.maxLng];
  if (!values.every((v) => typeof v === "number" && Number.isFinite(v))) return false;
  if (bounds.minLat > bounds.maxLat || bounds.minLng > bounds.maxLng) return false;
  return (
    bounds.minLat >= -90 && bounds.maxLat <= 90 && bounds.minLng >= -180 && bounds.maxLng <= 180
  );
}

// --- Ring geometry -------------------------------------------------------
//
// Building footprints arrive from OpenStreetMap as a closed ring of lat/lng
// points. These four functions are everything we need to do with one.

/**
 * Planar area of a lat/lng ring in square feet, via the shoelace formula on a
 * local equirectangular projection. Building footprints are small enough that
 * the projection error is well under the error in the estimate itself.
 */
export function ringAreaSqFt(ring: { lat: number; lng: number }[]): number {
  if (ring.length < 3) return 0;

  const latRef = ring.reduce((sum, p) => sum + p.lat, 0) / ring.length;
  const FT_PER_DEG_LAT = 364000;
  const ftPerDegLng = FT_PER_DEG_LAT * Math.cos((latRef * Math.PI) / 180);

  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.lng * ftPerDegLng * (b.lat * FT_PER_DEG_LAT) - b.lng * ftPerDegLng * (a.lat * FT_PER_DEG_LAT);
  }
  return Math.abs(sum) / 2;
}

/**
 * Area-weighted centroid of a lat/lng ring. A plain vertex average drifts towards
 * whichever side has more nodes, which on an L-shaped building can put the pin off
 * the roof entirely. Falls back to the vertex average for a degenerate ring.
 */
export function ringCentroid(ring: { lat: number; lng: number }[]): { lat: number; lng: number } | null {
  if (ring.length === 0) return null;
  if (ring.length < 3) return vertexAverage(ring);

  let twiceArea = 0;
  let lat = 0;
  let lng = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const cross = a.lng * b.lat - b.lng * a.lat;
    twiceArea += cross;
    lat += (a.lat + b.lat) * cross;
    lng += (a.lng + b.lng) * cross;
  }

  if (twiceArea === 0) return vertexAverage(ring);
  const factor = 1 / (3 * twiceArea);
  return { lat: lat * factor, lng: lng * factor };
}

function vertexAverage(ring: { lat: number; lng: number }[]): { lat: number; lng: number } {
  return {
    lat: ring.reduce((sum, p) => sum + p.lat, 0) / ring.length,
    lng: ring.reduce((sum, p) => sum + p.lng, 0) / ring.length,
  };
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

/**
 * A point guaranteed to lie on the footprint — where the map pin goes.
 *
 * The centroid is used when it falls inside, which it does for the rectangles
 * most houses are. For an L-shaped or U-shaped building the centroid sits in the
 * notch, off the roof, so this falls back to the middle of the widest span of
 * building along the centroid's latitude (the same idea as PostGIS
 * ST_PointOnSurface).
 */
export function ringPointOnSurface(ring: GeoPoint[]): GeoPoint | null {
  const centroid = ringCentroid(ring);
  if (!centroid || ring.length < 3) return centroid;
  if (pointInRing(centroid, ring)) return centroid;

  // Longitudes where the ring crosses the centroid's latitude, in order.
  const crossings: number[] = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.lat > centroid.lat === b.lat > centroid.lat) continue;
    crossings.push(((b.lng - a.lng) * (centroid.lat - a.lat)) / (b.lat - a.lat) + a.lng);
  }
  crossings.sort((x, y) => x - y);

  // Pairs of crossings bound the inside; take the middle of the widest pair.
  let best: GeoPoint | null = null;
  let widest = 0;
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const span = crossings[i + 1] - crossings[i];
    if (span > widest) {
      widest = span;
      best = { lat: centroid.lat, lng: (crossings[i] + crossings[i + 1]) / 2 };
    }
  }
  return best ?? centroid;
}
