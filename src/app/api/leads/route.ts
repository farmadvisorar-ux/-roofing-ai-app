import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculateShedPrice, clampShedConfig } from "@/lib/shed";
import { LeadSource, LeadStage } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const stage = request.nextUrl.searchParams.get("stage");
  const leads = await prisma.lead.findMany({
    where: stage ? { stage: stage as LeadStage } : undefined,
    include: { contact: true, shedConfig: true, contracts: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ leads });
}

interface CreateLeadBody {
  contact: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  shedConfig: Record<string, unknown>;
  source?: string;
  notes?: string;
}

export async function POST(request: NextRequest) {
  let body: CreateLeadBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.contact?.name || !body.contact.name.trim()) {
    return NextResponse.json({ error: "Contact name is required" }, { status: 400 });
  }
  if (!body.contact.email && !body.contact.phone) {
    return NextResponse.json(
      { error: "Provide at least an email or phone number so we can follow up" },
      { status: 400 },
    );
  }

  const config = clampShedConfig(body.shedConfig ?? {});
  const price = calculateShedPrice(config);

  const source = Object.values(LeadSource).includes(body.source as LeadSource)
    ? (body.source as LeadSource)
    : LeadSource.CONFIGURATOR;

  const lead = await prisma.lead.create({
    data: {
      stage: LeadStage.NEW,
      source,
      estimatedValue: price,
      notes: body.notes,
      contact: {
        create: {
          name: body.contact.name.trim(),
          email: body.contact.email?.trim() || null,
          phone: body.contact.phone?.trim() || null,
          address: body.contact.address?.trim() || null,
          city: body.contact.city?.trim() || null,
          state: body.contact.state?.trim() || null,
          zip: body.contact.zip?.trim() || null,
        },
      },
      shedConfig: {
        create: { ...config, price },
      },
    },
    include: { contact: true, shedConfig: true },
  });

  return NextResponse.json({ lead }, { status: 201 });
}
