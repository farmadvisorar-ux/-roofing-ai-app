"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ContractType } from "@/generated/prisma/enums";
import { buildAmortizationSchedule, computeMonthlyPayment } from "@/lib/financing";
import { LeadDTO, ContractDTO } from "@/lib/types";
import SignaturePad from "../SignaturePad";

const TYPE_LABELS: Record<ContractType, string> = {
  CASH: "Pay in full",
  FINANCE: "Financing",
  RENT_TO_OWN: "Rent-to-own",
};

export default function ContractBuilder({ leadId }: { leadId: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const contractId = searchParams.get("contractId");

  const [lead, setLead] = useState<LeadDTO | null>(null);
  const [contract, setContract] = useState<ContractDTO | null>(null);

  const [type, setType] = useState<ContractType>("FINANCE");
  const [totalPrice, setTotalPrice] = useState(0);
  const [downPayment, setDownPayment] = useState(0);
  const [apr, setApr] = useState(9.9);
  const [termMonths, setTermMonths] = useState(36);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [signerName, setSignerName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    fetch(`/api/leads/${leadId}`)
      .then((r) => r.json())
      .then((data) => {
        setLead(data.lead);
        setTotalPrice(data.lead?.shedConfig?.price ?? data.lead?.estimatedValue ?? 0);
        setSignerName(data.lead?.contact?.name ?? "");
      });
  }, [leadId]);

  useEffect(() => {
    if (!contractId) return;
    fetch(`/api/contracts/${contractId}`)
      .then((r) => r.json())
      .then((data) => setContract(data.contract));
  }, [contractId]);

  const previewMonthly = useMemo(
    () => computeMonthlyPayment({ type, totalPrice, downPayment, apr, termMonths }),
    [type, totalPrice, downPayment, apr, termMonths],
  );

  async function createContract() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, type, totalPrice, downPayment, apr, termMonths }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't create the contract");
      router.replace(`/crm/leads/${leadId}/contract?contractId=${data.contract.id}`);
      setContract(data.contract);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function signContract() {
    if (!contract || !signature) return;
    setSigning(true);
    setError(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signerName, signatureData: signature }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't sign the contract");
      setContract(data.contract);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSigning(false);
    }
  }

  if (!lead) return <p className="text-neutral-400">Loading…</p>;

  if (contract) {
    const schedule = buildAmortizationSchedule({
      type: contract.type,
      totalPrice: contract.totalPrice,
      downPayment: contract.downPayment,
      apr: contract.apr,
      termMonths: contract.termMonths,
    });

    return (
      <div className="flex flex-col gap-6">
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-sm text-neutral-200">
          <h2 className="mb-4 text-lg font-semibold text-white">
            {TYPE_LABELS[contract.type]} agreement
          </h2>
          <dl className="mb-4 grid grid-cols-2 gap-y-1">
            <dt className="text-neutral-500">Buyer</dt>
            <dd>{lead.contact.name}</dd>
            <dt className="text-neutral-500">Shed</dt>
            <dd>
              {lead.shedConfig ? `${lead.shedConfig.widthFt}' × ${lead.shedConfig.lengthFt}'` : "—"}
            </dd>
            <dt className="text-neutral-500">Total price</dt>
            <dd>${contract.totalPrice.toLocaleString()}</dd>
            <dt className="text-neutral-500">Down payment</dt>
            <dd>${contract.downPayment.toLocaleString()}</dd>
            {contract.type !== "CASH" && (
              <>
                <dt className="text-neutral-500">{contract.type === "FINANCE" ? "APR" : "Markup"}</dt>
                <dd>{contract.apr}%</dd>
                <dt className="text-neutral-500">Term</dt>
                <dd>{contract.termMonths} months</dd>
                <dt className="text-neutral-500">Monthly payment</dt>
                <dd className="font-semibold text-white">${contract.monthlyPayment.toLocaleString()}</dd>
              </>
            )}
            <dt className="text-neutral-500">Status</dt>
            <dd className={contract.status === "SIGNED" ? "text-emerald-400" : "text-neutral-300"}>
              {contract.status}
              {contract.signedAt ? ` · ${new Date(contract.signedAt).toLocaleDateString()}` : ""}
            </dd>
          </dl>

          {schedule.length > 0 && (
            <details className="mb-4">
              <summary className="cursor-pointer text-neutral-400">Payment schedule ({schedule.length} months)</summary>
              <div className="mt-2 max-h-48 overflow-y-auto text-xs">
                <table className="w-full text-left">
                  <thead className="text-neutral-500">
                    <tr>
                      <th className="pr-2">#</th>
                      <th className="pr-2">Payment</th>
                      <th className="pr-2">Principal</th>
                      <th className="pr-2">Interest</th>
                      <th>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map((row) => (
                      <tr key={row.month} className="text-neutral-300">
                        <td className="pr-2">{row.month}</td>
                        <td className="pr-2">${row.payment.toLocaleString()}</td>
                        <td className="pr-2">${row.principal.toLocaleString()}</td>
                        <td className="pr-2">${row.interest.toLocaleString()}</td>
                        <td>${row.balance.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {contract.status === "SIGNED" ? (
            <div className="rounded-md border border-emerald-700 bg-emerald-500/10 p-3 text-emerald-300">
              Signed by {contract.signerName} on{" "}
              {contract.signedAt ? new Date(contract.signedAt).toLocaleString() : ""}.
            </div>
          ) : (
            <div className="border-t border-neutral-800 pt-4">
              <label className="mb-2 block text-sm text-neutral-300">
                Signer full name
                <input
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  className="input mt-1 w-full"
                />
              </label>
              <SignaturePad onChange={setSignature} />
              {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
              <button
                onClick={signContract}
                disabled={signing || !signature || !signerName.trim()}
                className="mt-3 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {signing ? "Signing…" : "Sign contract"}
              </button>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-300">Plan type</h2>
        <div className="flex gap-2">
          {(Object.keys(TYPE_LABELS) as ContractType[]).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`flex-1 rounded-md border px-3 py-2 text-sm ${
                type === t
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                  : "border-neutral-700 text-neutral-300 hover:border-neutral-500"
              }`}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <label className="text-sm text-neutral-300">
          Total price ($)
          <input
            type="number"
            value={totalPrice}
            onChange={(e) => setTotalPrice(Number(e.target.value))}
            className="input mt-1 w-full"
          />
        </label>
        <label className="text-sm text-neutral-300">
          Down payment ($)
          <input
            type="number"
            value={downPayment}
            onChange={(e) => setDownPayment(Number(e.target.value))}
            className="input mt-1 w-full"
          />
        </label>
        {type !== "CASH" && (
          <>
            <label className="text-sm text-neutral-300">
              {type === "FINANCE" ? "APR (%)" : "Markup (%)"}
              <input
                type="number"
                step={0.1}
                value={apr}
                onChange={(e) => setApr(Number(e.target.value))}
                className="input mt-1 w-full"
              />
            </label>
            <label className="text-sm text-neutral-300">
              Term (months)
              <input
                type="number"
                value={termMonths}
                onChange={(e) => setTermMonths(Number(e.target.value))}
                className="input mt-1 w-full"
              />
            </label>
          </>
        )}
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <div className="text-xs uppercase tracking-wide text-neutral-500">Estimated payment</div>
        <div className="text-2xl font-semibold text-white">
          {type === "CASH" ? `$${totalPrice.toLocaleString()} due at signing` : `$${previewMonthly.toLocaleString()} / mo`}
        </div>
      </section>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        onClick={createContract}
        disabled={submitting}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {submitting ? "Creating…" : "Generate contract"}
      </button>
    </div>
  );
}
