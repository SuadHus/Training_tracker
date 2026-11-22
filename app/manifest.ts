import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Training Log",
    short_name: "Training",
    description: "Plan workouts and record your training.",
    start_url: "/admin",
    display: "standalone",
    theme_color: "#21291c",
    background_color: "#f6f4ec",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
