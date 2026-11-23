import type { NextConfig } from "next";

// Sent with every response. The pages hold buttons that write (finish, delete, reopen),
// so no other site may put them in a frame; nothing here needs the camera, microphone or
// location; and a link that leaves the site says only where it came from, not which page.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

export default {
  experimental: { serverActions: { bodySizeLimit: "9mb" } },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
} satisfies NextConfig;
