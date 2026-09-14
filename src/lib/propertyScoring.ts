// Scoring a stored property, and the audit trail behind it.
//
// Scoring is separated from enrichment because it runs on more occasions than a
// lookup does: after enrichment, after a sweep, after a rep corrects a
// measurement, and after a neighbour converts. Every run leaves a PropertyEvent,
// so "why is this an 84, and why was it a 61 yesterday?" is answerable.
import { prisma } from "@/lib/prisma";
import { hailExposure, nearbyWonLeads } from "@/lib/localSignals";
import { LeadScore, scoreProperty, serializeScore } from "@/lib/signals";
import { PropertyEventKind } from "@/generated/prisma/enums";
import { territoryIdForPoint } from "@/lib/territories";
import type { PropertyModel } from "@/generated/prisma/models";

export interface RecordEventArgs {
  propertyId: string;
  kind: PropertyEventKind;
  summary: string;
  detail?: unknown;
  actor?: string;
}

/** Appends to the audit trail. Never throws into the caller's path — a lost log
 *  line must not fail the operation it was describing. */
export async function recordEvent(args: RecordEventArgs): Promise<void> {
  try {
    await prisma.propertyEvent.create({
      data: {
        propertyId: args.propertyId,
        kind: args.kind,
        summary: args.summary,
        detail: args.detail === undefined ? null : JSON.stringify(args.detail),
        actor: args.actor ?? null,
      },
    });
  } catch (err) {
    console.error("Failed to record property event", err);
  }
}

export interface RescoreOptions {
  actor?: string;
  /** Skip the event when the caller is already logging a richer one. */
  silent?: boolean;
}

/**
 * Recomputes the score for a stored property and saves it, pulling in the two
 * signals that come from our own tables (hail history, nearby won work) rather
 * than from a provider.
 */
export async function rescoreProperty(
  property: PropertyModel,
  options: RescoreOptions = {},
): Promise<PropertyModel> {
  const point = { lat: property.lat, lng: property.lng };
  const [hail, wonNearby] = await Promise.all([
    hailExposure(point),
    nearbyWonLeads(point, property.id),
  ]);

  const score = scoreProperty({
    yearBuilt: property.yearBuilt,
    roofMaterial: property.roofMaterial,
    roofSquares: property.roofSquares,
    assessedValue: property.assessedValue,
    lastSaleDate: property.lastSaleDate,
    roofPermitDate: property.roofPermitDate,
    severeStormDays: property.severeStormDays,
    peakGustMph: property.peakGustMph,
    stormWindowYears: property.stormWindowYears,
    hailEventsNearby: hail?.hailEventsNearby ?? null,
    maxHailInches: hail?.maxHailInches ?? null,
    lastHailDate: hail?.lastHailDate ?? null,
    hailWindowYears: hail?.hailWindowYears ?? null,
    hailSearchRadiusMi: hail?.hailSearchRadiusMi ?? null,
    nearbyWonLeads: wonNearby,
  });

  // Recomputed on every pass: a pin created before enrichment has no state yet,
  // so its first territory is a bounding-box guess that the geocoded state later
  // corrects. Both go through here.
  const territory = territoryIdForPoint(point, property.state);

  const previous = property.leadScore;
  const updated = await prisma.property.update({
    where: { id: property.id },
    data: {
      territory,
      hailEventsNearby: hail?.hailEventsNearby ?? null,
      maxHailInches: hail?.maxHailInches ?? null,
      lastHailDate: hail?.lastHailDate ?? null,
      hailIsPreliminary: hail?.hailIsPreliminary ?? null,
      hailWindowYears: hail?.hailWindowYears ?? null,
      hailSearchRadiusMi: hail?.hailSearchRadiusMi ?? null,
      leadScore: score.score,
      leadScoreBand: score.band,
      scoreConfidence: score.confidence,
      scoreComponents: serializeScore(score),
      scoredAt: new Date(),
    },
  });

  if (!options.silent) {
    await recordEvent({
      propertyId: property.id,
      kind: PropertyEventKind.SCORED,
      summary: describeScoreChange(previous, score),
      detail: {
        score: score.score,
        baseScore: score.baseScore,
        band: score.band,
        confidence: score.confidence,
        suppression: score.suppression,
        components: score.components.map((c) => ({ id: c.id, points: Math.round(c.points * 10) / 10 })),
      },
      actor: options.actor ?? "scoring",
    });
  }

  return updated;
}

/** Convenience for callers holding only an id. Returns null if it has gone. */
export async function rescorePropertyById(
  propertyId: string,
  options: RescoreOptions = {},
): Promise<PropertyModel | null> {
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) return null;
  return rescoreProperty(property, options);
}

function describeScoreChange(previous: number | null, score: LeadScore): string {
  const suffix = score.suppressionReason ? ` — ${score.suppressionReason}` : "";
  if (previous === null || previous === undefined) {
    return `Scored ${score.score} (${score.band})${suffix}`;
  }
  if (previous === score.score) return `Rescored, unchanged at ${score.score}${suffix}`;
  const direction = score.score > previous ? "up" : "down";
  return `Score ${direction} ${previous} → ${score.score} (${score.band})${suffix}`;
}
