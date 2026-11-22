import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import { cookies } from "next/headers";
import { GROUND, THEME_COOKIE, readTheme } from "@/src/lib/theme";
import "./globals.css";

// A Nordic news grotesque with true tabular figures: the numbers are the content.
const sans = Schibsted_Grotesk({ subsets: ["latin", "latin-ext"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Training Log", template: "%s – Training Log" },
  description: "Every session as it was lifted: exercises, sets and loads, week by week.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Training Log", statusBarStyle: "default" },
};

const chosenTheme = async () => readTheme((await cookies()).get(THEME_COOKIE)?.value);

// The browser's own chrome takes the colour of the page: the chosen theme, or the device's.
export async function generateViewport(): Promise<Viewport> {
  const theme = await chosenTheme();
  return {
    viewportFit: "cover",
    colorScheme: theme === "auto" ? "light dark" : theme,
    themeColor: theme === "auto"
      ? [{ media: "(prefers-color-scheme: light)", color: GROUND.light }, { media: "(prefers-color-scheme: dark)", color: GROUND.dark }]
      : GROUND[theme],
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const theme = await chosenTheme();
  return (
    <html lang="en" className={sans.variable} data-theme={theme === "auto" ? undefined : theme}>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
