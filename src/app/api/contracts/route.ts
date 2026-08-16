import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeMonthlyPayment } from "@/lib/financing";
import { ContractStatus, ContractType } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

interface CreateContractBody {
  leadId: string;
  type: string;
  downPayment?: number;
  apr?: number;
  termMonths?: number;
  totalPrice?: number;
}

export async function GET(request: NextRequest) {
  const leadId = request.nextUrl.searchParams.get("leadId");
  const contracts = await prisma.contract.findMany({
    where: leadId ? { leadId } : undefined,
    include: { lead: { include: { contact: true, shedConfig: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ contracts });
}

export async function POST(request: NextRequest) {
  let body: CreateContractBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.leadId) return NextResponse.json({ error: "leadId is required" }, { status: 400 });
  if (!Object.values(ContractType).includes(body.type as ContractType)) {
    return NextResponse.json({ error: "Invalid contract type" }, { status: 400 });
  }

  const lead = await prisma.lead.findUnique({ where: { id: body.leadId }, include: { shedConfig: true } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const type = body.type as ContractType;
  const totalPrice = body.totalPrice ?? lead.shedConfig?.price ?? lead.estimatedValue;
  const downPayment = Math.max(0, body.downPayment ?? 0);
  const apr = Math.max(0, body.apr ?? 0);
  const termMonths = type === "CASH" ? 0 : Math.max(1, body.termMonths ?? 24);

  const monthlyPayment = computeMonthlyPayment({ type, totalPrice, downPayment, apr, termMonths });

  const contract = await prisma.contract.create({
    data: {
      leadId: lead.id,
      type,
      status: ContractStatus.DRAFT,
      totalPrice,
      downPayment,
      apr,
      termMonths,
      monthlyPayment,
    },
    include: { lead: { include: { contact: true, shedConfig: true } } },
  });

  if (lead.stage === "NEW" || lead.stage === "CONTACTED") {
    await prisma.lead.update({ where: { id: lead.id }, data: { stage: "QUOTED" } });
  }

  return NextResponse.json({ contract }, { status: 201 });
}
