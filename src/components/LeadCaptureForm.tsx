"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ShedConfigInput } from "@/lib/shed";
import QrCode from "./QrCode";

interface LeadCaptureFormProps {
  config: ShedConfigInput;
  price: number;
}

interface CreatedLead {
  id: string;
  contact: { name: string };
}

export default function LeadCaptureForm({ config, price }: LeadCaptureFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedLead | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    zip: "",
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact: form,
          shedConfig: config,
          source: "CONFIGURATOR",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      setCreated(data.lead);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    const arUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}/ar?leadId=${created.id}`
        : `/ar?leadId=${created.id}`;
    return (
      <section className="rounded-lg border border-emerald-700 bg-emerald-500/10 p-4">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-emerald-300">
          Quote sent!
        </h2>
        <p className="mb-4 text-sm text-emerald-100">
          Thanks {created.contact.name.split(" ")[0]} — your ${price.toLocaleString()} estimate has
          been saved and a rep will follow up shortly.
        </p>
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <QrCode value={arUrl} size={120} />
          <div className="text-sm text-emerald-100">
            <p className="mb-2">Scan with your phone to drop this shed in your yard with AR.</p>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/crm/leads/${created.id}`}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-500"
              >
                View in CRM
              </Link>
              <Link
                href={`/crm/leads/${created.id}/contract`}
                className="rounded-md border border-emerald-500 px-3 py-1.5 text-emerald-200 hover:bg-emerald-500/10"
              >
                Start financing / RTO
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-300">
        Get your free quote
      </h2>
      <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
        <input
          required
          placeholder="Full name"
          className="col-span-2 input"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          placeholder="Email"
          type="email"
          className="input"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <input
          placeholder="Phone"
          className="input"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
        <input
          placeholder="Install address"
          className="col-span-2 input"
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
        />
        <input
          placeholder="City"
          className="input"
          value={form.city}
          onChange={(e) => setForm({ ...form, city: e.target.value })}
        />
        <div className="grid grid-cols-2 gap-3">
          <input
            placeholder="State"
            className="input"
            value={form.state}
            onChange={(e) => setForm({ ...form, state: e.target.value })}
          />
          <input
            placeholder="ZIP"
            className="input"
            value={form.zip}
            onChange={(e) => setForm({ ...form, zip: e.target.value })}
          />
        </div>
        {error && <p className="col-span-2 text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="col-span-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {submitting ? "Sending…" : `Get my $${price.toLocaleString()} quote`}
        </button>
      </form>
    </section>
  );
}
