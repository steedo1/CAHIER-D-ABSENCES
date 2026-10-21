// @ts-check
// Keep this configuration executable by Node: next.config.ts makes Next 15
// load TypeScript and native SWC into every long-lived production server.
/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Ne bloque pas le build si ESLint trouve des erreurs
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
