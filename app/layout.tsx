import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { SiteNav } from "./site-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Training Log", template: "%s · Training Log" },
  description: "A public log of strength training and notes from the process.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Training Log", statusBarStyle: "default" },
  icons: { apple: "/icon-192.png" },
};
export const viewport: Viewport = { themeColor: "#174b38" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en">
    <body>
      <a className="skip" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="shell header-inner">
          <Link href="/" className="brand"><img src="/icon.svg" width={34} height={34} alt="" />Training Log</Link>
          <SiteNav />
        </div>
      </header>
      <main className="shell" id="main" tabIndex={-1}>{children}</main>
      <footer className="shell site-footer"><Link href="/">Training Log</Link><Link href="/privacy">Privacy</Link></footer>
    </body>
  </html>;
}
