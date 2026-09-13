// Client-side shapes for JSON API responses (Dates arrive as ISO strings over the wire).
import {
  ContractStatus,
  ContractType,
  EnrichmentStatus,
  LeadSource,
  LeadStage,
  PropertyEventKind,
  RoofStyle,
  ScoreBand,
} from "@/generated/prisma/enums";

export interface ContactDTO {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export interface ShedConfigDTO {
  id: string;
  widthFt: number;
  lengthFt: number;
  wallHeightFt: number;
  roofStyle: RoofStyle;
  roofPitch: number;
  sidingColor: string;
  trimColor: string;
  roofColor: string;
  doorCount: number;
  doorWidthFt: number;
  windowCount: number;
  price: number;
}

export interface ContractDTO {
  id: string;
  leadId: string;
  type: ContractType;
  status: ContractStatus;
  totalPrice: number;
  downPayment: number;
  apr: number;
  termMonths: number;
  monthlyPayment: number;
  signerName: string | null;
  signatureData: string | null;
  signedAt: string | null;
  createdAt: string;
}

export interface LeadDTO {
  id: string;
  contactId: string;
  stage: LeadStage;
  source: LeadSource;
  estimatedValue: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  contact: ContactDTO;
  shedConfig: ShedConfigDTO | null;
  contracts: ContractDTO[];
  /** Present only on endpoints that include it, e.g. POST /api/properties/:id/lead. */
  property?: PropertyDTO | null;
}

export interface PropertyDTO {
  id: string;
  lat: number;
  lng: number;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  ownerName: string | null;
  parcelId: string | null;
  osmRef: string | null;
  footprintSqFt: number | null;
  buildingLevels: number | null;
  roofShape: string | null;
  roofMaterial: string | null;
  yearBuilt: number | null;
  roofSqFt: number | null;
  roofSquares: number | null;
  estimateLow: number | null;
  estimateHigh: number | null;
  enrichmentStatus: EnrichmentStatus;
  enrichmentSources: string | null;
  enrichmentError: string | null;
  enrichedAt: string | null;
  notes: string | null;
  leadId: string | null;
  territory: string | null;
  createdAt: string;
  updatedAt: string;

  // Buying signals.
  assessedValue: number | null;
  lastSaleDate: string | null;
  lastSalePrice: number | null;
  lastPermitDate: string | null;
  lastPermitType: string | null;
  roofPermitDate: string | null;
  hailEventsNearby: number | null;
  maxHailInches: number | null;
  lastHailDate: string | null;
  hailIsPreliminary: boolean | null;
  hailWindowYears: number | null;
  hailSearchRadiusMi: number | null;
  stormWindowYears: number | null;
  severeStormDays: number | null;
  peakGustMph: number | null;

  // Score. `scoreComponents` is JSON — read it with parseScore() from lib/signals.
  leadScore: number | null;
  leadScoreBand: ScoreBand | null;
  scoreConfidence: number | null;
  scoreComponents: string | null;
  scoredAt: string | null;

  /** Included by GET /api/properties/:id only. */
  events?: PropertyEventDTO[];
}

export interface PropertyEventDTO {
  id: string;
  kind: PropertyEventKind;
  summary: string;
  detail: string | null;
  actor: string | null;
  createdAt: string;
}

export interface PropertyPage {
  properties: PropertyDTO[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** Which open-data lookups a deployment can perform (GET /api/enrichment/providers). */
export interface ProviderStatus {
  id: string;
  label: string;
  configured: boolean;
}

export interface ProviderStatusResponse {
  offline: boolean;
  providers: ProviderStatus[];
}

/** One region of the service footprint, with live coverage (GET /api/territories). */
export interface TerritorySummary {
  id: string;
  name: string;
  states: string[];
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  center: { lat: number; lng: number };
  zoom: number;
  hubs: string[];
  properties: number;
  unworked: number;
  /** Roofs scored HOT or WARM. */
  priority: number;
  averageScore: number | null;
  estimatedValue: number;
  hailEvents: number;
  recentHailEvents: number;
  largestHailInches: number | null;
  largestHailDate: string | null;
  /** Most recent hail on record here — shows how current the import is. */
  latestHailDate: string | null;
  /** True when the newest report is from SPC's unverified daily feed. */
  latestHailIsPreliminary: boolean;
  preliminaryHailEvents: number;
  recentHailYears: number;
}

export interface TerritoryResponse {
  territories: TerritorySummary[];
  outsideFootprint: number;
}
