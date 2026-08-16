// Client-side shapes for JSON API responses (Dates arrive as ISO strings over the wire).
import { ContractStatus, ContractType, LeadSource, LeadStage, RoofStyle } from "@/generated/prisma/enums";

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
}
