import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { estimateMidpoint } from "@/lib/roofing";
import { LeadSource, LeadStage } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

interface CreateLeadFromPropertyBody {
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
  stage?: string;
}

/**
 * POST /api/properties/:id/lead — work a canvassed roof into the pipeline.
 *
 * Unlike POST /api/leads (a customer filling in the configurator form), this does
 * not require an email or phone: the whole point of door-knocking is that you have
 * an address and an owner of record long before you have contact details.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/properties/[id]/lead">) {
  const { id } = await ctx.params;

  let body: CreateLeadFromPropertyBody;
  try {
    body = await request.json();
  } catch {
    // A bare POST is a valid "make this a lead as-is" request.
    body = {};
  }

  const property = await prisma.property.findUnique({ where: { id } });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
  if (property.leadId) {
    return NextResponse.json(
      { error: "Property is already a lead", leadId: property.leadId },
      { status: 409 },
    );
  }

  if (body.stage && !Object.values(LeadStage).includes(body.stage as LeadStage)) {
    return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
  }

  // Best name we have: what the rep typed, else the owner of record, else the address.
  const name = body.name?.trim() || property.ownerName || property.address || "Unknown owner";
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
          email: body.email?.trim() || null,
          phone: body.phone?.trim() || null,
          address: property.address,
          city: property.city,
          state: property.state,
          zip: property.zip,
        },
      },
      property: { connect: { id: property.id } },
    },
    include: { contact: true, shedConfig: true, contracts: true, property: true },
  });

  return NextResponse.json({ lead }, { status: 201 });
}
