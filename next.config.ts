import type { NextConfig } from "next";

export default {
  experimental: { serverActions: { bodySizeLimit: "9mb" } },
} satisfies NextConfig;
