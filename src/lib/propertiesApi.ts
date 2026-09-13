// Browser-side client for the /api/properties endpoints.
//
// Next serves the API and the UI from one origin, so these are plain relative
// paths — there is no base-URL env var to thread through (the Vite
// `import.meta.env.VITE_API_URL` pattern has no equivalent here, and
// NEXT_PUBLIC_* would only be needed to call a *different* origin).
import { LeadDTO, PropertyDTO, ProviderStatusResponse } from "@/lib/types";

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

export async function listProperties(
  options: { bbox?: MapBbox; unworked?: boolean; limit?: number } = {},
): Promise<PropertyDTO[]> {
  const params = new URLSearchParams();
  if (options.bbox) {
    params.set("minLat", String(options.bbox.minLat));
    params.set("minLng", String(options.bbox.minLng));
    params.set("maxLat", String(options.bbox.maxLat));
    params.set("maxLng", String(options.bbox.maxLng));
  }
  if (options.unworked) params.set("unworked", "1");
  if (options.limit) params.set("limit", String(options.limit));

  const query = params.toString();
  const { properties } = await request<{ properties: PropertyDTO[] }>(
    `/api/properties${query ? `?${query}` : ""}`,
  );
  return properties;
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

export async function fetchProviderStatus(): Promise<ProviderStatusResponse> {
  return request<ProviderStatusResponse>("/api/enrichment/providers");
}
