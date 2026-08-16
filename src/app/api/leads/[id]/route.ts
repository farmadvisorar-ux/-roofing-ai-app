import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LeadStage } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/leads/[id]">) {
  const { id } = await ctx.params;
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: { contact: true, shedConfig: true, contracts: { orderBy: { createdAt: "desc" } } },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  return NextResponse.json({ lead });
}

interface UpdateLeadBody {
  stage?: string;
  notes?: string;
  estimatedValue?: number;
  contact?: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
}

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/leads/[id]">) {
  const { id } = await ctx.params;
  let body: UpdateLeadBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const existing = await prisma.lead.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  if (body.stage && !Object.values(LeadStage).includes(body.stage as LeadStage)) {
    return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
  }

  const lead = await prisma.lead.update({
    where: { id },
    data: {
      stage: body.stage as LeadStage | undefined,
      notes: body.notes,
      estimatedValue: body.estimatedValue,
      contact: body.contact
        ? {
            update: {
              name: body.contact.name?.trim(),
              email: body.contact.email?.trim() || null,
              phone: body.contact.phone?.trim() || null,
              address: body.contact.address?.trim() || null,
              city: body.contact.city?.trim() || null,
              state: body.contact.state?.trim() || null,
              zip: body.contact.zip?.trim() || null,
            },
          }
        : undefined,
    },
    include: { contact: true, shedConfig: true, contracts: true },
  });

  return NextResponse.json({ lead });
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/leads/[id]">) {
  const { id } = await ctx.params;
  const existing = await prisma.lead.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  await prisma.lead.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
