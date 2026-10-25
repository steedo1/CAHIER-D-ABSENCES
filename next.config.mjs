// @ts-check
// Keep this configuration executable by Node: next.config.ts makes Next 15
// load TypeScript and native SWC into every long-lived production server.
/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    // Public branding only. These versioned URLs must change if the image changes.
    // Never apply this policy to authenticated pages, student photos or APIs.
    return [
      "/admin.v2.webp", "/nexa-digital-logo.v2.webp", "/accueil.v2.webp",
      "/home/hero-notes.v2.webp", "/home/hero-textes.v2.webp",
      "/home/hero-communication.v2.webp", "/home/hero-finance.v2.webp",
      "/favicon.v2.png", "/icons/icon-192.v2.png", "/icons/icon-512.v2.png",
    ].map((source) => ({
      source,
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    }));
  },
  // Next replaces this public value at build time. Render exposes its commit
  // only on the server; explicitly bridge that non-secret release identifier.
  env: {
    NEXT_PUBLIC_MON_CAHIER_RELEASE:
      process.env.NEXT_PUBLIC_MON_CAHIER_RELEASE ||
      process.env.RENDER_GIT_COMMIT ||
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
      "development",
  },
  eslint: {
    // Ne bloque pas le build si ESLint trouve des erreurs
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
