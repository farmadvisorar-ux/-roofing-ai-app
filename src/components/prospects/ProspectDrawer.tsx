"use client";

// Detail for one prospect, opened from a workbench row. Answers, in order: what
// is it worth, why is it scored that way, what do we actually know, and who
// changed it.
import { useState } from "react";
import Link from "next/link";
import { PropertyDTO } from "@/lib/types";
import { createLeadFromProperty, enrichProperty } from "@/lib/propertiesApi";
import { ScoreBreakdown } from "./score";
import { ActivityTimeline, SignalList } from "./signals";

interface ProspectDrawerProps {
  /** Null while the full record (with its event trail) is still loading. */
  property: PropertyDTO | null;
  onClose(): void;
  onChanged(property: PropertyDTO): void;
}

export default function ProspectDrawer({ property, onClose, onChanged }: ProspectDrawerProps) {
  const [busy, setBusy] = useState<null | "enrich" | "convert">(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "enrich" | "convert") {
    if (!property) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === "enrich") {
        onChanged(await enrichProperty(property.id, { force: true }));
      } else {
        const lead = await createLeadFromProperty(property.id);
        onChanged({ ...property, leadId: lead.id });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Prospect detail">
      <button
        type="button"
        aria-label="Close detail"
        onClick={onClose}
        className="flex-1 cursor-default bg-neutral-950/60"
      />
      <aside className="flex h-full w-full max-w-md flex-col gap-5 overflow-y-auto border-l border-neutral-800 bg-neutral-900 p-5">
        {!property ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : (
          <>
            <header className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-white">
                  {property.address ?? `${property.lat.toFixed(5)}, ${property.lng.toFixed(5)}`}
                </h2>
                <p className="truncate text-xs text-neutral-500">
                  {[property.ownerName, property.city, property.state, property.zip].filter(Boolean).join(" · ") ||
                    "No owner or address on record"}
                </p>
              </div>
              <button type="button" onClick={onClose} aria-label="Close" className="px-2 text-neutral-500 hover:text-neutral-200">
                ✕
              </button>
            </header>

            {property.estimateLow !== null && property.estimateHigh !== null && (
              <div className="rounded-lg border border-emerald-800 bg-emerald-500/5 p-3">
                <div className="text-xs uppercase tracking-wide text-emerald-400">Re-roof estimate</div>
                <div className="text-xl font-semibold tabular-nums text-white">
                  ${property.estimateLow.toLocaleString()} – ${property.estimateHigh.toLocaleString()}
                </div>
                <div className="mt-0.5 text-xs text-emerald-200/70">
                  {property.roofSquares?.toLocaleString()} squares · {property.roofSqFt?.toLocaleString()} sq ft
                </div>
              </div>
            )}

            <Section title="Why this score">
              <ScoreBreakdown property={property} />
            </Section>

            <Section title="Signals">
              <SignalList property={property} />
            </Section>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void run("enrich")}
                disabled={busy !== null}
                className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 hover:bg-neutral-700 disabled:opacity-50"
              >
                {busy === "enrich" ? "Looking up…" : "Re-run lookup"}
              </button>
              {property.leadId ? (
                <Link
                  href={`/crm/leads/${property.leadId}`}
                  className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
                >
                  Open lead in CRM
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => void run("convert")}
                  disabled={busy !== null}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {busy === "convert" ? "Creating…" : "Create lead"}
                </button>
              )}
              <Link
                href={`/map?focus=${property.id}`}
                className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
              >
                Show on map
              </Link>
            </div>

            <Section title="Activity">
              <ActivityTimeline events={property.events} />
            </Section>
          </>
        )}
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
      {children}
    </section>
  );
}
