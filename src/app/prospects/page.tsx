import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import ProspectsWorkbench from "@/components/prospects/ProspectsWorkbench";

export const metadata: Metadata = {
  title: "Prospects | RoofAI Sheds",
  description: "Every canvassed roof, scored on open-data buying signals and ranked for the doorstep.",
};

export default function ProspectsPage() {
  return (
    <div className="min-h-screen bg-neutral-950">
      <SiteHeader />
      <main className="mx-auto max-w-[1400px] px-4 py-8">
        <h1 className="mb-1 text-2xl font-semibold text-white">Prospects</h1>
        <p className="mb-6 text-sm text-neutral-400">
          Every canvassed roof, scored on roof age, observed hail, ownership changes and permit
          history. Every point is attributable to a named signal.
        </p>
        <ProspectsWorkbench />
      </main>
    </div>
  );
}
