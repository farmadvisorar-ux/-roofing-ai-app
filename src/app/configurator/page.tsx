import type { Metadata } from "next";
import ShedConfigurator from "@/components/ShedConfigurator";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Design your shed | RoofAI Sheds",
  description: "Configure a custom shed in 3D and preview it in your yard with AR.",
};

export default function ConfiguratorPage() {
  return (
    <div className="min-h-screen bg-neutral-950">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="mb-1 text-2xl font-semibold text-white">Design your shed</h1>
        <p className="mb-6 text-sm text-neutral-400">
          Built with our own real-time 3D engine — no plugins, works in any modern browser.
        </p>
        <ShedConfigurator />
      </main>
    </div>
  );
}
