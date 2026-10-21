// @ts-check
// Keep this configuration executable by Node: next.config.ts makes Next 15
// load TypeScript and native SWC into every long-lived production server.
/** @type {import('next').NextConfig} */
const nextConfig = {
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
