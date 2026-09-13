"use client";

// Shared score presentation: the badge that appears in the table, and the
// breakdown that explains it. Both the workbench and the map panel use these, so
// a score reads identically wherever it appears.
import { PropertyDTO } from "@/lib/types";
import { ScoreBand } from "@/generated/prisma/enums";
import { BAND_LABELS, parseScore } from "@/lib/signals";

export const BAND_STYLES: Record<ScoreBand, string> = {
  HOT: "border-rose-700 bg-rose-500/15 text-rose-300",
  WARM: "border-amber-700 bg-amber-500/15 text-amber-300",
  COOL: "border-sky-800 bg-sky-500/10 text-sky-300",
  COLD: "border-slate-700 bg-slate-500/10 text-slate-400",
  UNRATED: "border-dashed border-neutral-700 bg-neutral-800/40 text-neutral-500",
};

export const BAND_BAR: Record<ScoreBand, string> = {
  HOT: "bg-rose-400",
  WARM: "bg-amber-400",
  COOL: "bg-sky-400",
  COLD: "bg-slate-500",
  UNRATED: "bg-neutral-600",
};

export function ScoreBadge({ property, size = "sm" }: { property: PropertyDTO; size?: "sm" | "lg" }) {
  const band = property.leadScoreBand ?? "UNRATED";
  const score = property.leadScore;
  const padding = size === "lg" ? "px-3 py-1 text-base" : "px-2 py-0.5 text-xs";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium tabular-nums ${padding} ${BAND_STYLES[band]}`}
      title={
        property.scoreConfidence !== null
          ? `${BAND_LABELS[band]} · ${Math.round(property.scoreConfidence * 100)}% of signals available`
          : BAND_LABELS[band]
      }
    >
      {score ?? "—"}
      <span className="text-[10px] uppercase tracking-wide opacity-80">{BAND_LABELS[band]}</span>
    </span>
  );
}

/**
 * The whole point of the score: every point attributable to a named signal, and
 * missing signals shown as missing rather than silently counted as zero.
 */
export function ScoreBreakdown({ property }: { property: PropertyDTO }) {
  const breakdown = parseScore(property.scoreComponents);
  if (!breakdown) {
    return <p className="text-sm text-neutral-500">Not scored yet.</p>;
  }

  const confidence = property.scoreConfidence ?? 0;
  const band = property.leadScoreBand ?? "UNRATED";

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums text-white">{property.leadScore ?? "—"}</span>
        <ScoreBadge property={property} />
        <span className="ml-auto text-xs text-neutral-500">
          {Math.round(confidence * 100)}% of signals available
        </span>
      </div>

      {breakdown.suppressionReason && (
        <p className="rounded border border-amber-800 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">
          Suppressed to {Math.round(breakdown.suppression * 100)}% — {breakdown.suppressionReason}
        </p>
      )}

      {confidence < 0.25 && (
        <p className="rounded border border-neutral-700 bg-neutral-800/50 px-2 py-1.5 text-xs text-neutral-400">
          Too little is known to rate this roof. Run a lookup rather than reading the number as a
          verdict.
        </p>
      )}

      <ul className="space-y-2">
        {breakdown.components.map((component) => {
          const missing = component.strength === null;
          const pct = missing ? 0 : (component.points / component.weight) * 100;
          return (
            <li key={component.id}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className={missing ? "text-neutral-600" : "text-neutral-300"}>{component.label}</span>
                <span className={`tabular-nums ${missing ? "text-neutral-600" : "text-neutral-400"}`}>
                  {missing ? "no data" : `${component.points.toFixed(1)} / ${component.weight}`}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-800">
                <div
                  className={`h-full rounded-full ${missing ? "bg-neutral-700" : BAND_BAR[band]}`}
                  style={{ width: `${missing ? 100 : pct}%`, opacity: missing ? 0.25 : 1 }}
                />
              </div>
              <p className={`mt-0.5 text-[11px] ${missing ? "text-neutral-600" : "text-neutral-500"}`}>
                {component.detail}
              </p>
            </li>
          );
        })}
      </ul>

      {breakdown.baseScore !== undefined && breakdown.baseScore !== property.leadScore && (
        <p className="text-[11px] text-neutral-500">
          {breakdown.baseScore} on the signals we have, adjusted to {property.leadScore} for
          coverage{breakdown.suppression < 1 ? " and suppression" : ""}.
        </p>
      )}
    </div>
  );
}
