"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LeadDTO } from "@/lib/types";
import { LeadStage } from "@/generated/prisma/enums";

const STAGES: LeadStage[] = ["NEW", "CONTACTED", "QUOTED", "NEGOTIATING", "WON", "LOST"];
const STAGE_LABELS: Record<LeadStage, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUOTED: "Quoted",
  NEGOTIATING: "Negotiating",
  WON: "Won",
  LOST: "Lost",
};

export default function CrmDashboard() {
  const [leads, setLeads] = useState<LeadDTO[] | null>(null);

  useEffect(() => {
    fetch("/api/leads")
      .then((res) => res.json())
      .then((data) => setLeads(data.leads));
  }, []);

  async function moveStage(id: string, stage: LeadStage) {
    setLeads((prev) => prev?.map((l) => (l.id === id ? { ...l, stage } : l)) ?? prev);
    await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    });
  }

  if (!leads) {
    return <p className="text-neutral-400">Loading leads…</p>;
  }

  const pipelineValue = leads
    .filter((l) => l.stage !== "WON" && l.stage !== "LOST")
    .reduce((sum, l) => sum + l.estimatedValue, 0);

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-4">
        <StatCard label="Open leads" value={leads.filter((l) => l.stage !== "WON" && l.stage !== "LOST").length} />
        <StatCard label="Open pipeline value" value={`$${pipelineValue.toLocaleString()}`} />
        <StatCard label="Won" value={leads.filter((l) => l.stage === "WON").length} />
      </div>

      <div className="grid gap-4 overflow-x-auto pb-4 [grid-auto-columns:minmax(220px,1fr)] [grid-auto-flow:column]">
        {STAGES.map((stage) => (
          <div key={stage} className="flex flex-col rounded-lg border border-neutral-800 bg-neutral-900">
            <div className="border-b border-neutral-800 px-3 py-2 text-sm font-semibold text-neutral-200">
              {STAGE_LABELS[stage]}
              <span className="ml-2 text-xs text-neutral-500">
                {leads.filter((l) => l.stage === stage).length}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2 p-2">
              {leads
                .filter((l) => l.stage === stage)
                .map((lead) => (
                  <div key={lead.id} className="rounded-md border border-neutral-800 bg-neutral-950 p-3 text-sm">
                    <Link href={`/crm/leads/${lead.id}`} className="block font-medium text-white hover:underline">
                      {lead.contact.name}
                    </Link>
                    <div className="mt-1 text-neutral-400">
                      {lead.shedConfig ? `${lead.shedConfig.widthFt}'×${lead.shedConfig.lengthFt}'` : "No config"}
                      {" · "}${lead.estimatedValue.toLocaleString()}
                    </div>
                    <select
                      value={lead.stage}
                      onChange={(e) => moveStage(lead.id, e.target.value as LeadStage)}
                      className="mt-2 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200"
                    >
                      {STAGES.map((s) => (
                        <option key={s} value={s}>
                          {STAGE_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              {leads.filter((l) => l.stage === stage).length === 0 && (
                <p className="px-1 py-2 text-xs text-neutral-600">No leads</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="text-xl font-semibold text-white">{value}</div>
    </div>
  );
}
