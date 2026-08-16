import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import HeroViewer from "@/components/HeroViewer";

export default function Home() {
  return (
    <div className="min-h-screen bg-neutral-950">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <h1 className="mb-4 text-4xl font-bold leading-tight text-white">
              Sell sheds in 3D. Close them with AR.
            </h1>
            <p className="mb-6 text-lg text-neutral-400">
              A custom-built, plugin-free 3D configurator, a phone-based AR viewer that drops the
              shed right in the customer&apos;s yard, and a CRM with financing &amp; rent-to-own
              contracts baked in from the first quote.
            </p>
            <div className="flex gap-3">
              <Link
                href="/configurator"
                className="rounded-md bg-emerald-600 px-5 py-3 font-medium text-white hover:bg-emerald-500"
              >
                Try the configurator
              </Link>
              <Link
                href="/crm"
                className="rounded-md border border-neutral-700 px-5 py-3 font-medium text-neutral-200 hover:border-neutral-500"
              >
                Open the CRM
              </Link>
            </div>
          </div>
          <HeroViewer />
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          <FeatureCard
            title="Proprietary 3D engine"
            description="Hand-built WebGL2 renderer — no Unity, no plugin, no three.js. Runs in any modern browser, desktop or mobile."
          />
          <FeatureCard
            title="AR from their phone"
            description="WebXR hit-test lets a customer drop the shed onto their real yard; a camera-based fallback covers browsers without WebXR."
          />
          <FeatureCard
            title="CRM built in, not bolted on"
            description="Every quote becomes a tracked lead automatically, with financing and rent-to-own contracts generated straight from the 3D config."
          />
        </div>
      </main>
    </div>
  );
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <h3 className="mb-2 font-semibold text-white">{title}</h3>
      <p className="text-sm text-neutral-400">{description}</p>
    </div>
  );
}
