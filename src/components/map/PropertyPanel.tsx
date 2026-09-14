"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { LeadDTO, PropertyDTO } from "@/lib/types";
import { estimateRoof, osmShapeToRoofStyle } from "@/lib/roofing";
import { DEFAULT_SHED_CONFIG, ROOF_STYLE_LABELS, shedConfigToQuery } from "@/lib/shed";
import { TONE_BADGE, TONE_LABEL, formatEstimate, propertyTitle, propertyTone } from "./propertyTone";
import { ScoreBadge, ScoreBreakdown } from "@/components/prospects/score";
import { SignalList } from "@/components/prospects/signals";

interface PropertyPanelProps {
  property: PropertyDTO;
  busy: boolean;
  onEnrich(force: boolean): void;
  onMeasure(patch: { footprintSqFt?: number; roofShape?: string }): void;
  onConverted(lead: LeadDTO): void;
  onDelete(): void;
  onClose(): void;
  convertLead(body: { name?: string; email?: string; phone?: string }): Promise<LeadDTO>;
}

const ROOF_SHAPE_OPTIONS = ["gabled", "hipped", "flat", "skillion", "gambrel", "mansard", "pyramidal"];

export default function PropertyPanel({
  property,
  busy,
  onEnrich,
  onMeasure,
  onConverted,
  onDelete,
  onClose,
  convertLead,
}: PropertyPanelProps) {
  const tone = propertyTone(property);
  const estimate = formatEstimate(property);

  // Recomputed client-side purely to learn which inputs were guesses; the stored
  // numbers come from the server. roofing.ts is framework-free, so this is the
  // same function the API used.
  const { assumed, pitchPer12 } = estimateRoof({
    footprintSqFt: property.footprintSqFt,
    roofShape: property.roofShape,
    roofMaterial: property.roofMaterial,
    buildingLevels: property.buildingLevels,
  });

  const arQuery = shedConfigToQuery({
    ...DEFAULT_SHED_CONFIG,
    roofStyle: osmShapeToRoofStyle(property.roofShape),
  });

  return (
    <aside className="flex h-full flex-col gap-4 overflow-y-auto border-l border-neutral-800 bg-neutral-900 p-4">
      <header>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold text-white">{propertyTitle(property)}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="rounded px-2 text-neutral-500 hover:text-neutral-200"
          >
            ✕
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ScoreBadge property={property} />
          <span className={`rounded-full border px-2 py-0.5 text-xs ${TONE_BADGE[tone]}`}>
            {TONE_LABEL[tone]}
          </span>
          <span className="text-xs text-neutral-500">
            {property.lat.toFixed(5)}, {property.lng.toFixed(5)}
          </span>
        </div>
      </header>

      {estimate && (
        <section className="rounded-lg border border-emerald-800 bg-emerald-500/5 p-3">
          <div className="text-xs uppercase tracking-wide text-emerald-400">Re-roof estimate</div>
          <div className="text-xl font-semibold text-white">{estimate}</div>
          <div className="mt-1 text-xs text-emerald-200/80">
            {property.roofSquares?.toLocaleString()} squares · {property.roofSqFt?.toLocaleString()} sq ft
            of roof · {pitchPer12}/12 pitch
          </div>
          {assumed.length > 0 && (
            <p className="mt-2 text-xs text-amber-300">
              Assumed {assumed.join(", ")} — confirm on site before quoting.
            </p>
          )}
        </section>
      )}

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Why this score
        </h3>
        <ScoreBreakdown property={property} />
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Signals</h3>
        <SignalList property={property} />
      </section>

      <section className="space-y-1 text-sm">
        <Row label="Owner of record" value={property.ownerName} />
        <Row label="Parcel" value={property.parcelId} />
        <Row
          label="Address"
          value={[property.address, property.city, property.state, property.zip].filter(Boolean).join(", ") || null}
        />
        <Row label="Footprint" value={property.footprintSqFt ? `${property.footprintSqFt.toLocaleString()} sq ft` : null} />
        <Row label="Storeys" value={property.buildingLevels} />
        <Row label="Roof shape" value={property.roofShape} />
        <Row label="Roof material" value={property.roofMaterial} />
        <Row label="Year built" value={property.yearBuilt} />
        <Row label="OSM building" value={property.osmRef} />
        <Row label="Sources" value={property.enrichmentSources} />
        <Row
          label="Looked up"
          value={property.enrichedAt ? new Date(property.enrichedAt).toLocaleString() : null}
        />
      </section>

      {property.enrichmentError && (
        <p className="rounded border border-red-900 bg-red-500/10 p-2 text-xs text-red-300">
          {property.enrichmentError}
        </p>
      )}

      {property.notes && <p className="text-sm text-neutral-300">{property.notes}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onEnrich(property.enrichmentStatus === "ENRICHED")}
          className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy ? "Looking up…" : property.enrichmentStatus === "PENDING" ? "Look up property" : "Re-run lookup"}
        </button>
        <Link
          href={`/ar?${arQuery.toString()}`}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
        >
          Matching {ROOF_STYLE_LABELS[osmShapeToRoofStyle(property.roofShape)]} shed in AR
        </Link>
      </div>

      <MeasureForm property={property} busy={busy} onMeasure={onMeasure} />

      {property.leadId ? (
        <Link
          href={`/crm/leads/${property.leadId}`}
          className="rounded-md bg-sky-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-sky-500"
        >
          Open lead in CRM
        </Link>
      ) : (
        <ConvertForm property={property} busy={busy} convertLead={convertLead} onConverted={onConverted} />
      )}

      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="mt-auto self-start text-xs text-neutral-500 hover:text-red-400 disabled:opacity-50"
      >
        Remove this pin
      </button>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex justify-between gap-3 border-b border-neutral-800 py-1">
      <span className="text-neutral-500">{label}</span>
      <span className="text-right text-neutral-200">{value === null || value === undefined || value === "" ? "—" : value}</span>
    </div>
  );
}

/** A rep standing in the driveway beats any open-data guess. */
function MeasureForm({
  property,
  busy,
  onMeasure,
}: {
  property: PropertyDTO;
  busy: boolean;
  onMeasure(patch: { footprintSqFt?: number; roofShape?: string }): void;
}) {
  const [footprint, setFootprint] = useState(property.footprintSqFt?.toString() ?? "");
  const [shape, setShape] = useState(property.roofShape ?? "");

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = Number(footprint);
    onMeasure({
      footprintSqFt: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
      roofShape: shape || undefined,
    });
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-neutral-800 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Correct the measurements
      </h3>
      <div className="grid grid-cols-2 gap-2">
        <input
          className="input"
          inputMode="numeric"
          placeholder="Footprint sq ft"
          value={footprint}
          onChange={(e) => setFootprint(e.target.value)}
        />
        <select className="input" value={shape} onChange={(e) => setShape(e.target.value)}>
          <option value="">Roof shape…</option>
          {ROOF_SHAPE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="mt-2 w-full rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
      >
        Save &amp; re-price
      </button>
    </form>
  );
}

function ConvertForm({
  property,
  busy,
  convertLead,
  onConverted,
}: {
  property: PropertyDTO;
  busy: boolean;
  convertLead(body: { name?: string; email?: string; phone?: string }): Promise<LeadDTO>;
  onConverted(lead: LeadDTO): void;
}) {
  const [form, setForm] = useState({ name: property.ownerName ?? "", email: "", phone: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      onConverted(await convertLead(form));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the lead");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-neutral-800 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Add to pipeline
      </h3>
      <div className="grid gap-2">
        <input
          className="input"
          placeholder="Contact name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            className="input"
            type="email"
            placeholder="Email (optional)"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <input
            className="input"
            placeholder="Phone (optional)"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={submitting || busy}
        className="mt-2 w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {submitting ? "Creating lead…" : "Create lead"}
      </button>
      <p className="mt-2 text-xs text-neutral-500">
        No email or phone needed — you can knock first and fill those in later.
      </p>
    </form>
  );
}
