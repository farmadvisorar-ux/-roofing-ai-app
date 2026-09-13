// Lead scoring for canvassed roofs.
//
// The score answers one question: of the roofs on this street, which should the
// rep knock on first? It is deliberately explainable — every point is attributable
// to a named signal, because "why is this an 84?" has to have an answer a sales
// manager can argue with.
//
// Two rules shape the model:
//
//   1. Missing data is not bad data. A property with no year built is not a cold
//      lead, it is an unknown one. Unavailable signals are dropped from the
//      denominator and reported as reduced confidence instead of dragging the
//      score down.
//   2. One signal can veto. A roofing permit pulled two years ago means that roof
//      is done, whatever the other signals say, so permits apply as a multiplier
//      rather than as points.
//   3. Thin evidence cannot produce a strong claim. Normalising over only the
//      signals we have would let a single lucky one — "it's a big roof" — rank an
//      otherwise unknown property above a fully-qualified lead, sending reps to
//      the wrong doors. The normalised score is therefore shrunk toward a neutral
//      prior in proportion to how much of the model had data. Both the raw and
//      the damped figure are reported, so the UI can show its working.
import { ScoreBand } from "@/generated/prisma/enums";

export interface SignalInputs {
  yearBuilt?: number | null;
  hailEventsNearby?: number | null;
  maxHailInches?: number | null;
  lastHailDate?: Date | string | null;
  hailWindowYears?: number | null;
  hailSearchRadiusMi?: number | null;
  roofMaterial?: string | null;
  roofSquares?: number | null;
  assessedValue?: number | null;
  lastSaleDate?: Date | string | null;
  roofPermitDate?: Date | string | null;
  severeStormDays?: number | null;
  peakGustMph?: number | null;
  stormWindowYears?: number | null;
  /** Won leads within a short drive — social proof and route density. */
  nearbyWonLeads?: number | null;
}

export interface ScoreComponent {
  id: string;
  label: string;
  /** Share of the total model this signal can contribute. */
  weight: number;
  /** 0-1 strength, or null when we have no data for it. */
  strength: number | null;
  /** Points actually earned, out of `weight`. */
  points: number;
  /** One line a rep can read on the doorstep. */
  detail: string;
}

export interface LeadScore {
  /** 0-100, damped for confidence and after any suppression. Rank on this. */
  score: number;
  /** 0-100 over the signals we actually have, before damping or suppression. */
  baseScore: number;
  band: ScoreBand;
  /** Share of the model's weight that had data behind it, 0-1. */
  confidence: number;
  components: ScoreComponent[];
  /** Below 1 when a recent roofing permit suppresses the lead. */
  suppression: number;
  suppressionReason: string | null;
}

/** Weights sum to 100 so a component's weight reads as "up to N points". */
const WEIGHTS = {
  roofAge: 28,
  hail: 25,
  recentSale: 14,
  jobSize: 13,
  wind: 8,
  value: 8,
  neighborhood: 4,
} as const;

/** Service life in years by roof material — when a roof becomes a replacement. */
const MATERIAL_LIFE_YEARS: Record<string, number> = {
  asphalt_shingle: 22,
  shingle: 22,
  tar_paper: 18,
  gravel: 18,
  wood: 25,
  metal: 45,
  copper: 70,
  slate: 75,
  tile: 50,
  roof_tiles: 50,
  clay: 55,
  concrete: 50,
};
const DEFAULT_MATERIAL_LIFE = 22;

/** A roof re-done within this many years is not a prospect. */
const PERMIT_SUPPRESSION_YEARS = 12;
/** Wind lookback default, matched by the Open-Meteo provider. */
const DEFAULT_STORM_WINDOW_YEARS = 5;
/** Severe-gust days in the window that count as maximum wind exposure. */
const STORM_DAYS_FOR_FULL_SCORE = 6;
/** Below this, hail bounces off asphalt shingles without doing claimable damage. */
const HAIL_DAMAGE_THRESHOLD_INCHES = 0.75;
/** Hail this size takes the roof off, whatever its age. */
const HAIL_SEVERE_INCHES = 2;
/**
 * Carriers generally allow a claim within one to two years of the date of loss,
 * so hail stays fully actionable for that long and only then starts to fade —
 * the roof is still damaged, it just becomes an age-and-condition sale rather
 * than an insurance one.
 */
const HAIL_FULL_STRENGTH_YEARS = 2;
/** A sale within this many months means a new owner deciding about the house. */
const RECENT_SALE_MONTHS = 24;
/** Roof size, in squares, at which job-size value tops out. */
const JOB_SIZE_SATURATION_SQUARES = 40;
/** Assessed value at which ability-to-pay tops out. */
const VALUE_SATURATION = 750_000;
/** Won neighbours that count as a fully warmed street. */
const NEIGHBOURS_FOR_FULL_SCORE = 4;

/**
 * Where an entirely unknown property sits: cool, not cold. It has not earned a
 * knock, but it has not been ruled out either, so it sorts below anything
 * qualified and above anything known to be a poor prospect.
 */
const UNKNOWN_PRIOR = 25;

/**
 * Below this share of the model, a property is reported UNRATED rather than given
 * a temperature. "Cold" is a verdict; a property nobody has looked up has not
 * earned one, and labelling it cold would quietly bury it.
 */
const MIN_CONFIDENCE_TO_RATE = 0.25;

const BAND_THRESHOLDS: [number, ScoreBand][] = [
  [70, ScoreBand.HOT],
  [50, ScoreBand.WARM],
  [30, ScoreBand.COOL],
];

export function scoreProperty(inputs: SignalInputs, now: Date = new Date()): LeadScore {
  const components: ScoreComponent[] = [
    roofAgeComponent(inputs, now),
    hailComponent(inputs, now),
    recentSaleComponent(inputs, now),
    jobSizeComponent(inputs),
    windComponent(inputs),
    valueComponent(inputs),
    neighbourhoodComponent(inputs),
  ];

  // Normalise over the signals that actually had data.
  const availableWeight = components
    .filter((c) => c.strength !== null)
    .reduce((sum, c) => sum + c.weight, 0);
  const earned = components.reduce((sum, c) => sum + c.points, 0);
  const totalWeight = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

  const base = availableWeight > 0 ? (earned / availableWeight) * 100 : 0;
  const confidence = availableWeight / totalWeight;

  // Shrink toward the prior in proportion to what we don't know, then let a
  // permit veto. Suppression comes last so a re-roofed house stays cold however
  // little else we know about it.
  const damped = base * confidence + UNKNOWN_PRIOR * (1 - confidence);
  const { suppression, suppressionReason } = permitSuppression(inputs, now);
  const score = Math.round(damped * suppression);

  return {
    score,
    baseScore: Math.round(base),
    band: confidence < MIN_CONFIDENCE_TO_RATE ? ScoreBand.UNRATED : bandFor(score),
    confidence: Math.round(confidence * 100) / 100,
    components,
    suppression,
    suppressionReason,
  };
}

export function bandFor(score: number): ScoreBand {
  for (const [threshold, band] of BAND_THRESHOLDS) {
    if (score >= threshold) return band;
  }
  return ScoreBand.COLD;
}

export const BAND_LABELS: Record<ScoreBand, string> = {
  HOT: "Hot",
  WARM: "Warm",
  COOL: "Cool",
  COLD: "Cold",
  UNRATED: "Unrated",
};

// --- Components -----------------------------------------------------------

/**
 * The strongest signal in roofing: how far through its service life the roof is.
 * Ramps from nothing at half-life to full at the end of life, and stays there —
 * a roof 30 years overdue is not more replaceable than one 10 years overdue.
 */
function roofAgeComponent(inputs: SignalInputs, now: Date): ScoreComponent {
  const weight = WEIGHTS.roofAge;
  const year = inputs.yearBuilt;
  if (!year || year < 1600 || year > now.getFullYear()) {
    return unavailable("roofAge", "Roof age", weight, "No year built on record");
  }

  const life = materialLife(inputs.roofMaterial);
  const age = now.getFullYear() - year;
  const ratio = age / life;
  // 0 at half life, 1 at end of life.
  const strength = clamp01((ratio - 0.5) / 0.5);
  const overdue = age - life;

  const detail =
    overdue >= 0
      ? `${age}y old, ~${overdue}y past a ${life}y ${materialLabel(inputs.roofMaterial)} roof`
      : `${age}y old, ~${-overdue}y left on a ${life}y ${materialLabel(inputs.roofMaterial)} roof`;

  return { id: "roofAge", label: "Roof age", weight, strength, points: weight * strength, detail };
}

/**
 * Observed hail — the strongest storm signal in roofing, and the reason storm
 * chasing works at all. Size decides whether a roof is damaged; recency decides
 * whether the owner can still claim for it, so the two multiply.
 */
function hailComponent(inputs: SignalInputs, now: Date): ScoreComponent {
  const weight = WEIGHTS.hail;
  const count = inputs.hailEventsNearby;
  if (count === null || count === undefined) {
    return unavailable("hail", "Hail exposure", weight, "No storm reports imported");
  }

  const radius = inputs.hailSearchRadiusMi ?? 10;
  const years = inputs.hailWindowYears ?? DEFAULT_STORM_WINDOW_YEARS;
  if (count === 0) {
    return {
      id: "hail",
      label: "Hail exposure",
      weight,
      strength: 0,
      points: 0,
      detail: `No hail reported within ${radius} mi in ${years}y`,
    };
  }

  const inches = inputs.maxHailInches ?? 0;
  const sizeFactor = clamp01(
    (inches - HAIL_DAMAGE_THRESHOLD_INCHES) / (HAIL_SEVERE_INCHES - HAIL_DAMAGE_THRESHOLD_INCHES),
  );

  const last = toDate(inputs.lastHailDate);
  const yearsSince = last ? Math.max(0, monthsBetween(last, now) / 12) : years;
  const recencyFactor =
    yearsSince <= HAIL_FULL_STRENGTH_YEARS
      ? 1
      : clamp01(1 - (yearsSince - HAIL_FULL_STRENGTH_YEARS) / Math.max(1, years - HAIL_FULL_STRENGTH_YEARS));

  const strength = sizeFactor * recencyFactor;
  const age = yearsSince < 1 ? "under a year ago" : `${yearsSince.toFixed(1)}y ago`;
  const detail = inches
    ? `${inches.toFixed(2)}" hail ${age} · ${count} report${count === 1 ? "" : "s"} within ${radius} mi`
    : `${count} hail report${count === 1 ? "" : "s"} within ${radius} mi, size unrecorded`;

  return { id: "hail", label: "Hail exposure", weight, strength, points: weight * strength, detail };
}

/**
 * Wind exposure from reanalysis. Deliberately a minor signal: ERA5 captures
 * sustained wind well but does not resolve convective storms, so on its own it
 * ranks windy coastlines above hail country. It complements hail, it cannot
 * stand in for it.
 */
function windComponent(inputs: SignalInputs): ScoreComponent {
  const weight = WEIGHTS.wind;
  const days = inputs.severeStormDays;
  if (days === null || days === undefined) {
    return unavailable("wind", "Wind exposure", weight, "No wind history looked up");
  }

  const years = inputs.stormWindowYears ?? DEFAULT_STORM_WINDOW_YEARS;
  const strength = clamp01(days / STORM_DAYS_FOR_FULL_SCORE);
  const peak = inputs.peakGustMph ? `, peak ${Math.round(inputs.peakGustMph)} mph` : "";
  return {
    id: "wind",
    label: "Wind exposure",
    weight,
    strength,
    points: weight * strength,
    detail: `${days} damaging-wind ${days === 1 ? "day" : "days"} in ${years}y${peak}`,
  };
}

/** A new owner is making decisions about the house. */
function recentSaleComponent(inputs: SignalInputs, now: Date): ScoreComponent {
  const weight = WEIGHTS.recentSale;
  const sold = toDate(inputs.lastSaleDate);
  if (!sold) {
    return unavailable("recentSale", "Recent sale", weight, "No sale on record");
  }

  const months = monthsBetween(sold, now);
  if (months < 0) {
    return unavailable("recentSale", "Recent sale", weight, "Sale date is in the future");
  }
  const strength = clamp01(1 - months / RECENT_SALE_MONTHS);
  return {
    id: "recentSale",
    label: "Recent sale",
    weight,
    strength,
    points: weight * strength,
    detail:
      months <= RECENT_SALE_MONTHS
        ? `Changed hands ${months} ${months === 1 ? "month" : "months"} ago`
        : `Last sold ${Math.floor(months / 12)}y ago`,
  };
}

/** Bigger roof, bigger job — revenue per door knocked. */
function jobSizeComponent(inputs: SignalInputs): ScoreComponent {
  const weight = WEIGHTS.jobSize;
  const squares = inputs.roofSquares;
  if (!squares || squares <= 0) {
    return unavailable("jobSize", "Job size", weight, "Roof not measured");
  }
  const strength = clamp01(squares / JOB_SIZE_SATURATION_SQUARES);
  return {
    id: "jobSize",
    label: "Job size",
    weight,
    strength,
    points: weight * strength,
    detail: `${round1(squares)} squares of roof`,
  };
}

function valueComponent(inputs: SignalInputs): ScoreComponent {
  const weight = WEIGHTS.value;
  const value = inputs.assessedValue;
  if (!value || value <= 0) {
    return unavailable("value", "Property value", weight, "No assessed value on record");
  }
  const strength = clamp01(value / VALUE_SATURATION);
  return {
    id: "value",
    label: "Property value",
    weight,
    strength,
    points: weight * strength,
    detail: `Assessed at $${Math.round(value).toLocaleString()}`,
  };
}

/** Work already won nearby: social proof on the doorstep, and a tighter route. */
function neighbourhoodComponent(inputs: SignalInputs): ScoreComponent {
  const weight = WEIGHTS.neighborhood;
  const won = inputs.nearbyWonLeads;
  if (won === null || won === undefined) {
    return unavailable("neighborhood", "Neighbourhood", weight, "Not checked");
  }
  const strength = clamp01(won / NEIGHBOURS_FOR_FULL_SCORE);
  return {
    id: "neighborhood",
    label: "Neighbourhood",
    weight,
    strength,
    points: weight * strength,
    detail: won > 0 ? `${won} job${won === 1 ? "" : "s"} won nearby` : "No jobs won nearby yet",
  };
}

/**
 * A pulled roofing permit means that roof is already done. This is the one signal
 * allowed to override the rest, because no combination of age and hail makes a
 * two-year-old roof worth knocking on.
 */
function permitSuppression(
  inputs: SignalInputs,
  now: Date,
): { suppression: number; suppressionReason: string | null } {
  const permit = toDate(inputs.roofPermitDate);
  if (!permit) return { suppression: 1, suppressionReason: null };

  const years = monthsBetween(permit, now) / 12;
  if (years < 0 || years >= PERMIT_SUPPRESSION_YEARS) {
    return { suppression: 1, suppressionReason: null };
  }

  // Full suppression when fresh, easing back to none by the end of the window.
  const suppression = clamp01(years / PERMIT_SUPPRESSION_YEARS) * 0.9 + 0.05;
  return {
    suppression,
    suppressionReason: `Roofing permit pulled ${years < 1 ? "under a year" : `${Math.floor(years)}y`} ago`,
  };
}

// --- helpers --------------------------------------------------------------

function unavailable(id: string, label: string, weight: number, detail: string): ScoreComponent {
  return { id, label, weight, strength: null, points: 0, detail };
}

function materialLife(material?: string | null): number {
  if (!material) return DEFAULT_MATERIAL_LIFE;
  const key = material.trim().toLowerCase().replace(/[\s-]/g, "_");
  return MATERIAL_LIFE_YEARS[key] ?? DEFAULT_MATERIAL_LIFE;
}

function materialLabel(material?: string | null): string {
  if (!material) return "asphalt";
  return material.replace(/_/g, " ");
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthsBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Serialises the breakdown for the `scoreComponents` column. */
export function serializeScore(score: LeadScore): string {
  return JSON.stringify({
    baseScore: score.baseScore,
    components: score.components.map((c) => ({
      id: c.id,
      label: c.label,
      weight: c.weight,
      strength: c.strength,
      points: Math.round(c.points * 10) / 10,
      detail: c.detail,
    })),
    suppression: score.suppression,
    suppressionReason: score.suppressionReason,
  });
}

export interface StoredScoreBreakdown {
  baseScore?: number;
  components: ScoreComponent[];
  suppression: number;
  suppressionReason: string | null;
}

/** Reads a stored breakdown back; returns null rather than throwing on bad JSON. */
export function parseScore(raw: string | null | undefined): StoredScoreBreakdown | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredScoreBreakdown;
    return Array.isArray(parsed?.components) ? parsed : null;
  } catch {
    return null;
  }
}
