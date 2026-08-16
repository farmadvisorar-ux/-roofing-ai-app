import { Suspense } from "react";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import ContractBuilder from "@/components/crm/ContractBuilder";

export default async function ContractPage({ params }: PageProps<"/crm/leads/[id]/contract">) {
  const { id } = await params;
  return (
    <div className="min-h-screen bg-neutral-950">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Link href={`/crm/leads/${id}`} className="mb-4 inline-block text-sm text-neutral-500 hover:text-neutral-300">
          ← Back to lead
        </Link>
        <h1 className="mb-6 text-2xl font-semibold text-white">Financing &amp; RTO contract</h1>
        <Suspense fallback={<p className="text-neutral-400">Loading…</p>}>
          <ContractBuilder leadId={id} />
        </Suspense>
      </main>
    </div>
  );
}
