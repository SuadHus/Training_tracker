import type { ReactNode } from "react";

// One icon set for the whole site: 24 px grid, one stroke weight, square ends.
// Icons are decoration next to a text label, or the button carries an aria-label.

const paths = {
  back: <polyline points="15 5 8 12 15 19" />,
  forward: <polyline points="9 5 16 12 9 19" />,
  up: <polyline points="5 15 12 8 19 15" />,
  down: <polyline points="5 9 12 16 19 9" />,
  check: <polyline points="5 12.5 10 17.5 19 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  more: <><rect x="4" y="10.5" width="3" height="3" fill="currentColor" stroke="none" /><rect x="10.5" y="10.5" width="3" height="3" fill="currentColor" stroke="none" /><rect x="17" y="10.5" width="3" height="3" fill="currentColor" stroke="none" /></>,
  search: <><circle cx="10.5" cy="10.5" r="5.5" /><path d="M15 15l5 5" /></>,
  trash: <path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v5M14 11v5" />,
  swap: <path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4" />,
  copy: <><rect x="8" y="8" width="12" height="12" /><path d="M16 8V4H4v12h4" /></>,
  note: <path d="M5 4h14v16H5zM9 9h6M9 13h6M9 17h3" />,
  timer: <><circle cx="12" cy="13.5" r="7" /><path d="M12 9.5v4h3M9.5 3h5" /></>,
  calendar: <><rect x="4" y="6" width="16" height="14" /><path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4" /></>,
  flag: <path d="M6 21V4h12l-2.5 4.5L18 13H6" />,
  out: <path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9" />,
  pencil: <path d="M4 20l1-4.5L16.5 4l3.5 3.5L8.5 19zM14 6.5l3.5 3.5" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;

export function Icon({ name, small }: { name: IconName; small?: boolean }) {
  return (
    <svg className={small ? "icon icon--s" : "icon"} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  );
}
