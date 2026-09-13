import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchBuildingsInBounds } from "@/lib/openData";
import { enrichmentStatusFor } from "@/lib/propertyEnrichment";
import { estimateRoof } from "@/lib/roofing";
import { DEDUPE_RADIUS_FT, GeoBounds, boundsAreaSqMi, distanceFt, isValidBounds } from "@/lib/geo";
import { recordEvent, rescoreProperty } from "@/lib/propertyScoring";
import { PropertyEventKind } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

/**
 * A sweep is one Overpass query, so the area has to stay neighbourhood-sized.
 * Roughly a 1 mi × 1 mi block of suburbia — beyond that, zoom in.
 */
const MAX_SWEEP_AREA_SQ_MI = 1;
const DEFAULT_SWEEP_LIMIT = 300;
const MAX_SWEEP_LIMIT = 1000;

interface SweepBody extends Partial<GeoBounds> {
  limit?: number;
}

/**
 * POST /api/properties/sweep — pin every building in an area at once.
 *
 * Where dropping a single pin runs the full enrichment chain, a sweep runs one
 * Overpass query for the whole box and takes each building's own OSM tags. It
 * deliberately does not geocode or look up owners per building — that would be
 * hundreds of throttled requests. Tap an individual pin afterwards to run the
 * full lookup on the roofs worth pursuing.
 */
export async function POST(request: NextRequest) {
  let body: SweepBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const bounds: GeoBounds = {
    minLat: Number(body?.minLat),
    minLng: Number(body?.minLng),
    maxLat: Number(body?.maxLat),
    maxLng: Number(body?.maxLng),
  };
  if (!isValidBounds(bounds)) {
    return NextResponse.json(
      { error: "Provide numeric minLat, minLng, maxLat, maxLng within valid ranges" },
      { status: 400 },
    );
  }

  const areaSqMi = boundsAreaSqMi(bounds);
  if (areaSqMi > MAX_SWEEP_AREA_SQ_MI) {
    return NextResponse.json(
      {
        error: `That area is ${areaSqMi.toFixed(1)} sq mi — zoom in to under ${MAX_SWEEP_AREA_SQ_MI} sq mi to sweep it`,
        areaSqMi,
      },
      { status: 400 },
    );
  }

  const limit = clampLimit(body.limit);

  let candidates;
  try {
    candidates = await fetchBuildingsInBounds(bounds, limit);
  } catch (err) {
    // The sweep is one upstream call, so unlike per-property enrichment there is
    // nothing to fall back to — say so rather than inventing pins.
    return NextResponse.json(
      { error: `Could not reach OpenStreetMap: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  // Existing pins in the area, so a re-sweep adds only what is new.
  const existing = await prisma.property.findMany({
    where: {
      lat: { gte: bounds.minLat, lte: bounds.maxLat },
      lng: { gte: bounds.minLng, lte: bounds.maxLng },
    },
    select: { id: true, lat: true, lng: true, osmRef: true },
  });
  const knownRefs = new Set(existing.map((p) => p.osmRef).filter(Boolean));
  // Proximity only guards against re-pinning a roof someone dropped by hand: a
  // hand-dropped pin has no identity but its coordinates. Two OSM ways are two
  // different buildings however close their pins sit — terraced houses and city
  // blocks share party walls, and dropping one of a pair would lose a real lead.
  const handPlaced = existing.filter((p) => !p.osmRef).map((p) => ({ lat: p.lat, lng: p.lng }));

  const created = [];
  let skipped = 0;

  for (const candidate of candidates) {
    if (knownRefs.has(candidate.osmRef)) {
      skipped++;
      continue;
    }
    if (handPlaced.some((p) => distanceFt(p, candidate.centroid) <= DEDUPE_RADIUS_FT)) {
      skipped++;
      continue;
    }

    const facts = candidate.facts;
    const estimate = estimateRoof({
      footprintSqFt: facts.footprintSqFt,
      roofShape: facts.roofShape,
      roofMaterial: facts.roofMaterial,
      buildingLevels: facts.buildingLevels,
    });

    try {
      const property = await prisma.property.create({
        data: {
          lat: candidate.centroid.lat,
          lng: candidate.centroid.lng,
          address: facts.address ?? null,
          city: facts.city ?? null,
          state: facts.state ?? null,
          zip: facts.zip ?? null,
          osmRef: candidate.osmRef,
          footprintSqFt: facts.footprintSqFt ?? null,
          buildingLevels: facts.buildingLevels ?? null,
          roofShape: facts.roofShape ?? null,
          roofMaterial: facts.roofMaterial ?? null,
          yearBuilt: facts.yearBuilt ?? null,
          roofSqFt: estimate.roofSqFt,
          roofSquares: estimate.roofSquares,
          estimateLow: estimate.estimateLow,
          estimateHigh: estimate.estimateHigh,
          // No owner: a sweep never touches the parcel layer, and the pipeline
          // does not invent one. Enrich an individual pin to fill it in.
          enrichmentStatus: enrichmentStatusFor({
            hasRealSource: true,
            haveAddress: Boolean(facts.address),
            haveFootprint: Boolean(facts.footprintSqFt),
            hadErrors: false,
          }),
          enrichmentSources: "overpass",
          enrichedAt: new Date(),
        },
      });
      await recordEvent({
        propertyId: property.id,
        kind: PropertyEventKind.SWEPT,
        summary: `Pinned by area sweep from ${candidate.osmRef}`,
        detail: { osmRef: candidate.osmRef, footprintSqFt: facts.footprintSqFt },
        actor: "sweep",
      });
      // Hail and neighbourhood signals are local queries, so a swept roof is
      // ranked immediately rather than waiting for someone to open it.
      created.push(await rescoreProperty(property, { silent: true, actor: "sweep" }));
      knownRefs.add(candidate.osmRef);
    } catch (err) {
      // A concurrent sweep of the same block can claim an osmRef first. That is a
      // skip, not a failure — the pin exists either way.
      if (isUniqueViolation(err)) {
        skipped++;
        continue;
      }
      throw err;
    }
  }

  // Best prospects first, so the rep knows where to start knocking. Score leads,
  // with estimate as the tie-break — a big roof nobody can sell is worth less
  // than a smaller one with hail damage and an owner who just moved in.
  created.sort(
    (a, b) => (b.leadScore ?? 0) - (a.leadScore ?? 0) || (b.estimateHigh ?? 0) - (a.estimateHigh ?? 0),
  );

  return NextResponse.json({
    created,
    createdCount: created.length,
    skipped,
    found: candidates.length,
    truncated: candidates.length >= limit,
    areaSqMi: Math.round(areaSqMi * 1000) / 1000,
  });
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "P2002";
}

function clampLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return DEFAULT_SWEEP_LIMIT;
  return Math.min(Math.floor(raw), MAX_SWEEP_LIMIT);
}
