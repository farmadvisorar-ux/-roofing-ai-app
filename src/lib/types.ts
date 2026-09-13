// Client-side shapes for JSON API responses (Dates arrive as ISO strings over the wire).
import {
  ContractStatus,
  ContractType,
  EnrichmentStatus,
  LeadSource,
  LeadStage,
  RoofStyle,
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
  createdAt: string;
  updatedAt: string;
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
