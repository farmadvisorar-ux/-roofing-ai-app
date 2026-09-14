import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import CanvassMap from "@/components/map/CanvassMap";

export const metadata: Metadata = {
  title: "Canvassing map | RoofAI Sheds",
  description: "Find roofs worth quoting, enrich them from open data, and turn them into leads.",
};

export default function MapPage() {
  return (
    <div className="min-h-screen bg-neutral-950">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <h1 className="mb-1 text-2xl font-semibold text-white">Canvassing map</h1>
        <p className="mb-6 text-sm text-neutral-400">
          Built on open data — OpenStreetMap tiles and buildings, plus your county&apos;s parcel
          layer for owner names. No proprietary mapping SDK.
        </p>
        <CanvassMap />
      </main>
    </div>
  );
}
