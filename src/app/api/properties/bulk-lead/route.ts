import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { estimateMidpoint } from "@/lib/roofing";
import { recordEvent } from "@/lib/propertyScoring";
import { LeadSource, LeadStage, PropertyEventKind } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

/** A rep works a street, not a city. Bulk conversion is capped accordingly. */
const MAX_BULK = 200;

interface BulkLeadBody {
  propertyIds?: string[];
  stage?: string;
  notes?: string;
}

/**
 * POST /api/properties/bulk-lead — turn a selection into pipeline leads.
 *
 * Partial success is the expected case: a selection made a minute ago may
 * include something a colleague has already converted. Those are reported as
 * skipped rather than failing the whole batch.
 */
export async function POST(request: NextRequest) {
  let body: BulkLeadBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ids = [...new Set(body.propertyIds ?? [])].filter((id) => typeof id === "string");
  if (ids.length === 0) {
    return NextResponse.json({ error: "Provide propertyIds" }, { status: 400 });
  }
  if (ids.length > MAX_BULK) {
    return NextResponse.json(
      { error: `Convert at most ${MAX_BULK} properties at a time (got ${ids.length})` },
      { status: 400 },
    );
  }
  if (body.stage && !Object.values(LeadStage).includes(body.stage as LeadStage)) {
    return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
  }

  const properties = await prisma.property.findMany({ where: { id: { in: ids } } });
  const found = new Set(properties.map((p) => p.id));

  const created: { propertyId: string; leadId: string }[] = [];
  const skipped: { propertyId: string; reason: string }[] = ids
    .filter((id) => !found.has(id))
    .map((id) => ({ propertyId: id, reason: "Not found" }));

  for (const property of properties) {
    if (property.leadId) {
      skipped.push({ propertyId: property.id, reason: "Already a lead" });
      continue;
    }

    const name = property.ownerName || property.address || "Unknown owner";
    const estimatedValue =
      property.estimateLow !== null && property.estimateHigh !== null
        ? estimateMidpoint({ estimateLow: property.estimateLow, estimateHigh: property.estimateHigh })
        : 0;

    const lead = await prisma.lead.create({
      data: {
        stage: (body.stage as LeadStage | undefined) ?? LeadStage.NEW,
        source: LeadSource.CANVASSING,
        estimatedValue,
        notes: body.notes?.trim() || property.notes,
        contact: {
          create: {
            name,
            address: property.address,
            city: property.city,
            state: property.state,
            zip: property.zip,
          },
        },
        property: { connect: { id: property.id } },
      },
    });

    await recordEvent({
      propertyId: property.id,
      kind: PropertyEventKind.CONVERTED,
      summary: `Converted in bulk to a ${lead.stage} lead for ${name}`,
      detail: { leadId: lead.id, estimatedValue, score: property.leadScore },
      actor: "user",
    });
    created.push({ propertyId: property.id, leadId: lead.id });
  }

  return NextResponse.json({ created, createdCount: created.length, skipped }, { status: 201 });
}
