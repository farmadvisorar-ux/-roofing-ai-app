import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ContractStatus } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/contracts/[id]">) {
  const { id } = await ctx.params;
  const contract = await prisma.contract.findUnique({
    where: { id },
    include: { lead: { include: { contact: true, shedConfig: true } } },
  });
  if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  return NextResponse.json({ contract });
}

interface UpdateContractBody {
  status?: string;
  signerName?: string;
  signatureData?: string;
}

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/contracts/[id]">) {
  const { id } = await ctx.params;
  let body: UpdateContractBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const existing = await prisma.contract.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Contract not found" }, { status: 404 });

  const isSigning = Boolean(body.signatureData);
  if (isSigning && !body.signerName?.trim()) {
    return NextResponse.json({ error: "Signer name is required to sign" }, { status: 400 });
  }

  const status = isSigning
    ? ContractStatus.SIGNED
    : body.status && Object.values(ContractStatus).includes(body.status as ContractStatus)
      ? (body.status as ContractStatus)
      : existing.status;

  const contract = await prisma.contract.update({
    where: { id },
    data: {
      status,
      signerName: isSigning ? body.signerName!.trim() : existing.signerName,
      signatureData: isSigning ? body.signatureData : existing.signatureData,
      signedAt: isSigning ? new Date() : existing.signedAt,
    },
    include: { lead: { include: { contact: true, shedConfig: true } } },
  });

  if (isSigning) {
    await prisma.lead.update({ where: { id: contract.leadId }, data: { stage: "WON" } });
  }

  return NextResponse.json({ contract });
}
