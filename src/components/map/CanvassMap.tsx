"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TileMap, { LatLng, MapBounds } from "./TileMap";
import PropertyMarker from "./PropertyMarker";
import PropertyPanel from "./PropertyPanel";
import { TONE_DOT, TONE_LABEL, Tone, formatEstimate, propertyTitle, propertyTone } from "./propertyTone";
import { LeadDTO, PropertyDTO, ProviderStatusResponse } from "@/lib/types";
import {
  createLeadFromProperty,
  createProperty,
  deleteProperty,
  enrichProperty,
  fetchProviderStatus,
  listProperties,
  sweepArea,
  updateProperty,
} from "@/lib/propertiesApi";

/** Round Rock, TX — the same area the sample leads are in. */
const DEFAULT_CENTER: LatLng = { lat: 30.5083, lng: -97.6789 };
const DEFAULT_ZOOM = 17;
const LEGEND_TONES: Tone[] = ["pending", "partial", "enriched", "failed", "lead"];

export default function CanvassMap() {
  const [center, setCenter] = useState<LatLng>(DEFAULT_CENTER);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [properties, setProperties] = useState<PropertyDTO[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [sweepSummary, setSweepSummary] = useState<string | null>(null);

  // Guards against a slow viewport response overwriting a newer one.
  const loadToken = useRef(0);

  useEffect(() => {
    fetchProviderStatus().then(setProviders).catch(() => setProviders(null));
  }, []);

  /** Replaces a property in the list (and keeps the panel showing the fresh copy). */
  const upsert = useCallback((property: PropertyDTO) => {
    setProperties((prev) => {
      const index = prev.findIndex((p) => p.id === property.id);
      if (index === -1) return [property, ...prev];
      const next = [...prev];
      next[index] = property;
      return next;
    });
  }, []);

  const loadBounds = useCallback(async (next: MapBounds) => {
    setBounds(next);
    const token = ++loadToken.current;
    try {
      const found = await listProperties({ bbox: next });
      if (token !== loadToken.current) return;
      setProperties(found);
      setError(null);
    } catch (err) {
      if (token !== loadToken.current) return;
      setError(err instanceof Error ? err.message : "Could not load properties");
    }
  }, []);

  /** Dropping a pin looks the property up straight away — that's the whole workflow. */
  const handleMapClick = useCallback(
    async (point: LatLng) => {
      setError(null);
      try {
        const { property, deduped } = await createProperty({ ...point, enrich: true });
        upsert(property);
        setSelectedId(property.id);
        if (deduped) setError("That roof already has a pin — opened the existing one.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add that property");
      }
    },
    [upsert],
  );

  const runEnrich = useCallback(
    async (id: string, force: boolean) => {
      setBusyId(id);
      setError(null);
      try {
        upsert(await enrichProperty(id, { force }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Lookup failed");
      } finally {
        setBusyId(null);
      }
    },
    [upsert],
  );

  /** Selecting a pin that has never been looked up triggers the lookup. */
  const handleSelect = useCallback(
    (property: PropertyDTO) => {
      setSelectedId(property.id);
      if (property.enrichmentStatus === "PENDING") void runEnrich(property.id, false);
    },
    [runEnrich],
  );

  /** Pins every building in the current viewport in one go. */
  async function handleSweep() {
    if (!bounds) return;
    setSweeping(true);
    setError(null);
    setSweepSummary(null);
    try {
      const result = await sweepArea(bounds);
      setProperties((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...result.created.filter((p) => !seen.has(p.id)), ...prev];
      });
      setSweepSummary(describeSweep(result));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sweep failed");
    } finally {
      setSweeping(false);
    }
  }

  const selected = properties.find((p) => p.id === selectedId) ?? null;
  // Best prospects first — the order a rep should work the street in.
  const ranked = [...properties].sort((a, b) => (b.estimateHigh ?? 0) - (a.estimateHigh ?? 0));

  async function handleMeasure(id: string, patch: { footprintSqFt?: number; roofShape?: string }) {
    setBusyId(id);
    setError(null);
    try {
      upsert(await updateProperty(id, patch));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save those measurements");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    try {
      await deleteProperty(id);
      setProperties((prev) => prev.filter((p) => p.id !== id));
      setSelectedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that pin");
    } finally {
      setBusyId(null);
    }
  }

  function handleConverted(id: string, lead: LeadDTO) {
    // The lead carries the linked property back, so reuse it rather than refetching.
    if (lead.property) {
      upsert(lead.property);
      return;
    }
    setProperties((prev) => prev.map((p) => (p.id === id ? { ...p, leadId: lead.id } : p)));
  }

  return (
    <div className="space-y-3">
      {providers && <ProviderBanner status={providers} />}
      {error && (
        <p className="rounded-md border border-amber-800 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSweep()}
          disabled={sweeping || !bounds}
          className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {sweeping ? "Sweeping…" : "Sweep this view"}
        </button>
        <span className="text-xs text-neutral-400">
          {sweepSummary ?? "Pins every building in the visible area and prices each roof."}
        </span>
      </div>

      <div className="grid gap-0 overflow-hidden rounded-lg border border-neutral-800 lg:grid-cols-[1fr_360px]">
        <div className="h-[60vh] min-h-[380px] lg:h-[70vh]">
          <TileMap
            center={center}
            zoom={zoom}
            onCenterChange={setCenter}
            onZoomChange={setZoom}
            onMapClick={handleMapClick}
            onBoundsChange={loadBounds}
          >
            {({ project }) =>
              properties.map((property) => {
                const { x, y } = project(property);
                return (
                  <PropertyMarker
                    key={property.id}
                    property={property}
                    x={x}
                    y={y}
                    selected={property.id === selectedId}
                    busy={property.id === busyId}
                    onSelect={handleSelect}
                  />
                );
              })
            }
          </TileMap>
        </div>

        <div className="h-[60vh] min-h-[380px] lg:h-[70vh]">
          {selected ? (
            <PropertyPanel
              property={selected}
              busy={busyId === selected.id}
              onEnrich={(force) => void runEnrich(selected.id, force)}
              onMeasure={(patch) => void handleMeasure(selected.id, patch)}
              onConverted={(lead) => handleConverted(selected.id, lead)}
              onDelete={() => void handleDelete(selected.id)}
              onClose={() => setSelectedId(null)}
              convertLead={(body) => createLeadFromProperty(selected.id, body)}
            />
          ) : (
            <ProspectList properties={ranked} onSelect={handleSelect} />
          )}
        </div>
      </div>
    </div>
  );
}

function describeSweep(result: {
  createdCount: number;
  skipped: number;
  found: number;
  truncated: boolean;
}): string {
  if (result.found === 0) return "No mapped buildings here — try another block or zoom out a little.";
  const parts = [`${result.createdCount} new ${result.createdCount === 1 ? "roof" : "roofs"} pinned`];
  if (result.skipped > 0) parts.push(`${result.skipped} already known`);
  if (result.truncated) parts.push("area was busy enough to hit the limit — zoom in for the rest");
  return `${parts.join(" · ")}.`;
}

/** Roofs in view, richest first — the order to work the street in. */
function ProspectList({
  properties,
  onSelect,
}: {
  properties: PropertyDTO[];
  onSelect(property: PropertyDTO): void;
}) {
  if (properties.length === 0) {
    return (
      <div className="flex h-full flex-col justify-center gap-3 border-l border-neutral-800 bg-neutral-900 p-6 text-sm text-neutral-400">
        <p className="font-medium text-neutral-200">Nothing pinned here yet.</p>
        <p>
          Hit <span className="text-emerald-400">Sweep this view</span> to pin and price every
          building in the visible area, or tap a single roof to canvass just that one.
        </p>
        <ul className="space-y-1 pt-2">
          {LEGEND_TONES.map((tone) => (
            <li key={tone} className="flex items-center gap-2 text-xs">
              <span className={`h-3 w-3 rounded-full ${TONE_DOT[tone]}`} />
              {TONE_LABEL[tone]}
            </li>
          ))}
        </ul>
        <p className="pt-2 text-xs text-neutral-500">Drag to pan · scroll or pinch to zoom</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col border-l border-neutral-800 bg-neutral-900">
      <div className="border-b border-neutral-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-white">Best prospects in view</h2>
        <p className="text-xs text-neutral-500">
          {properties.length} {properties.length === 1 ? "roof" : "roofs"}, highest estimate first
        </p>
      </div>
      <ul className="flex-1 overflow-y-auto">
        {properties.map((property) => (
          <li key={property.id}>
            <button
              type="button"
              onClick={() => onSelect(property)}
              className="flex w-full items-center gap-3 border-b border-neutral-800/60 px-4 py-2 text-left hover:bg-neutral-800/60"
            >
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${TONE_DOT[propertyTone(property)]}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-neutral-100">{propertyTitle(property)}</span>
                <span className="block text-xs text-neutral-500">
                  {property.roofSquares ? `${property.roofSquares} squares` : "Not measured"}
                  {property.leadId ? " · in pipeline" : ""}
                </span>
              </span>
              <span className="shrink-0 text-xs text-emerald-300">{formatEstimate(property) ?? "—"}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Says plainly which lookups are live, so a blank owner field isn't a mystery. */
function ProviderBanner({ status }: { status: ProviderStatusResponse }) {
  const live = status.providers.filter((p) => p.configured);
  const missing = status.providers.filter((p) => !p.configured);

  if (status.offline) {
    return (
      <p className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
        Enrichment is in offline mode — roof sizes are placeholders derived from the coordinates, and
        no owner is looked up. Unset <code>PROPERTY_ENRICHMENT_OFFLINE</code> to use live open data.
      </p>
    );
  }

  return (
    <p className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
      Live lookups: {live.map((p) => p.id).join(", ") || "none"}.
      {missing.length > 0 && (
        <>
          {" "}
          Not configured: {missing.map((p) => p.id).join(", ")} — set <code>PARCEL_API_URL</code> to
          your county&apos;s parcel layer for owner names.
        </>
      )}
    </p>
  );
}
