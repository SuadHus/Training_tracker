import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

// A Nordic news grotesque with true tabular figures: the numbers are the content.
const sans = Schibsted_Grotesk({ subsets: ["latin", "latin-ext"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Training Log", template: "%s – Training Log" },
  description: "Every session as it was lifted: exercises, sets and loads, week by week.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Training Log", statusBarStyle: "default" },
};
export const viewport: Viewport = { themeColor: "#ffffff", viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
