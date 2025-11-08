// web/tailwind.config.ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      zIndex: {
        60: "60", // permet d'utiliser `z-60` au lieu de `z-[60]`
      },
    },
  },
  plugins: [],
};

export default config;
