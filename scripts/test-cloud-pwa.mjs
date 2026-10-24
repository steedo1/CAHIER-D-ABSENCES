import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const prefix = /^(class-device|class-session|class-exceptional|attendance-|offline-|pwa-|teacher-attendance|teacher-session|relay-capability|relay-ui|relay-mode|phone-offline|csca-attendance|background-attendance)/;
const files = readdirSync(new URL("../test/", import.meta.url))
  .filter((name) => prefix.test(name) && /\.test\.(?:mjs|mts|ts)$/.test(name))
  .sort().map((name) => `test/${name}`);
console.log(`Cloud/PWA audit: ${files.length} fichiers de tests, concurrence limitée à 2.`);
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=2", ...files], {
  cwd: new URL("../", import.meta.url), stdio: "inherit", windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
