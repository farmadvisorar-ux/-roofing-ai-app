// Roof measurement + estimate math for canvassed properties.
// Framework-free so the same numbers render on the map client and get persisted server-side.
import { RoofStyle } from "@/lib/shed";

/** Facts we can learn about a building from open data, all optional. */
export interface RoofFacts {
  /** Building footprint in square feet (from an OSM building polygon, or an assessor record). */
  footprintSqFt?: number | null;
  /** OpenStreetMap `roof:shape` value, e.g. "gabled", "hipped", "flat". */
  roofShape?: string | null;
  /** OpenStreetMap `roof:material`, e.g. "asphalt_shingle", "metal". */
  roofMaterial?: string | null;
  /** Storeys (`building:levels`) — drives the access surcharge. */
  buildingLevels?: number | null;
  /** Rise per 12" of run. Defaults from the roof shape when unknown. */
  pitchPer12?: number | null;
}

export interface RoofEstimate {
  /** Actual sloped roof surface, not the footprint. */
  roofSqFt: number;
  /** Roofing "squares" — 100 sq ft each, the unit the trade quotes in. */
  roofSquares: number;
  estimateLow: number;
  estimateHigh: number;
  pitchPer12: number;
  /** Which inputs were real vs. defaulted, so the UI can be honest about confidence. */
  assumed: string[];
}

/**
 * Typical pitch per OSM roof:shape. OSM records shape far more often than
 * roof:angle, so shape is the practical way to guess slope.
 */
const SHAPE_DEFAULT_PITCH: Record<string, number> = {
  flat: 0.25,
  skillion: 3,
  "half-hipped": 6,
  gabled: 6,
  hipped: 6,
  pyramidal: 7,
  gambrel: 9,
  mansard: 9,
  round: 6,
  dome: 6,
};

/** Cut/waste/flashing complexity by shape — hips and curves waste far more material than a simple gable. */
const SHAPE_COMPLEXITY: Record<string, number> = {
  flat: 1.05,
  skillion: 1.06,
  gabled: 1.1,
  "half-hipped": 1.14,
  hipped: 1.16,
  pyramidal: 1.18,
  gambrel: 1.2,
  mansard: 1.24,
  round: 1.28,
  dome: 1.3,
};

const DEFAULT_PITCH = 6;
const DEFAULT_COMPLEXITY = 1.12;

/** Installed price per square (100 sq ft), low/high, for a tear-off and re-roof. */
const PRICE_PER_SQUARE_LOW = 375;
const PRICE_PER_SQUARE_HIGH = 650;

/** Premium materials cost more per square than the asphalt baseline. */
const MATERIAL_MULTIPLIER: Record<string, number> = {
  asphalt_shingle: 1,
  roof_tiles: 1.6,
  tile: 1.6,
  clay: 1.7,
  concrete: 1.5,
  metal: 1.45,
  copper: 3.2,
  slate: 2.8,
  wood: 1.7,
  shingle: 1,
  tar_paper: 0.85,
  gravel: 0.9,
};

/** Anything over 7/12 needs staging and fall protection. */
const STEEP_PITCH_THRESHOLD = 7;
const STEEP_PITCH_SURCHARGE = 0.12;
/** Per storey above the first — longer ladder runs, more staging. */
const PER_STOREY_SURCHARGE = 0.08;

/** Used when a property has a building we can see but no footprint we can measure. */
export const FALLBACK_FOOTPRINT_SQFT = 1600;

/**
 * Slope factor: a 6/12 roof covering a 1,000 sq ft footprint has
 * 1,000 * sqrt(1 + (6/12)^2) = 1,118 sq ft of surface.
 */
export function slopeFactor(pitchPer12: number): number {
  const ratio = pitchPer12 / 12;
  return Math.sqrt(1 + ratio * ratio);
}

export function estimateRoof(facts: RoofFacts): RoofEstimate {
  const assumed: string[] = [];

  let footprint: number = facts.footprintSqFt ?? 0;
  if (footprint <= 0) {
    footprint = FALLBACK_FOOTPRINT_SQFT;
    assumed.push("footprint");
  }

  const shape = normalizeShape(facts.roofShape);
  if (!shape) assumed.push("roofShape");

  let pitch: number = facts.pitchPer12 ?? 0;
  if (pitch <= 0) {
    pitch = (shape ? SHAPE_DEFAULT_PITCH[shape] : undefined) ?? DEFAULT_PITCH;
    assumed.push("pitch");
  }

  const levels = facts.buildingLevels && facts.buildingLevels > 0 ? facts.buildingLevels : null;
  if (!levels) assumed.push("buildingLevels");

  const material = normalizeMaterial(facts.roofMaterial);
  if (!material) assumed.push("roofMaterial");

  const complexity = (shape ? SHAPE_COMPLEXITY[shape] : undefined) ?? DEFAULT_COMPLEXITY;
  // Only the top storey carries roof; extra levels mean access cost, not more area.
  const roofSqFt = footprint * slopeFactor(pitch) * complexity;
  const roofSquares = roofSqFt / 100;

  const materialMultiplier = (material ? MATERIAL_MULTIPLIER[material] : undefined) ?? 1;
  let surcharge = 1;
  if (pitch > STEEP_PITCH_THRESHOLD) surcharge += STEEP_PITCH_SURCHARGE;
  if (levels && levels > 1) surcharge += (levels - 1) * PER_STOREY_SURCHARGE;

  const perSquareLow = PRICE_PER_SQUARE_LOW * materialMultiplier * surcharge;
  const perSquareHigh = PRICE_PER_SQUARE_HIGH * materialMultiplier * surcharge;

  return {
    roofSqFt: round1(roofSqFt),
    roofSquares: round1(roofSquares),
    estimateLow: roundTo(roofSquares * perSquareLow, 50),
    estimateHigh: roundTo(roofSquares * perSquareHigh, 50),
    pitchPer12: pitch,
    assumed,
  };
}

/** Midpoint of the estimate range — what we put on the lead as its estimated value. */
export function estimateMidpoint(estimate: Pick<RoofEstimate, "estimateLow" | "estimateHigh">): number {
  return roundTo((estimate.estimateLow + estimate.estimateHigh) / 2, 50);
}

/**
 * Maps an OSM roof shape onto the three styles the 3D engine can build, so a
 * canvassed roof can be previewed with the same renderer the configurator uses.
 */
export function osmShapeToRoofStyle(roofShape?: string | null): RoofStyle {
  switch (normalizeShape(roofShape)) {
    case "skillion":
    case "flat":
      return "LEAN_TO";
    case "gambrel":
    case "mansard":
      return "GAMBREL";
    default:
      return "GABLE";
  }
}

/** OSM values arrive with mixed case and both hyphens and underscores. */
function normalizeShape(shape?: string | null): string | null {
  if (!shape) return null;
  const key = shape.trim().toLowerCase().replace(/_/g, "-");
  if (key in SHAPE_DEFAULT_PITCH) return key;
  // "gable" and "hip" are common shorthands for the OSM values.
  if (key === "gable") return "gabled";
  if (key === "hip") return "hipped";
  if (key === "shed") return "skillion";
  return null;
}

function normalizeMaterial(material?: string | null): string | null {
  if (!material) return null;
  const key = material.trim().toLowerCase().replace(/[\s-]/g, "_");
  return key in MATERIAL_MULTIPLIER ? key : null;
}

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

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function roundTo(n: number, step: number): number {
  return Math.round(n / step) * step;
}
