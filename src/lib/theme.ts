// The reader's theme choice. "auto" follows the device and stores nothing;
// "light" and "dark" are kept in a cookie so the server can render the choice
// into the first byte of the page, with no flash and no script in the head.

export type Theme = "auto" | "light" | "dark";

export const THEME_COOKIE = "theme";
export const THEMES: readonly Theme[] = ["auto", "light", "dark"];

/** The colours behind the browser's own chrome, matching --ground in each theme. */
export const GROUND = { light: "#ffffff", dark: "#000000" } as const;

export function readTheme(value: string | undefined | null): Theme {
  return value === "light" || value === "dark" ? value : "auto";
}
