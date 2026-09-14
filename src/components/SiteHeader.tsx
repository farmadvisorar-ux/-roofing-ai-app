import Link from "next/link";

const NAV_LINKS = [
  { href: "/configurator", label: "Configurator" },
  { href: "/map", label: "Canvass" },
  { href: "/prospects", label: "Prospects" },
  { href: "/crm", label: "CRM" },
];

export default function SiteHeader() {
  return (
    <header className="border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-sm font-semibold text-white">
          RoofAI <span className="text-emerald-400">Sheds</span>
        </Link>
        <nav className="flex gap-4 text-sm text-neutral-300">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-white">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
