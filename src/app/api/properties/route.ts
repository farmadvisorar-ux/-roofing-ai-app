import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enrichProperty } from "@/lib/propertyEnrichment";
import { EnrichmentStatus } from "@/generated/prisma/enums";
import { DEDUPE_RADIUS_FT, GeoBounds, degreeDeltas, distanceFt, isValidBounds } from "@/lib/geo";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 200;

/** GET /api/properties — map pins, optionally limited to the viewport. */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;

  const bbox = readBbox(q);
  if (bbox === "invalid") {
    return NextResponse.json({ error: "bbox requires numeric minLat, minLng, maxLat, maxLng" }, { status: 400 });
  }

  const status = q.get("status");
  if (status && !Object.values(EnrichmentStatus).includes(status as EnrichmentStatus)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const limit = clampLimit(q.get("limit"));
  // ?unworked=1 hides properties already converted into a lead.
  const unworked = q.get("unworked") === "1";

  const properties = await prisma.property.findMany({
    where: {
      ...(bbox
        ? { lat: { gte: bbox.minLat, lte: bbox.maxLat }, lng: { gte: bbox.minLng, lte: bbox.maxLng } }
        : {}),
      ...(status ? { enrichmentStatus: status as EnrichmentStatus } : {}),
      ...(unworked ? { leadId: null } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ properties });
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

  if (body.enrich) {
    property = await enrichProperty({ propertyId: property.id });
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

function readBbox(q: URLSearchParams): GeoBounds | null | "invalid" {
  const keys = ["minLat", "minLng", "maxLat", "maxLng"] as const;
  const present = keys.filter((k) => q.get(k) !== null);
  if (present.length === 0) return null;
  if (present.length !== keys.length) return "invalid";

  const [minLat, minLng, maxLat, maxLng] = keys.map((k) => Number(q.get(k)));
  const bounds = { minLat, minLng, maxLat, maxLng };
  return isValidBounds(bounds) ? bounds : "invalid";
}

function clampLimit(raw: string | null): number {
  const n = raw === null ? DEFAULT_LIMIT : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}
