import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TERRITORIES } from "@/lib/territories";
import { ScoreBand, StormKind } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

/** Hail this recent is what a storm-chasing crew is actually deployed against. */
const RECENT_HAIL_YEARS = 2;

/**
 * GET /api/territories — the service footprint with live coverage.
 *
 * One row per region: how many roofs we hold, how many are still unworked, what
 * they are worth, and whether the region has had hail worth chasing. This is the
 * view a manager uses to decide where to send a crew.
 */
export async function GET() {
  const since = new Date();
  since.setFullYear(since.getFullYear() - RECENT_HAIL_YEARS);

  const [totals, unworked, priority, storms] = await Promise.all([
    prisma.property.groupBy({
      by: ["territory"],
      _count: { _all: true },
      _avg: { leadScore: true },
      _sum: { estimateHigh: true },
    }),
    prisma.property.groupBy({ by: ["territory"], where: { leadId: null }, _count: { _all: true } }),
    prisma.property.groupBy({
      by: ["territory"],
      where: { leadScoreBand: { in: [ScoreBand.HOT, ScoreBand.WARM] } },
      _count: { _all: true },
    }),
    // Storm counts are per-region bounding-box queries; six of them, all indexed.
    Promise.all(
      TERRITORIES.map(async (territory) => {
        const where = {
          kind: StormKind.HAIL,
          lat: { gte: territory.bounds.minLat, lte: territory.bounds.maxLat },
          lng: { gte: territory.bounds.minLng, lte: territory.bounds.maxLng },
        };
        const [total, recent, biggest, latest, preliminaryCount] = await Promise.all([
          prisma.stormEvent.count({ where }),
          prisma.stormEvent.count({ where: { ...where, occurredAt: { gte: since } } }),
          prisma.stormEvent.findFirst({
            where,
            orderBy: { magnitude: "desc" },
            select: { magnitude: true, occurredAt: true },
          }),
          // Surfaced so the UI can show how current the storm data actually is.
          prisma.stormEvent.findFirst({
            where,
            orderBy: { occurredAt: "desc" },
            select: { occurredAt: true, preliminary: true },
          }),
          prisma.stormEvent.count({ where: { ...where, preliminary: true } }),
        ]);
        return { id: territory.id, total, recent, biggest, latest, preliminaryCount };
      }),
    ),
  ]);

  const byTerritory = <T extends { territory: string | null }>(rows: T[], id: string) =>
    rows.find((row) => row.territory === id);

  const territories = TERRITORIES.map((territory) => {
    const total = byTerritory(totals, territory.id);
    const storm = storms.find((s) => s.id === territory.id);
    return {
      id: territory.id,
      name: territory.name,
      states: territory.states,
      bounds: territory.bounds,
      center: territory.center,
      zoom: territory.zoom,
      hubs: territory.hubs,
      properties: total?._count._all ?? 0,
      unworked: byTerritory(unworked, territory.id)?._count._all ?? 0,
      priority: byTerritory(priority, territory.id)?._count._all ?? 0,
      averageScore: total?._avg.leadScore === null || total?._avg.leadScore === undefined
        ? null
        : Math.round(total._avg.leadScore),
      estimatedValue: Math.round(total?._sum.estimateHigh ?? 0),
      hailEvents: storm?.total ?? 0,
      recentHailEvents: storm?.recent ?? 0,
      largestHailInches: storm?.biggest?.magnitude ?? null,
      largestHailDate: storm?.biggest?.occurredAt ?? null,
      latestHailDate: storm?.latest?.occurredAt ?? null,
      latestHailIsPreliminary: storm?.latest?.preliminary ?? false,
      preliminaryHailEvents: storm?.preliminaryCount ?? 0,
      recentHailYears: RECENT_HAIL_YEARS,
    };
  });

  // Roofs whose coordinates fall outside every region — usually a stray pin.
  const outside = totals.find((row) => row.territory === null)?._count._all ?? 0;

  return NextResponse.json({ territories, outsideFootprint: outside });
}
