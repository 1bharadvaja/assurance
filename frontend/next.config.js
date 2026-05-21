/**
 * @type {import('next').NextConfig}
 *
 * Two modes:
 * - Default: classic Next.js dev/start that talks to a real FastAPI backend.
 * - Demo mode (set `STATIC_EXPORT=1` and `NEXT_PUBLIC_DEMO_MODE=true`):
 *   produces a fully-static site that reads pre-computed verifier responses
 *   from `/canned`. We use this to deploy the public Pages demo.
 */
const isStatic = process.env.STATIC_EXPORT === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig = {
  reactStrictMode: true,
  ...(isStatic ? { output: "export", images: { unoptimized: true } } : {}),
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
};

module.exports = nextConfig;
