import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import CrmDashboard from "@/components/crm/CrmDashboard";

export const metadata: Metadata = {
  title: "CRM | RoofAI Sheds",
};

export default function CrmPage() {
  return (
    <div className="min-h-screen bg-neutral-950">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="mb-1 text-2xl font-semibold text-white">Lead pipeline</h1>
        <p className="mb-6 text-sm text-neutral-400">
          Every configurator quote lands here automatically — no separate CRM import needed.
        </p>
        <CrmDashboard />
      </main>
    </div>
  );
}
