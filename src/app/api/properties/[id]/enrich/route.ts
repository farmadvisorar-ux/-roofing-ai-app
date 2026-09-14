import { NextRequest, NextResponse } from "next/server";
import { enrichProperty, PropertyNotFoundError } from "@/lib/propertyEnrichment";

export const dynamic = "force-dynamic";

/**
 * POST /api/properties/:id/enrich
 *
 * Runs the open-data lookups and saves what comes back. Individual providers
 * failing is not an error — the property comes back PARTIAL or FAILED with the
 * reasons in `enrichmentError`, so the caller always gets a usable record.
 * Pass `?force=1` to re-run one that is already ENRICHED.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/properties/[id]/enrich">) {
  const { id } = await ctx.params;
  const force = request.nextUrl.searchParams.get("force") === "1";

  try {
    const property = await enrichProperty({ propertyId: id, force });
    return NextResponse.json({ property });
  } catch (err) {
    if (err instanceof PropertyNotFoundError) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }
    throw err;
  }
}
