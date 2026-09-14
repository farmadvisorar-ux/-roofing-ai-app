// Shared status vocabulary for the canvassing map, so the pin and the panel
// always agree about what a property's state is called and coloured.
import { PropertyDTO } from "@/lib/types";

export type Tone = "lead" | "enriched" | "partial" | "failed" | "pending";

export function propertyTone(property: PropertyDTO): Tone {
  // Being in the pipeline outranks how complete the data is.
  if (property.leadId) return "lead";
  switch (property.enrichmentStatus) {
    case "ENRICHED":
      return "enriched";
    case "PARTIAL":
      return "partial";
    case "FAILED":
      return "failed";
    default:
      return "pending";
  }
}

export const TONE_LABEL: Record<Tone, string> = {
  lead: "In pipeline",
  enriched: "Enriched",
  partial: "Partial data",
  failed: "Lookup failed",
  pending: "Not looked up",
};

export const TONE_DOT: Record<Tone, string> = {
  lead: "bg-sky-400",
  enriched: "bg-emerald-400",
  partial: "bg-amber-400",
  failed: "bg-red-400",
  pending: "bg-neutral-300",
};

export const TONE_BADGE: Record<Tone, string> = {
  lead: "border-sky-700 bg-sky-500/10 text-sky-300",
  enriched: "border-emerald-700 bg-emerald-500/10 text-emerald-300",
  partial: "border-amber-700 bg-amber-500/10 text-amber-300",
  failed: "border-red-800 bg-red-500/10 text-red-300",
  pending: "border-neutral-700 bg-neutral-800/60 text-neutral-300",
};

/** Best human label for a pin: street address, else owner of record, else coordinates. */
export function propertyTitle(property: PropertyDTO): string {
  return (
    property.address ??
    property.ownerName ??
    `${property.lat.toFixed(5)}, ${property.lng.toFixed(5)}`
  );
}

export function formatEstimate(property: PropertyDTO): string | null {
  if (property.estimateLow === null || property.estimateHigh === null) return null;
  return `$${property.estimateLow.toLocaleString()} – $${property.estimateHigh.toLocaleString()}`;
}
