"use client";

// A pin on the canvassing map. Purely presentational: the container owns the
// fetch/enrich logic so one selection can't trigger the same lookup from two
// places, and the detail panel reads the same record the pin does.
import { PropertyDTO } from "@/lib/types";
import { TONE_DOT, TONE_LABEL, formatEstimate, propertyTitle, propertyTone } from "./propertyTone";

interface PropertyMarkerProps {
  property: PropertyDTO;
  /** Container-pixel position from the map's projection. */
  x: number;
  y: number;
  selected: boolean;
  busy: boolean;
  onSelect(property: PropertyDTO): void;
}

export default function PropertyMarker({ property, x, y, selected, busy, onSelect }: PropertyMarkerProps) {
  const tone = propertyTone(property);
  const estimate = formatEstimate(property);
  const title = [propertyTitle(property), TONE_LABEL[tone], estimate].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={selected}
      // Stop the map from reading this as the start of a pan or a place-pin tap.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(property);
      }}
      // A 28px box gives a finger-sized target around a 12px dot.
      className="absolute grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full"
      style={{ left: x, top: y }}
    >
      <span
        className={[
          "block rounded-full border border-neutral-950/60 transition-all",
          TONE_DOT[tone],
          selected ? "h-4 w-4 ring-2 ring-white" : "h-3 w-3",
          busy ? "animate-pulse" : "",
        ].join(" ")}
      />
    </button>
  );
}
