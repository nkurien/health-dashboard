import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export: `next build` writes plain HTML/CSS/JS to ./out, which the
  // Cloudflare Worker serves. The API lives on the same domain (see ../worker).
  output: "export",
};

export default nextConfig;
