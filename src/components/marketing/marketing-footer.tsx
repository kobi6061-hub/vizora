import Link from "next/link";
import { Wordmark } from "@/components/brand/logo";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/product", label: "Product" },
      { href: "/templates", label: "Templates" },
      { href: "/examples", label: "Examples" },
      { href: "/pricing", label: "Pricing" },
      { href: "/business", label: "Vizora for Business" },
    ],
  },
  {
    title: "Create",
    links: [
      { href: "/image-to-video", label: "Image to video" },
      { href: "/real-estate-video", label: "Real-estate videos" },
      { href: "/signup", label: "Create an account" },
      { href: "/login", label: "Sign in" },
    ],
  },
] as const;

export function MarketingFooter() {
  return (
    <footer className="hairline-t">
      <div className="container-page flex flex-col gap-12 py-16 md:flex-row md:justify-between">
        <div className="max-w-xs space-y-4">
          <Wordmark />
          <p className="text-sm leading-relaxed text-stone">
            The AI video studio built for real estate. Upload property images.
            Publish marketing videos in minutes.
          </p>
        </div>
        <div className="flex flex-wrap gap-16">
          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title} className="space-y-3">
              <p className="text-eyebrow">{column.title}</p>
              <ul className="space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-ink-mid transition-colors hover:text-ink"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
      <div className="hairline-t">
        <div className="container-page flex flex-wrap items-center justify-between gap-3 py-6 text-[13px] text-faint">
          <p>© 2026 Vizora. All rights reserved.</p>
          <p>Upload → Create → Publish</p>
        </div>
      </div>
    </footer>
  );
}
