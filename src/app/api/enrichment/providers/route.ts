import { NextResponse } from "next/server";
import { describeProviders } from "@/lib/propertyEnrichment";

export const dynamic = "force-dynamic";

/** Which open-data lookups this deployment can perform — the map shows this so nobody wonders why a field is blank. */
export async function GET() {
  return NextResponse.json(describeProviders());
}
