"use client";

// The prospects workbench: the screen a sales manager works from, as opposed to
// the map a rep works from. Dense, filterable, sortable, selectable, exportable.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PropertyDTO, PropertyPage, TerritoryResponse } from "@/lib/types";
import { EnrichmentStatus, ScoreBand } from "@/generated/prisma/enums";
import { BAND_LABELS, parseScore } from "@/lib/signals";
import {
  PropertyQueryOptions,
  bulkConvertToLeads,
  exportUrl,
  fetchProperty,
  fetchTerritories,
  queryProperties,
} from "@/lib/propertiesApi";
import { ScoreBadge } from "./score";
import ProspectDrawer from "./ProspectDrawer";
import TerritoryBar from "./TerritoryBar";

const PAGE_SIZE = 25;

const EMPTY_PAGE: PropertyPage = { properties: [], total: 0, page: 1, pageSize: PAGE_SIZE, pageCount: 1 };

const SORTABLE = [
  { field: "leadScore", label: "Score", align: "right" },
  { field: "address", label: "Address", align: "left" },
  { field: "roofSquares", label: "Squares", align: "right" },
  { field: "estimateHigh", label: "Estimate", align: "right" },
  { field: "yearBuilt", label: "Built", align: "right" },
  { field: "createdAt", label: "Added", align: "right" },
] as const;

type SortField = (typeof SORTABLE)[number]["field"];

const BANDS: ScoreBand[] = ["HOT", "WARM", "COOL", "COLD", "UNRATED"];
const STATUSES: EnrichmentStatus[] = ["ENRICHED", "PARTIAL", "PENDING", "FAILED"];

export default function ProspectsWorkbench() {
  const [search, setSearch] = useState("");
  const [band, setBand] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [worked, setWorked] = useState<"" | "unworked" | "worked">("");
  const [minScore, setMinScore] = useState("");
  const [territory, setTerritory] = useState("");
  const [sort, setSort] = useState<SortField>("leadScore");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  // `loaded` carries the key it was fetched for, so "is this stale?" is derived
  // rather than tracked in a second state field that has to be kept in step.
  const [loaded, setLoaded] = useState<{ key: string; page: PropertyPage } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [coverage, setCoverage] = useState<TerritoryResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  // Keyed by the id it was fetched for, so the drawer shows a loading state
  // rather than the previous row's data while the next one arrives.
  const [openDetail, setOpenDetail] = useState<{ id: string; property: PropertyDTO } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Debounce the search box so typing doesn't fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const filters: PropertyQueryOptions = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      band: band || undefined,
      status: status || undefined,
      unworked: worked === "unworked" ? true : undefined,
      minScore: minScore ? Number(minScore) : undefined,
      territory: territory || undefined,
      sort,
      dir,
    }),
    [debouncedSearch, band, status, worked, minScore, territory, sort, dir],
  );

  const requestKey = `${JSON.stringify(filters)}|${page}|${reloadNonce}`;
  const data = loaded?.page ?? null;
  const loading = loaded?.key !== requestKey;

  useEffect(() => {
    let cancelled = false;
    queryProperties({ ...filters, page, pageSize: PAGE_SIZE }).then(
      (result) => {
        if (cancelled) return;
        setLoaded({ key: requestKey, page: result });
        setError(null);
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load prospects");
        // Mark the attempt finished so the table stops claiming to be loading.
        setLoaded((prev) => (prev ? { ...prev, key: requestKey } : { key: requestKey, page: EMPTY_PAGE }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [requestKey, filters, page]);

  // Coverage counts move whenever rows are converted, so refresh with the table.
  useEffect(() => {
    let cancelled = false;
    fetchTerritories().then(
      (result) => {
        if (!cancelled) setCoverage(result);
      },
      () => {
        // Coverage is a summary; the table stands on its own without it.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [reloadNonce]);

  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  /** Any filter change invalidates the page and the selection, so they move together. */
  function changeFilter(apply: () => void) {
    apply();
    setPage(1);
    setSelected(new Set());
  }

  const openProperty = openDetail?.id === openId ? openDetail.property : null;

  useEffect(() => {
    if (!openId) return;
    let cancelled = false;
    fetchProperty(openId).then(
      (property) => {
        if (!cancelled) setOpenDetail({ id: openId, property });
      },
      () => {
        // Leave the drawer in its loading state; the row is still selectable.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [openId]);

  const rows = data?.properties ?? [];
  // "Worked" is a client-side view of the same rows; the API filters unworked.
  const visible = worked === "worked" ? rows.filter((r) => r.leadId) : rows;
  const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));
  const someSelected = visible.some((r) => selected.has(r.id));

  const headerCheckbox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  function toggleSort(field: SortField) {
    if (sort === field) {
      setDir(dir === "desc" ? "asc" : "desc");
    } else {
      setSort(field);
      setDir(field === "address" ? "asc" : "desc");
    }
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(visible.map((r) => r.id)));
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const convertible = visible.filter((r) => selected.has(r.id) && !r.leadId);

  async function handleBulkConvert() {
    if (convertible.length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await bulkConvertToLeads(convertible.map((r) => r.id));
      setNotice(
        `Created ${result.createdCount} lead${result.createdCount === 1 ? "" : "s"}` +
          (result.skipped.length > 0 ? ` · ${result.skipped.length} skipped` : ""),
      );
      setSelected(new Set());
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk conversion failed");
    } finally {
      setBusy(false);
    }
  }

  const total = data?.total ?? 0;
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="space-y-3">
      {coverage && (
        <TerritoryBar
          territories={coverage.territories}
          outsideFootprint={coverage.outsideFootprint}
          selected={territory}
          onSelect={(id) => changeFilter(() => setTerritory(id))}
        />
      )}

      <FilterBar
        search={search}
        onSearch={(v) => changeFilter(() => setSearch(v))}
        band={band}
        onBand={(v) => changeFilter(() => setBand(v))}
        status={status}
        onStatus={(v) => changeFilter(() => setStatus(v))}
        worked={worked}
        onWorked={(v) => changeFilter(() => setWorked(v))}
        minScore={minScore}
        onMinScore={(v) => changeFilter(() => setMinScore(v))}
        exportHref={exportUrl(filters)}
        onClear={() =>
          changeFilter(() => {
            setSearch("");
            setBand("");
            setStatus("");
            setWorked("");
            setMinScore("");
            setTerritory("");
          })
        }
      />

      {error && (
        <p role="alert" className="rounded-md border border-red-900 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-md border border-emerald-800 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          {notice}
        </p>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2">
          <span className="text-sm text-neutral-300">
            {selected.size} selected
            {convertible.length !== selected.size && (
              <span className="text-neutral-500"> · {selected.size - convertible.length} already leads</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => void handleBulkConvert()}
            disabled={busy || convertible.length === 0}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {busy ? "Converting…" : `Convert ${convertible.length} to leads`}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-sm text-neutral-400 hover:text-neutral-200"
          >
            Clear selection
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-neutral-800">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead className="sticky top-0 bg-neutral-900 text-left">
              <tr className="border-b border-neutral-800">
                <th scope="col" className="w-10 px-3 py-2">
                  <input
                    ref={headerCheckbox}
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all rows on this page"
                    className="accent-emerald-500"
                  />
                </th>
                {SORTABLE.map((column) => (
                  <th
                    key={column.field}
                    scope="col"
                    aria-sort={sort === column.field ? (dir === "asc" ? "ascending" : "descending") : "none"}
                    className={`px-3 py-2 font-medium text-neutral-400 ${column.align === "right" ? "text-right" : "text-left"}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(column.field)}
                      className="inline-flex items-center gap-1 hover:text-neutral-100"
                    >
                      {column.label}
                      <span className="text-[10px] opacity-70">
                        {sort === column.field ? (dir === "asc" ? "▲" : "▼") : ""}
                      </span>
                    </button>
                  </th>
                ))}
                <th scope="col" className="px-3 py-2 font-medium text-neutral-400">
                  Signals
                </th>
                <th scope="col" className="px-3 py-2 font-medium text-neutral-400">
                  Stage
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-neutral-500">
                    Loading prospects…
                  </td>
                </tr>
              )}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-neutral-500">
                    No prospects match these filters.
                  </td>
                </tr>
              )}
              {visible.map((property) => (
                <tr
                  key={property.id}
                  onClick={() => setOpenId(property.id)}
                  className={`cursor-pointer border-b border-neutral-800/70 hover:bg-neutral-800/40 ${
                    openId === property.id ? "bg-neutral-800/60" : ""
                  }`}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(property.id)}
                      onChange={() => toggleRow(property.id)}
                      aria-label={`Select ${property.address ?? property.id}`}
                      className="accent-emerald-500"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <ScoreBadge property={property} />
                  </td>
                  <td className="max-w-[240px] truncate px-3 py-2 text-neutral-100">
                    {property.address ?? (
                      <span className="text-neutral-500">
                        {property.lat.toFixed(4)}, {property.lng.toFixed(4)}
                      </span>
                    )}
                    {property.ownerName && (
                      <span className="block truncate text-xs text-neutral-500">{property.ownerName}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-300">
                    {property.roofSquares?.toFixed(1) ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-300">
                    {property.estimateHigh ? `$${Math.round(property.estimateHigh).toLocaleString()}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{property.yearBuilt ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-500">
                    {new Date(property.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2">
                    <SignalChips property={property} />
                  </td>
                  <td className="px-3 py-2">
                    {property.leadId ? (
                      <Link
                        href={`/crm/leads/${property.leadId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-sky-400 hover:underline"
                      >
                        In pipeline
                      </Link>
                    ) : (
                      <span className="text-xs text-neutral-600">Not worked</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
          <span className="tabular-nums">
            {first}–{last} of {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="rounded border border-neutral-700 px-2 py-1 hover:bg-neutral-800 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="tabular-nums">
              Page {page} of {data?.pageCount ?? 1}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(data?.pageCount ?? 1, p + 1))}
              disabled={page >= (data?.pageCount ?? 1) || loading}
              className="rounded border border-neutral-700 px-2 py-1 hover:bg-neutral-800 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {openId && (
        <ProspectDrawer
          property={openProperty}
          onClose={() => setOpenId(null)}
          onChanged={(updated) => {
            setOpenDetail({ id: updated.id, property: updated });
            reload();
          }}
        />
      )}
    </div>
  );
}

/** At-a-glance markers so the table itself says why a score is what it is. */
function SignalChips({ property }: { property: PropertyDTO }) {
  const chips: { label: string; className: string; title: string }[] = [];

  if ((property.maxHailInches ?? 0) >= 1) {
    chips.push({
      label: `${property.maxHailInches?.toFixed(1)}" hail`,
      className: "border-rose-800 bg-rose-500/10 text-rose-300",
      title: `${property.hailEventsNearby} hail reports within ${property.hailSearchRadiusMi ?? 10} mi`,
    });
  }
  if (property.roofPermitDate) {
    chips.push({
      label: "re-roofed",
      className: "border-amber-800 bg-amber-500/10 text-amber-300",
      title: `Roofing permit ${new Date(property.roofPermitDate).toLocaleDateString()}`,
    });
  }
  // Recency is read off the stored breakdown rather than recomputed from the
  // clock: rendering must be pure, and this way the chip cannot disagree with
  // the score that produced it.
  const recentSale = parseScore(property.scoreComponents)?.components.find((c) => c.id === "recentSale");
  if (property.lastSaleDate && (recentSale?.strength ?? 0) > 0) {
    chips.push({
      label: "new owner",
      className: "border-emerald-800 bg-emerald-500/10 text-emerald-300",
      title: recentSale?.detail ?? `Sold ${new Date(property.lastSaleDate).toLocaleDateString()}`,
    });
  }
  if ((property.scoreConfidence ?? 0) < 0.25) {
    chips.push({
      label: "thin data",
      className: "border-neutral-700 bg-neutral-800/60 text-neutral-400",
      title: "Too few signals to rate — run a lookup",
    });
  }

  if (chips.length === 0) return <span className="text-xs text-neutral-600">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {chips.map((chip) => (
        <span
          key={chip.label}
          title={chip.title}
          className={`rounded border px-1.5 py-0.5 text-[10px] whitespace-nowrap ${chip.className}`}
        >
          {chip.label}
        </span>
      ))}
    </span>
  );
}

interface FilterBarProps {
  search: string;
  onSearch(v: string): void;
  band: string;
  onBand(v: string): void;
  status: string;
  onStatus(v: string): void;
  worked: "" | "unworked" | "worked";
  onWorked(v: "" | "unworked" | "worked"): void;
  minScore: string;
  onMinScore(v: string): void;
  exportHref: string;
  onClear(): void;
}

function FilterBar(props: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={props.search}
        onChange={(e) => props.onSearch(e.target.value)}
        placeholder="Search address, city or owner"
        aria-label="Search prospects"
        className="input min-w-[220px] flex-1"
      />
      <select value={props.band} onChange={(e) => props.onBand(e.target.value)} aria-label="Score band" className="input">
        <option value="">Any band</option>
        {BANDS.map((b) => (
          <option key={b} value={b}>
            {BAND_LABELS[b]}
          </option>
        ))}
      </select>
      <select
        value={props.status}
        onChange={(e) => props.onStatus(e.target.value)}
        aria-label="Enrichment status"
        className="input"
      >
        <option value="">Any data state</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </option>
        ))}
      </select>
      <select
        value={props.worked}
        onChange={(e) => props.onWorked(e.target.value as "" | "unworked" | "worked")}
        aria-label="Pipeline state"
        className="input"
      >
        <option value="">All</option>
        <option value="unworked">Not yet worked</option>
        <option value="worked">Already leads</option>
      </select>
      <input
        type="number"
        min={0}
        max={100}
        value={props.minScore}
        onChange={(e) => props.onMinScore(e.target.value)}
        placeholder="Min score"
        aria-label="Minimum score"
        className="input w-28"
      />
      <button type="button" onClick={props.onClear} className="text-sm text-neutral-400 hover:text-neutral-200">
        Clear
      </button>
      <a
        href={props.exportHref}
        className="rounded-md border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
      >
        Export CSV
      </a>
    </div>
  );
}
