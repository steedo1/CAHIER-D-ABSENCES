import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: currentDirectory });

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "desktop/relay/dist/**",
      "backups/**",
      "next-env.d.ts",
      "**/*.tsbuildinfo",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Dette historique du dépôt : le typage strict est assuré par `tsc` et
    // ces règles ne peuvent pas être activées rétroactivement dans ce lot.
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-extra-non-null-assertion": "off",
      "react/no-unescaped-entities": "off",
      "react/display-name": "off",
      "prefer-const": "off",
    },
  },
];

export default config;
