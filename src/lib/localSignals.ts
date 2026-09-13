// Signals we compute from our own tables rather than fetching per address.
//
// Both of these would be an HTTP round trip per property if they lived behind an
// API. Held locally they cost an indexed query, which is what makes scoring a
// 300-building sweep practical.
import { prisma } from "@/lib/prisma";
import { GeoPoint, degreeDeltas, distanceFt } from "@/lib/geo";
import { LeadStage, StormKind } from "@/generated/prisma/enums";

const FT_PER_MILE = 5280;

/** Hail this far away still fell on the same neighbourhood. */
const HAIL_SEARCH_RADIUS_MI = Number(process.env.HAIL_SEARCH_RADIUS_MI ?? 10);
/**
 * Insurance carriers generally require a claim within one to two years of the
 * event, so hail much older than this no longer converts.
 */
const HAIL_WINDOW_YEARS = Number(process.env.HAIL_WINDOW_YEARS ?? 5);

/** Won work this close is genuine social proof on the doorstep. */
const NEIGHBOUR_RADIUS_MI = Number(process.env.NEIGHBOUR_RADIUS_MI ?? 0.5);

export interface HailExposure {
  hailEventsNearby: number;
  maxHailInches: number | null;
  lastHailDate: Date | null;
  hailWindowYears: number;
  hailSearchRadiusMi: number;
}

/**
 * Observed hail near a point, from the imported NOAA reports.
 *
 * Returns null when no storm data has been imported at all — that is "unknown",
 * which the scoring model treats very differently from "no hail here".
 */
export async function hailExposure(point: GeoPoint): Promise<HailExposure | null> {
  const anyImported = await prisma.stormEvent.findFirst({ select: { id: true } });
  if (!anyImported) return null;

  const since = new Date();
  since.setFullYear(since.getFullYear() - HAIL_WINDOW_YEARS);

  const radiusFt = HAIL_SEARCH_RADIUS_MI * FT_PER_MILE;
  const { latDelta, lngDelta } = degreeDeltas(point.lat, radiusFt);

  // Bounding box first so the lat/lng index does the work, then measure exactly.
  const candidates = await prisma.stormEvent.findMany({
    where: {
      kind: StormKind.HAIL,
      occurredAt: { gte: since },
      lat: { gte: point.lat - latDelta, lte: point.lat + latDelta },
      lng: { gte: point.lng - lngDelta, lte: point.lng + lngDelta },
    },
    select: { lat: true, lng: true, magnitude: true, occurredAt: true },
  });

  let count = 0;
  let maxInches: number | null = null;
  let last: Date | null = null;

  for (const event of candidates) {
    if (distanceFt(point, event) > radiusFt) continue;
    count++;
    if (event.magnitude !== null && (maxInches === null || event.magnitude > maxInches)) {
      maxInches = event.magnitude;
    }
    if (last === null || event.occurredAt > last) last = event.occurredAt;
  }

  return {
    hailEventsNearby: count,
    maxHailInches: maxInches,
    lastHailDate: last,
    hailWindowYears: HAIL_WINDOW_YEARS,
    hailSearchRadiusMi: HAIL_SEARCH_RADIUS_MI,
  };
}

/** How many jobs we have already won within a short walk. */
export async function nearbyWonLeads(point: GeoPoint, excludePropertyId?: string): Promise<number> {
  const radiusFt = NEIGHBOUR_RADIUS_MI * FT_PER_MILE;
  const { latDelta, lngDelta } = degreeDeltas(point.lat, radiusFt);

  const nearby = await prisma.property.findMany({
    where: {
      id: excludePropertyId ? { not: excludePropertyId } : undefined,
      lat: { gte: point.lat - latDelta, lte: point.lat + latDelta },
      lng: { gte: point.lng - lngDelta, lte: point.lng + lngDelta },
      lead: { stage: LeadStage.WON },
    },
    select: { lat: true, lng: true },
  });

  return nearby.filter((p) => distanceFt(point, p) <= radiusFt).length;
}
