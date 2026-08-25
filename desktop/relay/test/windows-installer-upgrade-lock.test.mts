import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const setupPath = `${repoRoot}desktop/relay/windows/MonCahier-Relay-Setup.iss`;
const startupTaskPath = `${repoRoot}desktop/relay/windows/install-startup-task.ps1`;

const setup = readFileSync(setupPath, "utf8");
const startupTask = readFileSync(startupTaskPath, "utf8");

test("Windows installer stops the existing relay before replacing native modules", () => {
  assert.match(setup, /Disable-ScheduledTask/);
  assert.match(setup, /Stop-ScheduledTask/);
  assert.match(setup, /Win32_Process/);
  assert.match(setup, /runtime\\node\.exe/);
  assert.match(setup, /better_sqlite3\.node/);
  assert.match(setup, /WaitForRelayFilesToUnlock/);
});

test("startup task is explicitly re-enabled after an upgrade", () => {
  assert.match(startupTask, /Enable-ScheduledTask/);
});
