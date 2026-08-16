import { ContractType } from "@/generated/prisma/enums";

export interface FinancingTerms {
  type: ContractType;
  totalPrice: number;
  downPayment: number;
  apr: number; // annual percentage rate for FINANCE, or markup % for RENT_TO_OWN
  termMonths: number;
}

export interface PaymentScheduleEntry {
  month: number;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
}

export function computeMonthlyPayment(terms: FinancingTerms): number {
  const principal = Math.max(0, terms.totalPrice - terms.downPayment);
  if (terms.type === "CASH" || terms.termMonths <= 0) return 0;

  if (terms.type === "FINANCE") {
    const r = terms.apr / 100 / 12;
    if (r === 0) return round2(principal / terms.termMonths);
    const factor = Math.pow(1 + r, terms.termMonths);
    return round2((principal * r * factor) / (factor - 1));
  }

  // RENT_TO_OWN: apr doubles as a markup percentage on the cash price.
  const rtoTotal = principal * (1 + terms.apr / 100);
  return round2(rtoTotal / terms.termMonths);
}

export function buildAmortizationSchedule(terms: FinancingTerms): PaymentScheduleEntry[] {
  if (terms.type === "CASH" || terms.termMonths <= 0) return [];
  const monthly = computeMonthlyPayment(terms);
  const schedule: PaymentScheduleEntry[] = [];

  if (terms.type === "FINANCE") {
    let balance = Math.max(0, terms.totalPrice - terms.downPayment);
    const r = terms.apr / 100 / 12;
    for (let m = 1; m <= terms.termMonths; m++) {
      const interest = round2(balance * r);
      const principal = round2(Math.min(balance, monthly - interest));
      balance = round2(Math.max(0, balance - principal));
      schedule.push({ month: m, payment: monthly, principal, interest, balance });
    }
    return schedule;
  }

  // RENT_TO_OWN: flat payments, no interest breakdown.
  let balance = round2(Math.max(0, terms.totalPrice - terms.downPayment) * (1 + terms.apr / 100));
  for (let m = 1; m <= terms.termMonths; m++) {
    const principal = round2(Math.min(balance, monthly));
    balance = round2(Math.max(0, balance - principal));
    schedule.push({ month: m, payment: monthly, principal, interest: 0, balance });
  }
  return schedule;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
