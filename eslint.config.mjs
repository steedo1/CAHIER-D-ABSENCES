// eslint.config.mjs
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Permet d'utiliser les configs "legacy" de Next (core-web-vitals, typescript)
const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  // Presets Next.js
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // Fichiers/dossiers à ignorer
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "next-env.d.ts",
    ],
  },

  // Règles génériques JS/TS
  {
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // Règles spécifiques TypeScript (assouplies pour ne pas casser le build)
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
];
