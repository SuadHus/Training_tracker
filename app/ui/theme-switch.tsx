"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { THEME_COOKIE, THEMES, type Theme } from "@/src/lib/theme";

const names: Record<Theme, string> = { auto: "Auto", light: "Light", dark: "Dark" };

/** Auto follows the device. Light and dark are remembered in a cookie on this device. */
export function ThemeSwitch({ initial }: { initial: Theme }) {
  const router = useRouter();
  const [theme, setTheme] = useState(initial);

  const choose = (next: Theme) => {
    setTheme(next);
    const root = document.documentElement;
    if (next === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = next === "auto"
      ? `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
      : `${THEME_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    // The server renders the theme into <html> and the browser's theme colour; let it catch up.
    router.refresh();
  };

  return (
    <div className="theme" role="group" aria-label="Theme">
      <span className="theme-name" aria-hidden="true">Theme</span>
      {THEMES.map((option) => (
        <button type="button" key={option} aria-pressed={theme === option} onClick={() => choose(option)}>{names[option]}</button>
      ))}
    </div>
  );
}
