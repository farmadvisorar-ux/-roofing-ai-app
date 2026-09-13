// Browser-side client for the /api/properties endpoints.
//
// Next serves the API and the UI from one origin, so these are plain relative
// paths — there is no base-URL env var to thread through (the Vite
// `import.meta.env.VITE_API_URL` pattern has no equivalent here, and
// NEXT_PUBLIC_* would only be needed to call a *different* origin).
import {
  LeadDTO,
  PropertyDTO,
  PropertyPage,
  ProviderStatusResponse,
  TerritoryResponse,
} from "@/lib/types";

export interface MapBbox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  // Error bodies are JSON too; surface the server's message rather than a bare status.
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export interface PropertyQueryOptions {
  bbox?: MapBbox;
  unworked?: boolean;
  band?: string;
  status?: string;
  minScore?: number;
  minEstimate?: number;
  search?: string;
  territory?: string;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  /** The map's "everything in view" spelling; bypasses page-size limits. */
  limit?: number;
}

export function propertyQueryParams(options: PropertyQueryOptions = {}): URLSearchParams {
  const params = new URLSearchParams();
  if (options.bbox) {
    params.set("minLat", String(options.bbox.minLat));
    params.set("minLng", String(options.bbox.minLng));
    params.set("maxLat", String(options.bbox.maxLat));
    params.set("maxLng", String(options.bbox.maxLng));
  }
  if (options.unworked) params.set("unworked", "1");
  if (options.band) params.set("band", options.band);
  if (options.status) params.set("status", options.status);
  if (options.minScore !== undefined) params.set("minScore", String(options.minScore));
  if (options.minEstimate !== undefined) params.set("minEstimate", String(options.minEstimate));
  if (options.search) params.set("q", options.search);
  if (options.territory) params.set("territory", options.territory);
  if (options.sort) params.set("sort", options.sort);
  if (options.dir) params.set("dir", options.dir);
  if (options.page) params.set("page", String(options.page));
  if (options.pageSize) params.set("pageSize", String(options.pageSize));
  if (options.limit) params.set("limit", String(options.limit));
  return params;
}

/** A page of properties, with the totals the workbench needs for its pager. */
export async function queryProperties(options: PropertyQueryOptions = {}): Promise<PropertyPage> {
  const query = propertyQueryParams(options).toString();
  return request<PropertyPage>(`/api/properties${query ? `?${query}` : ""}`);
}

export async function listProperties(options: PropertyQueryOptions = {}): Promise<PropertyDTO[]> {
  return (await queryProperties(options)).properties;
}

/** The CSV endpoint takes the same filters, so the download matches the screen. */
export function exportUrl(options: PropertyQueryOptions = {}): string {
  const query = propertyQueryParams({ ...options, page: undefined, pageSize: undefined }).toString();
  return `/api/properties/export${query ? `?${query}` : ""}`;
}

export interface BulkLeadResult {
  created: { propertyId: string; leadId: string }[];
  createdCount: number;
  skipped: { propertyId: string; reason: string }[];
}

export async function bulkConvertToLeads(
  propertyIds: string[],
  body: { stage?: string; notes?: string } = {},
): Promise<BulkLeadResult> {
  return request<BulkLeadResult>("/api/properties/bulk-lead", json({ propertyIds, ...body }));
}

export interface SweepResult {
  /** Newly pinned roofs, best estimate first. */
  created: PropertyDTO[];
  createdCount: number;
  /** Buildings already pinned from an earlier sweep or tap. */
  skipped: number;
  found: number;
  /** True when the area held more buildings than the limit allowed. */
  truncated: boolean;
  areaSqMi: number;
}

/** Pins every building in an area at once. */
export async function sweepArea(bbox: MapBbox, limit?: number): Promise<SweepResult> {
  return request<SweepResult>("/api/properties/sweep", json({ ...bbox, limit }));
}

export async function fetchProperty(id: string): Promise<PropertyDTO> {
  const { property } = await request<{ property: PropertyDTO }>(`/api/properties/${id}`);
  return property;
}

/** Drops a pin. `deduped` is true when an existing pin on the same roof came back instead. */
export async function createProperty(input: {
  lat: number;
  lng: number;
  notes?: string;
  enrich?: boolean;
}): Promise<{ property: PropertyDTO; deduped: boolean }> {
  const result = await request<{ property: PropertyDTO; deduped?: boolean }>(
    "/api/properties",
    json(input),
  );
  return { property: result.property, deduped: Boolean(result.deduped) };
}

export async function enrichProperty(id: string, options: { force?: boolean } = {}): Promise<PropertyDTO> {
  const query = options.force ? "?force=1" : "";
  const { property } = await request<{ property: PropertyDTO }>(
    `/api/properties/${id}/enrich${query}`,
    { method: "POST" },
  );
  return property;
}

export async function updateProperty(id: string, patch: Partial<PropertyDTO>): Promise<PropertyDTO> {
  const { property } = await request<{ property: PropertyDTO }>(`/api/properties/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return property;
}

export async function deleteProperty(id: string): Promise<void> {
  await request<{ ok: true }>(`/api/properties/${id}`, { method: "DELETE" });
}

export async function createLeadFromProperty(
  id: string,
  body: { name?: string; email?: string; phone?: string; notes?: string } = {},
): Promise<LeadDTO> {
  const { lead } = await request<{ lead: LeadDTO }>(`/api/properties/${id}/lead`, json(body));
  return lead;
}

/** The service footprint with live coverage per region. */
export async function fetchTerritories(): Promise<TerritoryResponse> {
  return request<TerritoryResponse>("/api/territories");
}

export async function fetchProviderStatus(): Promise<ProviderStatusResponse> {
  return request<ProviderStatusResponse>("/api/enrichment/providers");
}
