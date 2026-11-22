"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { GoogleSignOut } from "@/app/(site)/login/sign-in";
import styles from "./owner.module.css";

const links = [
  { href: "/admin", label: "Desk", exact: true },
  { href: "/admin/templates", label: "Templates" },
  { href: "/admin/exercises", label: "Exercises" },
  { href: "/studio", label: "Publishing" },
  { href: "/admin/connections", label: "Connections" },
];

export function OwnerNav() {
  const pathname = usePathname();
  const row = useRef<HTMLElement>(null);
  const active = links.find(({ href, exact }) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)));

  useEffect(() => {
    const element = row.current;
    const current = element?.querySelector<HTMLElement>("[aria-current]");
    if (!element || !current) return;
    element.scrollLeft = Math.max(0, current.offsetLeft - 16);
  }, [active?.href]);

  return (
    <nav className={styles.nav} aria-label="Owner" ref={row}>
      {links.map(({ href, label }) => (
        <Link key={href} href={href} aria-current={active?.href === href ? "page" : undefined}>{label}</Link>
      ))}
      <span className={styles.navEnd}><GoogleSignOut /></span>
    </nav>
  );
}
