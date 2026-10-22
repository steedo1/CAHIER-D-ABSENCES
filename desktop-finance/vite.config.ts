import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const financeRules = fileURLToPath(
  new URL("../src/lib/finance/charge-rules.ts", import.meta.url),
);
const repoFinanceDir = fileURLToPath(
  new URL("../src/lib/finance/", import.meta.url),
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@mon-cahier-finance-rules": financeRules,
    },
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), repoFinanceDir] },
  },
  clearScreen: false,
});
