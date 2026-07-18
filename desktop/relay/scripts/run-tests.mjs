import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const testDirectory = new URL("../dist/test/", import.meta.url);
const tests = readdirSync(testDirectory)
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => new URL(name, testDirectory));

if (tests.length === 0) {
  console.error("Aucun test compilé trouvé.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...tests.map(fileURLToPath)], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
