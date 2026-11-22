"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "This week" },
  { href: "/training", label: "All weeks" },
  { href: "/journal", label: "Journal" },
];

export function SiteNav({ owner }: { owner: boolean }) {
  const pathname = usePathname();
  const within = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  const current = (href: string) => (pathname === href ? "page" : within(href) ? "true" : undefined);
  const desk = pathname.startsWith("/admin") || pathname.startsWith("/studio");

  return (
    <>
      <nav className="nav" aria-label="Main">
        {links.map(({ href, label }) => <Link key={href} href={href} aria-current={current(href)}>{label}</Link>)}
      </nav>
      {owner && <Link href="/admin" className="owner-link" aria-current={desk ? "true" : undefined}>Desk</Link>}
    </>
  );
}
