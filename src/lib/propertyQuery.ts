// Shared query shaping for the properties endpoints.
//
// The list, the CSV export and the bulk actions must agree exactly on what "the
// current filter" means — otherwise "export" or "convert all" quietly operates on
// a different set than the one on screen, which is the sort of bug nobody
// notices until it has created three hundred wrong leads.
import { EnrichmentStatus, ScoreBand } from "@/generated/prisma/enums";
import { GeoBounds, isValidBounds } from "@/lib/geo";
import { isTerritoryId, TERRITORY_IDS } from "@/lib/territories";
import type { Prisma } from "@/generated/prisma/client";

export const SORT_FIELDS = [
  "leadScore",
  "estimateHigh",
  "roofSquares",
  "yearBuilt",
  "createdAt",
  "address",
] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export const MAX_PAGE_SIZE = 500;
export const DEFAULT_PAGE_SIZE = 50;
/** The map wants everything in view at once, not a page of it. */
export const MAX_MAP_LIMIT = 1000;

export interface PropertyFilters {
  bounds: GeoBounds | null;
  status: EnrichmentStatus | null;
  band: ScoreBand | null;
  minScore: number | null;
  minEstimate: number | null;
  /** true = not yet a lead, false = already a lead, null = either. */
  unworked: boolean | null;
  /** Free text over address, city and owner. */
  search: string | null;
  /** A territory id, or "none" for roofs outside the footprint. */
  territory: string | null;
}

export interface PropertyQuery extends PropertyFilters {
  sort: SortField;
  direction: "asc" | "desc";
  page: number;
  pageSize: number;
}

export class QueryError extends Error {}

export function parsePropertyQuery(params: URLSearchParams): PropertyQuery {
  return {
    ...parseFilters(params),
    ...parseSort(params),
    ...parsePaging(params),
  };
}

export function parseFilters(params: URLSearchParams): PropertyFilters {
  const status = params.get("status");
  if (status && !Object.values(EnrichmentStatus).includes(status as EnrichmentStatus)) {
    throw new QueryError("Invalid status");
  }

  const band = params.get("band");
  if (band && !Object.values(ScoreBand).includes(band as ScoreBand)) {
    throw new QueryError("Invalid band");
  }

  const territory = params.get("territory");
  if (territory && territory !== "none" && !isTerritoryId(territory)) {
    throw new QueryError(`Unknown territory. Use one of: ${TERRITORY_IDS.join(", ")}, none`);
  }

  const unworkedRaw = params.get("unworked");
  const search = params.get("q")?.trim();

  return {
    bounds: parseBounds(params),
    status: (status as EnrichmentStatus) ?? null,
    band: (band as ScoreBand) ?? null,
    minScore: parseNumber(params.get("minScore"), "minScore"),
    minEstimate: parseNumber(params.get("minEstimate"), "minEstimate"),
    unworked: unworkedRaw === null ? null : unworkedRaw === "1" || unworkedRaw === "true",
    search: search ? search : null,
    territory: territory ?? null,
  };
}

function parseSort(params: URLSearchParams): Pick<PropertyQuery, "sort" | "direction"> {
  const sort = params.get("sort") ?? "leadScore";
  if (!SORT_FIELDS.includes(sort as SortField)) {
    throw new QueryError(`Invalid sort field. Use one of: ${SORT_FIELDS.join(", ")}`);
  }
  const direction = params.get("dir") ?? "desc";
  if (direction !== "asc" && direction !== "desc") {
    throw new QueryError("dir must be asc or desc");
  }
  return { sort: sort as SortField, direction };
}

function parsePaging(params: URLSearchParams): Pick<PropertyQuery, "page" | "pageSize"> {
  const page = Math.max(1, Math.floor(parseNumber(params.get("page"), "page") ?? 1));
  // `limit` is the map's older spelling for "give me this many".
  const raw = parseNumber(params.get("pageSize") ?? params.get("limit"), "pageSize");
  const cap = params.get("limit") !== null ? MAX_MAP_LIMIT : MAX_PAGE_SIZE;
  const pageSize = Math.min(Math.max(1, Math.floor(raw ?? DEFAULT_PAGE_SIZE)), cap);
  return { page, pageSize };
}

function parseBounds(params: URLSearchParams): GeoBounds | null {
  const keys = ["minLat", "minLng", "maxLat", "maxLng"] as const;
  const present = keys.filter((k) => params.get(k) !== null);
  if (present.length === 0) return null;
  if (present.length !== keys.length) {
    throw new QueryError("bbox requires numeric minLat, minLng, maxLat, maxLng");
  }
  const [minLat, minLng, maxLat, maxLng] = keys.map((k) => Number(params.get(k)));
  const bounds = { minLat, minLng, maxLat, maxLng };
  if (!isValidBounds(bounds)) {
    throw new QueryError("bbox requires numeric minLat, minLng, maxLat, maxLng");
  }
  return bounds;
}

function parseNumber(raw: string | null, label: string): number | null {
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new QueryError(`${label} must be a number`);
  return n;
}

export function buildWhere(filters: PropertyFilters): Prisma.PropertyWhereInput {
  const where: Prisma.PropertyWhereInput = {};

  if (filters.bounds) {
    where.lat = { gte: filters.bounds.minLat, lte: filters.bounds.maxLat };
    where.lng = { gte: filters.bounds.minLng, lte: filters.bounds.maxLng };
  }
  if (filters.status) where.enrichmentStatus = filters.status;
  if (filters.band) where.leadScoreBand = filters.band;
  if (filters.minScore !== null) where.leadScore = { gte: filters.minScore };
  if (filters.minEstimate !== null) where.estimateHigh = { gte: filters.minEstimate };
  if (filters.unworked === true) where.leadId = null;
  if (filters.unworked === false) where.leadId = { not: null };
  if (filters.territory === "none") where.territory = null;
  else if (filters.territory) where.territory = filters.territory;

  if (filters.search) {
    // SQLite's LIKE is case-insensitive for ASCII, which is what addresses are.
    where.OR = [
      { address: { contains: filters.search } },
      { city: { contains: filters.search } },
      { ownerName: { contains: filters.search } },
    ];
  }

  return where;
}

export function buildOrderBy(query: Pick<PropertyQuery, "sort" | "direction">): Prisma.PropertyOrderByWithRelationInput[] {
  // Unscored rows belong at the bottom either way, never interleaved.
  const primary = { [query.sort]: { sort: query.direction, nulls: "last" } } as Prisma.PropertyOrderByWithRelationInput;
  return [primary, { createdAt: "desc" }];
}
