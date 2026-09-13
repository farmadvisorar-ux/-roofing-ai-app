"use client";

// The raw signals behind a score, and the trail of what changed them.
import { PropertyDTO, PropertyEventDTO } from "@/lib/types";
import { PropertyEventKind } from "@/generated/prisma/enums";

interface Row {
  label: string;
  value: string;
  /** Set when this signal argues for or against knocking. */
  tone?: "good" | "bad";
  source?: string;
}

/** Signals grouped by what a rep would ask about, with their provenance shown. */
export function SignalList({ property }: { property: PropertyDTO }) {
  const rows: Row[] = [];

  if (property.hailEventsNearby !== null) {
    rows.push({
      label: "Hail nearby",
      value:
        property.hailEventsNearby === 0
          ? `None in ${property.hailWindowYears ?? 5}y`
          : `${property.maxHailInches?.toFixed(2) ?? "?"}" max · ${property.hailEventsNearby} reports within ${property.hailSearchRadiusMi ?? 10} mi`,
      tone: (property.maxHailInches ?? 0) >= 1 ? "good" : undefined,
      source: "NOAA SPC",
    });
    if (property.lastHailDate) {
      rows.push({ label: "Last hail", value: formatDay(property.lastHailDate), source: "NOAA SPC" });
    }
  }

  if (property.severeStormDays !== null) {
    rows.push({
      label: "Wind exposure",
      value: `${property.severeStormDays} damaging days in ${property.stormWindowYears ?? 5}y${
        property.peakGustMph ? ` · peak ${Math.round(property.peakGustMph)} mph` : ""
      }`,
      source: "Open-Meteo",
    });
  }

  if (property.yearBuilt) {
    rows.push({ label: "Year built", value: String(property.yearBuilt), source: "OSM / assessor" });
  }
  if (property.assessedValue) {
    rows.push({
      label: "Assessed value",
      value: `$${Math.round(property.assessedValue).toLocaleString()}`,
      source: "Assessor",
    });
  }
  if (property.lastSaleDate) {
    rows.push({
      label: "Last sale",
      value:
        formatDay(property.lastSaleDate) +
        (property.lastSalePrice ? ` · $${Math.round(property.lastSalePrice).toLocaleString()}` : ""),
      tone: "good",
      source: "Assessor",
    });
  }
  if (property.roofPermitDate) {
    rows.push({
      label: "Roofing permit",
      value: `${formatDay(property.roofPermitDate)} — roof already done`,
      tone: "bad",
      source: "Permits",
    });
  } else if (property.lastPermitDate) {
    rows.push({
      label: "Last permit",
      value: `${formatDay(property.lastPermitDate)}${property.lastPermitType ? ` · ${property.lastPermitType}` : ""}`,
      source: "Permits",
    });
  }

  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">No signals gathered yet.</p>;
  }

  return (
    <ul className="space-y-1 text-sm">
      {rows.map((row) => (
        <li key={row.label} className="flex items-baseline justify-between gap-3 border-b border-neutral-800 py-1">
          <span className="shrink-0 text-neutral-500">{row.label}</span>
          <span className="flex items-baseline gap-2 text-right">
            <span
              className={
                row.tone === "good" ? "text-emerald-300" : row.tone === "bad" ? "text-amber-300" : "text-neutral-200"
              }
            >
              {row.value}
            </span>
            {row.source && <span className="shrink-0 text-[10px] text-neutral-600">{row.source}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

const EVENT_DOT: Record<PropertyEventKind, string> = {
  CREATED: "bg-neutral-500",
  SWEPT: "bg-neutral-500",
  ENRICHED: "bg-sky-400",
  SCORED: "bg-violet-400",
  MEASURED: "bg-amber-400",
  CONVERTED: "bg-emerald-400",
  UPDATED: "bg-neutral-400",
};

/** Append-only history, so a score is never an unexplained number. */
export function ActivityTimeline({ events }: { events: PropertyEventDTO[] | undefined }) {
  if (!events || events.length === 0) {
    return <p className="text-sm text-neutral-500">No activity recorded.</p>;
  }

  return (
    <ol className="space-y-2">
      {events.map((event) => (
        <li key={event.id} className="flex gap-2.5 text-xs">
          <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${EVENT_DOT[event.kind]}`} />
          <span className="min-w-0 flex-1">
            <span className="block text-neutral-300">{event.summary}</span>
            <span className="block text-[10px] text-neutral-600">
              {new Date(event.createdAt).toLocaleString()}
              {event.actor ? ` · ${event.actor}` : ""}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString();
}
