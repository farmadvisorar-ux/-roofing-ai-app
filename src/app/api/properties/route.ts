import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enrichProperty } from "@/lib/propertyEnrichment";
import { recordEvent, rescoreProperty } from "@/lib/propertyScoring";
import { PropertyEventKind } from "@/generated/prisma/enums";
import { DEDUPE_RADIUS_FT, degreeDeltas, distanceFt } from "@/lib/geo";
import { QueryError, buildOrderBy, buildWhere, parsePropertyQuery } from "@/lib/propertyQuery";

export const dynamic = "force-dynamic";

/** GET /api/properties — filtered, sorted, paginated. Also serves the map's viewport. */
export async function GET(request: NextRequest) {
  let query;
  try {
    query = parsePropertyQuery(request.nextUrl.searchParams);
  } catch (err) {
    if (err instanceof QueryError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  const where = buildWhere(query);
  const [properties, total] = await Promise.all([
    prisma.property.findMany({
      where,
      orderBy: buildOrderBy(query),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.property.count({ where }),
  ]);

  return NextResponse.json({
    properties,
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
  });
}

interface CreatePropertyBody {
  lat?: number;
  lng?: number;
  notes?: string;
  /** Run the enrichment pipeline before responding. */
  enrich?: boolean;
}

/** POST /api/properties — drop a pin on a roof worth knocking on. */
export async function POST(request: NextRequest) {
  let body: CreatePropertyBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { lat, lng } = body ?? {};
  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return NextResponse.json({ error: "lat must be a number between -90 and 90" }, { status: 400 });
  }
  if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return NextResponse.json({ error: "lng must be a number between -180 and 180" }, { status: 400 });
  }

  const existing = await findNearbyProperty(lat, lng);
  if (existing) {
    return NextResponse.json({ property: existing, deduped: true });
  }

  let property = await prisma.property.create({
    data: { lat, lng, notes: body.notes?.trim() || null },
  });
  await recordEvent({
    propertyId: property.id,
    kind: PropertyEventKind.CREATED,
    summary: `Pinned at ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    actor: "map",
  });

  if (body.enrich) {
    property = await enrichProperty({ propertyId: property.id });
  } else {
    // Even an unenriched pin gets hail and neighbourhood signals, which come
    // from our own tables and need no lookup.
    property = await rescoreProperty(property, { actor: "map" });
  }

  return NextResponse.json({ property }, { status: 201 });
}

/**
 * Narrows by indexed bounding box, then measures properly — a degree of longitude
 * shrinks with latitude, so a square in degrees is not a circle on the ground.
 */
async function findNearbyProperty(lat: number, lng: number) {
  const { latDelta, lngDelta } = degreeDeltas(lat, DEDUPE_RADIUS_FT);

  const candidates = await prisma.property.findMany({
    where: {
      lat: { gte: lat - latDelta, lte: lat + latDelta },
      lng: { gte: lng - lngDelta, lte: lng + lngDelta },
    },
    take: 25,
  });

  return candidates.find((c) => distanceFt(c, { lat, lng }) <= DEDUPE_RADIUS_FT) ?? null;
}
