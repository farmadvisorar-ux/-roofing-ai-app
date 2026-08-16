import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import LeadDetail from "@/components/crm/LeadDetail";

export default async function LeadDetailPage({ params }: PageProps<"/crm/leads/[id]">) {
  const { id } = await params;
  return (
    <div className="min-h-screen bg-neutral-950">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Link href="/crm" className="mb-4 inline-block text-sm text-neutral-500 hover:text-neutral-300">
          ← Back to pipeline
        </Link>
        <h1 className="mb-6 text-2xl font-semibold text-white">Lead detail</h1>
        <LeadDetail leadId={id} />
      </main>
    </div>
  );
}
