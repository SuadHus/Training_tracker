"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const publicLinks = [
  { href: "/", label: "Overview" },
  { href: "/training", label: "Training" },
  { href: "/journal", label: "Journal" },
];

export function SiteNav() {
  const pathname = usePathname();
  const activeSection = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const ownerSection = ["/admin", "/studio", "/login"].some(activeSection);

  return <nav aria-label="Main navigation">
    <div className="public-links">
      {publicLinks.map(({ href, label }) => <Link
        key={href}
        href={href}
        aria-current={pathname === href ? "page" : activeSection(href) ? "location" : undefined}
      >{label}</Link>)}
    </div>
    <Link href="/admin" className="owner-link" aria-current={ownerSection ? (pathname === "/admin" ? "page" : "location") : undefined}>
      Log workout <span aria-hidden="true">↗</span>
    </Link>
  </nav>;
}
