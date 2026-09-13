"use client";

// Coverage across the service footprint. The row a manager reads to decide where
// to send a crew: how many roofs we hold in each region, how many are still
// unworked, and whether the region has had hail worth chasing.
import { TerritorySummary } from "@/lib/types";

interface TerritoryBarProps {
  territories: TerritorySummary[];
  outsideFootprint: number;
  /** Currently filtered territory id, "none", or "" for the whole footprint. */
  selected: string;
  onSelect(id: string): void;
}

export default function TerritoryBar({
  territories,
  outsideFootprint,
  selected,
  onSelect,
}: TerritoryBarProps) {
  const totals = territories.reduce(
    (acc, t) => ({
      properties: acc.properties + t.properties,
      unworked: acc.unworked + t.unworked,
      priority: acc.priority + t.priority,
    }),
    { properties: 0, unworked: 0, priority: 0 },
  );

  return (
    <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Service territories">
      <Card
        label="All territories"
        sub={`${territories.length} regions`}
        active={selected === ""}
        onClick={() => onSelect("")}
        stats={[
          { label: "roofs", value: totals.properties.toLocaleString() },
          { label: "unworked", value: totals.unworked.toLocaleString() },
          { label: "hot/warm", value: totals.priority.toLocaleString() },
        ]}
      />

      {territories.map((territory) => (
        <Card
          key={territory.id}
          label={territory.name}
          sub={territory.states.join("/")}
          active={selected === territory.id}
          onClick={() => onSelect(territory.id)}
          stats={[
            { label: "roofs", value: territory.properties.toLocaleString() },
            { label: "unworked", value: territory.unworked.toLocaleString() },
            {
              label: "avg score",
              value: territory.averageScore === null ? "—" : String(territory.averageScore),
            },
          ]}
          footer={<HailFooter territory={territory} />}
        />
      ))}

      {outsideFootprint > 0 && (
        <Card
          label="Outside footprint"
          sub="unassigned"
          active={selected === "none"}
          onClick={() => onSelect("none")}
          stats={[{ label: "roofs", value: outsideFootprint.toLocaleString() }]}
        />
      )}
    </div>
  );
}

/**
 * Hail is only worth chasing while it is fresh, so the card leads with recent
 * activity — and when there is none it says when the data actually ends rather
 * than showing a bare zero, which would read as "no hail here".
 */
function HailFooter({ territory }: { territory: TerritorySummary }) {
  if (territory.hailEvents === 0) {
    return <span className="text-neutral-600">No hail imported — run import:storms</span>;
  }

  if (territory.recentHailEvents > 0) {
    return (
      <span className="text-rose-300">
        {territory.recentHailEvents.toLocaleString()} hail reports in {territory.recentHailYears}y
        {territory.largestHailInches ? ` · up to ${territory.largestHailInches}"` : ""}
      </span>
    );
  }

  const latest = territory.latestHailDate ? new Date(territory.latestHailDate).toLocaleDateString() : null;
  return (
    <span className="text-neutral-500">
      {territory.hailEvents.toLocaleString()} hail reports
      {territory.largestHailInches ? `, up to ${territory.largestHailInches}"` : ""}
      {latest ? ` · latest ${latest}` : ""}
    </span>
  );
}

interface CardProps {
  label: string;
  sub: string;
  active: boolean;
  onClick(): void;
  stats: { label: string; value: string }[];
  footer?: React.ReactNode;
}

function Card({ label, sub, active, onClick, stats, footer }: CardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-w-[190px] shrink-0 rounded-lg border px-3 py-2 text-left transition-colors ${
        active
          ? "border-emerald-600 bg-emerald-500/10"
          : "border-neutral-800 bg-neutral-900 hover:border-neutral-700"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-neutral-100">{label}</span>
        <span className="text-[10px] uppercase tracking-wide text-neutral-500">{sub}</span>
      </div>
      <div className="mt-1.5 flex gap-3">
        {stats.map((stat) => (
          <span key={stat.label} className="text-xs">
            <span className="block tabular-nums text-neutral-200">{stat.value}</span>
            <span className="block text-[10px] text-neutral-500">{stat.label}</span>
          </span>
        ))}
      </div>
      {footer && <div className="mt-1.5 text-[10px]">{footer}</div>}
    </button>
  );
}
