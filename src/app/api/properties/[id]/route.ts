import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { estimateMidpoint, estimateRoof } from "@/lib/roofing";
import { recordEvent, rescoreProperty } from "@/lib/propertyScoring";
import { PropertyEventKind } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/properties/[id]">) {
  const { id } = await ctx.params;
  const property = await prisma.property.findUnique({
    where: { id },
    include: {
      lead: { include: { contact: true } },
      // Enough history to answer "what changed and when", not the whole life story.
      events: { orderBy: { createdAt: "desc" }, take: 25 },
    },
  });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
  return NextResponse.json({ property });
}

interface UpdatePropertyBody {
  notes?: string;
  ownerName?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  // A rep who measured the roof themselves beats any open-data guess.
  footprintSqFt?: number;
  buildingLevels?: number;
  roofShape?: string;
  roofMaterial?: string;
}

/** Fields that change the roof estimate and so trigger a recompute. */
const MEASUREMENT_KEYS = ["footprintSqFt", "buildingLevels", "roofShape", "roofMaterial"] as const;

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/properties/[id]">) {
  const { id } = await ctx.params;
  let body: UpdatePropertyBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const existing = await prisma.property.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  for (const key of ["footprintSqFt", "buildingLevels"] as const) {
    const value = body[key];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) {
      return NextResponse.json({ error: `${key} must be a positive number` }, { status: 400 });
    }
  }

  const measurementsChanged = MEASUREMENT_KEYS.some((key) => body[key] !== undefined);
  const estimate = measurementsChanged
    ? estimateRoof({
        footprintSqFt: body.footprintSqFt ?? existing.footprintSqFt,
        buildingLevels: body.buildingLevels ?? existing.buildingLevels,
        roofShape: body.roofShape ?? existing.roofShape,
        roofMaterial: body.roofMaterial ?? existing.roofMaterial,
      })
    : null;

  const property = await prisma.property.update({
    where: { id },
    data: {
      notes: trimToNull(body.notes),
      ownerName: trimToNull(body.ownerName),
      address: trimToNull(body.address),
      city: trimToNull(body.city),
      state: trimToNull(body.state),
      zip: trimToNull(body.zip),
      footprintSqFt: body.footprintSqFt,
      buildingLevels: body.buildingLevels,
      roofShape: trimToNull(body.roofShape),
      roofMaterial: trimToNull(body.roofMaterial),
      ...(estimate
        ? {
            roofSqFt: estimate.roofSqFt,
            roofSquares: estimate.roofSquares,
            estimateLow: estimate.estimateLow,
            estimateHigh: estimate.estimateHigh,
          }
        : {}),
    },
    include: { lead: { include: { contact: true } } },
  });

  // A hand-measured roof should move the lead's pipeline value too.
  if (estimate && property.leadId) {
    await prisma.lead.update({
      where: { id: property.leadId },
      data: { estimatedValue: estimateMidpoint(estimate) },
    });
  }

  const changed = Object.keys(body).filter((k) => body[k as keyof UpdatePropertyBody] !== undefined);
  await recordEvent({
    propertyId: id,
    kind: measurementsChanged ? PropertyEventKind.MEASURED : PropertyEventKind.UPDATED,
    summary: measurementsChanged
      ? `Measurements corrected by hand (${changed.join(", ")})`
      : `Edited ${changed.join(", ")}`,
    detail: body,
    actor: "user",
  });

  // A hand measurement changes the job size the score is built on.
  if (measurementsChanged) {
    const rescored = await rescoreProperty(property, { actor: "user" });
    return NextResponse.json({ property: { ...rescored, lead: property.lead } });
  }

  return NextResponse.json({ property });
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/properties/[id]">) {
  const { id } = await ctx.params;
  const existing = await prisma.property.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Property not found" }, { status: 404 });
  await prisma.property.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

/** Undefined leaves the column alone; an empty string clears it. */
function trimToNull(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value.trim() || null;
}
