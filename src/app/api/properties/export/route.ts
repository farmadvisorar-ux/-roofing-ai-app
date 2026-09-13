import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { QueryError, buildOrderBy, buildWhere, parsePropertyQuery } from "@/lib/propertyQuery";

export const dynamic = "force-dynamic";

/** Hard ceiling so an unfiltered export can't try to stream the whole table. */
const MAX_EXPORT_ROWS = 10000;

const COLUMNS = [
  "id",
  "score",
  "band",
  "confidence",
  "territory",
  "address",
  "city",
  "state",
  "zip",
  "owner",
  "parcelId",
  "roofSquares",
  "estimateLow",
  "estimateHigh",
  "yearBuilt",
  "roofShape",
  "roofMaterial",
  "assessedValue",
  "lastSaleDate",
  "hailEventsNearby",
  "maxHailInches",
  "lastHailDate",
  "severeStormDays",
  "peakGustMph",
  "roofPermitDate",
  "enrichmentStatus",
  "sources",
  "leadId",
  "lat",
  "lng",
] as const;

/**
 * GET /api/properties/export — the current filter as CSV.
 *
 * Takes exactly the same query parameters as the list endpoint and shares its
 * filter builder, so what downloads is what was on screen.
 */
export async function GET(request: NextRequest) {
  let query;
  try {
    query = parsePropertyQuery(request.nextUrl.searchParams);
  } catch (err) {
    if (err instanceof QueryError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  const properties = await prisma.property.findMany({
    where: buildWhere(query),
    orderBy: buildOrderBy(query),
    take: MAX_EXPORT_ROWS,
  });

  const rows = properties.map((p) => [
    p.id,
    p.leadScore,
    p.leadScoreBand,
    p.scoreConfidence,
    p.territory,
    p.address,
    p.city,
    p.state,
    p.zip,
    p.ownerName,
    p.parcelId,
    p.roofSquares,
    p.estimateLow,
    p.estimateHigh,
    p.yearBuilt,
    p.roofShape,
    p.roofMaterial,
    p.assessedValue,
    isoDay(p.lastSaleDate),
    p.hailEventsNearby,
    p.maxHailInches,
    isoDay(p.lastHailDate),
    p.severeStormDays,
    p.peakGustMph,
    isoDay(p.roofPermitDate),
    p.enrichmentStatus,
    p.enrichmentSources,
    p.leadId,
    p.lat,
    p.lng,
  ]);

  const csv = [COLUMNS.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n");
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="prospects-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

function isoDay(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/**
 * Quotes anything a spreadsheet would misread, and prefixes the formula-trigger
 * characters so a crafted owner name can't execute on open.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
