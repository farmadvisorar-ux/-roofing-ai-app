// The enrichment pipeline: take a pin on the canvassing map and turn it into a
// roof we can quote — address, owner, footprint, and a priced estimate.
//
// Providers live in src/lib/openData.ts; the roof math lives in src/lib/roofing.ts.
// This module is the only part that touches the database.
import { prisma } from "@/lib/prisma";
import { ALL_PROVIDERS, GeoPoint, OpenDataProvider, PropertyFacts } from "@/lib/openData";
import { estimateMidpoint, estimateRoof } from "@/lib/roofing";
import { EnrichmentStatus } from "@/generated/prisma/enums";
import type { PropertyModel } from "@/generated/prisma/models";
import type { ProviderStatus, ProviderStatusResponse } from "@/lib/types";

export interface EnrichPropertyArgs {
  propertyId: string;
  /** Re-run providers even if the property was already enriched. */
  force?: boolean;
}

export class PropertyNotFoundError extends Error {
  constructor(propertyId: string) {
    super(`Property ${propertyId} not found`);
    this.name = "PropertyNotFoundError";
  }
}

/** Set PROPERTY_ENRICHMENT_OFFLINE=1 to skip the network and use derived placeholders. */
function offlineMode(): boolean {
  const flag = process.env.PROPERTY_ENRICHMENT_OFFLINE;
  return flag === "1" || flag === "true";
}

/**
 * Enriches one property in place and returns the updated row.
 *
 * Providers run in order of authority (parcel, then building, then geocoder) and
 * a provider's value wins only when it actually has one — a provider that returns
 * nothing never blanks a field we already had.
 */
export async function enrichProperty({ propertyId, force = false }: EnrichPropertyArgs): Promise<PropertyModel> {
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) throw new PropertyNotFoundError(propertyId);

  if (!force && property.enrichmentStatus === EnrichmentStatus.ENRICHED) {
    return property;
  }

  const point: GeoPoint = { lat: property.lat, lng: property.lng };
  const providers = offlineMode() ? [] : ALL_PROVIDERS.filter((p) => p.configured);

  const facts: PropertyFacts = {};
  const contributed: string[] = [];
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      const result = await provider.lookup(point);
      if (result && mergeFacts(facts, result)) contributed.push(provider.id);
    } catch (err) {
      // One provider being down must not sink the whole lookup.
      errors.push(`${provider.id}: ${errorMessage(err)}`);
    }
  }

  // No network, or nothing usable came back — fall back to derived geometry so the
  // pipeline still yields a workable estimate. Deliberately never invents an owner.
  const realSources = [...contributed];
  if (realSources.length === 0) {
    // Seed with what the property already holds first, so a placeholder can only
    // fill a genuine gap: a rep's hand measurement must outrank a derived guess.
    mergeFacts(facts, existingFacts(property));
    mergeFacts(facts, derivedFallbackFacts(point));
    contributed.push("derived");
  }

  const estimate = estimateRoof({
    footprintSqFt: facts.footprintSqFt ?? property.footprintSqFt,
    roofShape: facts.roofShape ?? property.roofShape,
    roofMaterial: facts.roofMaterial ?? property.roofMaterial,
    buildingLevels: facts.buildingLevels ?? property.buildingLevels,
  });

  // Only a real source can mark a property ENRICHED. Derived placeholders keep it
  // PARTIAL however complete the record looks, so nobody quotes off a guess.
  const haveAddress = Boolean(facts.address ?? property.address);
  const haveFootprint = Boolean(facts.footprintSqFt ?? property.footprintSqFt);
  let status: EnrichmentStatus = EnrichmentStatus.PARTIAL;
  if (realSources.length > 0 && haveAddress && haveFootprint) {
    status = EnrichmentStatus.ENRICHED;
  } else if (realSources.length === 0 && errors.length > 0) {
    status = EnrichmentStatus.FAILED;
  }

  const osmRef = await osmRefIfFree(facts.osmRef, propertyId);

  const updated = await prisma.property.update({
    where: { id: propertyId },
    data: {
      // `?? undefined` leaves the column untouched rather than nulling it.
      address: facts.address ?? undefined,
      city: facts.city ?? undefined,
      state: facts.state ?? undefined,
      zip: facts.zip ?? undefined,
      ownerName: facts.ownerName ?? undefined,
      parcelId: facts.parcelId ?? undefined,
      osmRef: osmRef ?? undefined,
      footprintSqFt: facts.footprintSqFt ?? undefined,
      buildingLevels: facts.buildingLevels ?? undefined,
      roofShape: facts.roofShape ?? undefined,
      roofMaterial: facts.roofMaterial ?? undefined,
      yearBuilt: facts.yearBuilt ?? undefined,
      roofSqFt: estimate.roofSqFt,
      roofSquares: estimate.roofSquares,
      estimateLow: estimate.estimateLow,
      estimateHigh: estimate.estimateHigh,
      enrichmentStatus: status,
      enrichmentSources: contributed.join(","),
      enrichmentError: errors.length > 0 ? errors.join("; ") : null,
      enrichedAt: new Date(),
    },
  });

  // Keep a linked lead's pipeline value in step with the refreshed estimate.
  if (updated.leadId) {
    await prisma.lead.update({
      where: { id: updated.leadId },
      data: { estimatedValue: estimateMidpoint(estimate) },
    });
  }

  return updated;
}

/** Copies set fields onto the accumulator without overwriting earlier providers. Returns true if anything landed. */
function mergeFacts(into: PropertyFacts, from: PropertyFacts): boolean {
  let changed = false;
  for (const [key, value] of Object.entries(from) as [keyof PropertyFacts, unknown][]) {
    if (value === null || value === undefined || value === "") continue;
    if (into[key] !== null && into[key] !== undefined) continue;
    // Each PropertyFacts field is string | number | null, and `value` came from one.
    Object.assign(into, { [key]: value });
    changed = true;
  }
  return changed;
}

/**
 * `osmRef` is unique, so a ref already claimed by a different property (two pins
 * dropped on one building) must not be written or the update throws.
 */
async function osmRefIfFree(osmRef: string | null | undefined, propertyId: string): Promise<string | null> {
  if (!osmRef) return null;
  const holder = await prisma.property.findUnique({ where: { osmRef }, select: { id: true } });
  if (holder && holder.id !== propertyId) return null;
  return osmRef;
}

/** The property's own saved facts, so the fallback treats them as already-known. */
function existingFacts(property: PropertyModel): PropertyFacts {
  return {
    address: property.address,
    city: property.city,
    state: property.state,
    zip: property.zip,
    ownerName: property.ownerName,
    parcelId: property.parcelId,
    footprintSqFt: property.footprintSqFt,
    buildingLevels: property.buildingLevels,
    roofShape: property.roofShape,
    roofMaterial: property.roofMaterial,
    yearBuilt: property.yearBuilt,
  };
}

/**
 * Placeholder building facts derived from the coordinates themselves. Used when
 * the lookups are unavailable (offline dev, every provider failing) so the rest
 * of the pipeline stays exercisable. Deterministic, and never an owner name —
 * a fabricated owner would be worse than a blank one.
 */
function derivedFallbackFacts(point: GeoPoint): PropertyFacts {
  const seed = hashPoint(point);
  const shapes = ["gabled", "hipped", "gabled", "skillion", "hipped", "flat"];
  return {
    footprintSqFt: 1100 + (seed % 2000),
    buildingLevels: 1 + ((seed >> 5) % 2),
    roofShape: shapes[(seed >> 9) % shapes.length],
    roofMaterial: "asphalt_shingle",
  };
}

/** Small deterministic hash so the same pin always derives the same placeholders. */
function hashPoint({ lat, lng }: GeoPoint): number {
  const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Which lookups this deployment can actually perform — surfaced on the map UI. */
export function describeProviders(): ProviderStatusResponse {
  return {
    offline: offlineMode(),
    providers: ALL_PROVIDERS.map((p: OpenDataProvider): ProviderStatus => ({
      id: p.id,
      label: p.label,
      configured: p.configured,
    })),
  };
}
