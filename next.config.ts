import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Ne bloque pas le build si ESLint trouve des erreurs
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
