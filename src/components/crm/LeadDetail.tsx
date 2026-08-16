"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LeadDTO } from "@/lib/types";
import { LeadStage } from "@/generated/prisma/enums";
import ShedViewer3D from "../ShedViewer3D";
import QrCode from "../QrCode";
import { ROOF_STYLE_LABELS, ShedConfigInput } from "@/lib/shed";

const STAGES: LeadStage[] = ["NEW", "CONTACTED", "QUOTED", "NEGOTIATING", "WON", "LOST"];

export default function LeadDetail({ leadId }: { leadId: string }) {
  const [lead, setLead] = useState<LeadDTO | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/leads/${leadId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Lead not found");
        return res.json();
      })
      .then((data) => {
        setLead(data.lead);
        setNotes(data.lead.notes ?? "");
      })
      .catch(() => setError("Lead not found"));
  }, [leadId]);

  async function updateLead(patch: Partial<{ stage: LeadStage; notes: string }>) {
    setSaving(true);
    const res = await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    setSaving(false);
    if (res.ok) setLead(data.lead);
  }

  const shedConfig: ShedConfigInput | null = useMemo(() => {
    if (!lead?.shedConfig) return null;
    const { id, price, ...rest } = lead.shedConfig;
    void id;
    void price;
    return rest;
  }, [lead]);

  const arUrl =
    typeof window !== "undefined" ? `${window.location.origin}/ar?leadId=${leadId}` : `/ar?leadId=${leadId}`;

  if (error) return <p className="text-red-400">{error}</p>;
  if (!lead) return <p className="text-neutral-400">Loading…</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        {shedConfig ? (
          <ShedViewer3D config={shedConfig} className="aspect-[4/3] w-full bg-neutral-800 rounded-lg" />
        ) : (
          <div className="flex aspect-[4/3] items-center justify-center rounded-lg bg-neutral-900 text-neutral-500">
            No shed configuration saved for this lead.
          </div>
        )}

        {lead.shedConfig && (
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-300">
            <div className="grid grid-cols-2 gap-2">
              <div>Dimensions: {lead.shedConfig.widthFt}&apos; × {lead.shedConfig.lengthFt}&apos;</div>
              <div>Wall height: {lead.shedConfig.wallHeightFt}&apos;</div>
              <div>Roof: {ROOF_STYLE_LABELS[lead.shedConfig.roofStyle]}</div>
              <div>Doors / windows: {lead.shedConfig.doorCount} / {lead.shedConfig.windowCount}</div>
              <div className="col-span-2 text-base font-semibold text-white">
                ${lead.shedConfig.price.toLocaleString()}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-4 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <QrCode value={arUrl} size={96} />
          <div className="text-sm text-neutral-300">
            <p className="mb-2">Scan to relaunch this shed in AR on a phone.</p>
            <Link
              href={`/crm/leads/${leadId}/contract`}
              className="inline-block rounded-md bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-500"
            >
              Financing / RTO contract →
            </Link>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-300">Contact</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm text-neutral-300">
            <dt className="text-neutral-500">Name</dt>
            <dd>{lead.contact.name}</dd>
            <dt className="text-neutral-500">Email</dt>
            <dd>{lead.contact.email ?? "—"}</dd>
            <dt className="text-neutral-500">Phone</dt>
            <dd>{lead.contact.phone ?? "—"}</dd>
            <dt className="text-neutral-500">Address</dt>
            <dd>
              {[lead.contact.address, lead.contact.city, lead.contact.state, lead.contact.zip]
                .filter(Boolean)
                .join(", ") || "—"}
            </dd>
            <dt className="text-neutral-500">Source</dt>
            <dd>{lead.source}</dd>
          </dl>
        </section>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-300">Pipeline stage</h2>
          <div className="flex flex-wrap gap-2">
            {STAGES.map((s) => (
              <button
                key={s}
                onClick={() => updateLead({ stage: s })}
                disabled={saving}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  lead.stage === s
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                    : "border-neutral-700 text-neutral-300 hover:border-neutral-500"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-300">Notes</h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            className="input w-full"
            placeholder="Call notes, follow-ups, objections…"
          />
          <button
            onClick={() => updateLead({ notes })}
            disabled={saving}
            className="mt-2 rounded-md bg-neutral-700 px-3 py-1.5 text-sm text-white hover:bg-neutral-600"
          >
            Save notes
          </button>
        </section>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-300">Contracts</h2>
          {lead.contracts.length === 0 && <p className="text-sm text-neutral-500">No contracts yet.</p>}
          <ul className="flex flex-col gap-2">
            {lead.contracts.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/crm/leads/${leadId}/contract?contractId=${c.id}`}
                  className="flex items-center justify-between rounded-md border border-neutral-800 px-3 py-2 text-sm hover:border-neutral-600"
                >
                  <span>
                    {c.type.replace("_", " ")} · ${c.totalPrice.toLocaleString()}
                  </span>
                  <span
                    className={
                      c.status === "SIGNED"
                        ? "text-emerald-400"
                        : c.status === "VOID"
                          ? "text-red-400"
                          : "text-neutral-400"
                    }
                  >
                    {c.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
