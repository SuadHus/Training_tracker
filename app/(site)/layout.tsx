import { cookies } from "next/headers";
import Link from "next/link";
import { isOwner } from "@/src/lib/owner";
import { THEME_COOKIE, readTheme } from "@/src/lib/theme";
import { SiteNav } from "../ui/site-nav";
import { ThemeSwitch } from "../ui/theme-switch";

export default async function SiteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [owner, jar] = await Promise.all([isOwner(), cookies()]);
  const theme = readTheme(jar.get(THEME_COOKIE)?.value);
  return (
    <>
      <header className="masthead">
        <div className="masthead-bar">
          <Link href="/" className="brand">Training Log</Link>
          <SiteNav owner={owner} />
        </div>
      </header>
      <main className="page" id="main" tabIndex={-1}>{children}</main>
      <div className="footer-rule" />
      <footer className="footer">
        <Link href="/privacy">Privacy</Link>
        {!owner && <Link href="/login">Owner sign-in</Link>}
        <ThemeSwitch initial={theme} />
      </footer>
    </>
  );
}
