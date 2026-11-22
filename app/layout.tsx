import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Training Log", template: "%s · Training Log" },
  description: "A public log of strength training and notes from the process.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Training Log", statusBarStyle: "default" },
  icons: { apple: "/icon-192.png" },
};
export const viewport: Viewport = { themeColor: "#21291c" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en">
    <body>
      <a className="skip" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="shell header-inner">
          <Link href="/" className="brand"><span aria-hidden="true">↗</span> Training Log</Link>
          <nav aria-label="Main navigation">
            <Link href="/training">Training</Link>
            <Link href="/journal">Journal</Link>
            <Link href="/admin" className="owner-link">Log workout</Link>
          </nav>
        </div>
      </header>
      <main className="shell" id="main">{children}</main>
      <footer className="shell site-footer"><Link href="/">Training Log</Link><Link href="/privacy">Privacy</Link></footer>
    </body>
  </html>;
}
