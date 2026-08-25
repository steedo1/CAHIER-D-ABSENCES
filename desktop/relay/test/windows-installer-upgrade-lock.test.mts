import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const relayRoot = fileURLToPath(new URL("../../", import.meta.url));
const setupPath = `${relayRoot}windows/MonCahier-Relay-Setup.iss`;
const startupTaskPath = `${relayRoot}windows/install-startup-task.ps1`;
const upgradeStopHelperPath = `${relayRoot}windows/stop-relay-for-upgrade.ps1`;

const setup = readFileSync(setupPath, "utf8");
const startupTask = readFileSync(startupTaskPath, "utf8");
const upgradeStopHelper = readFileSync(upgradeStopHelperPath, "utf8");

test("Windows installer extracts a pre-install helper before replacing native modules", () => {
  assert.match(setup, /stop-relay-for-upgrade\.ps1/);
  assert.match(setup, /Flags: dontcopy/);
  assert.match(setup, /ExtractTemporaryFile\('stop-relay-for-upgrade\.ps1'\)/);
  assert.match(setup, /StopExistingRelayAndWait/);
});

test("upgrade helper stops the relay tree and verifies the real native-module lock", () => {
  assert.match(upgradeStopHelper, /schtasks\.exe/);
  assert.match(upgradeStopHelper, /taskkill\.exe/);
  assert.match(upgradeStopHelper, /Win32_Process/);
  assert.match(upgradeStopHelper, /runtime\\node\.exe/);
  assert.match(upgradeStopHelper, /start-relay-at-boot\.ps1/);
  assert.match(upgradeStopHelper, /better-sqlite3\\build\\Release\\better_sqlite3\.node/);
  assert.match(upgradeStopHelper, /FileShare\]::None/);
  assert.match(upgradeStopHelper, /exit 5/);
});

test("startup task is explicitly re-enabled after an upgrade", () => {
  assert.match(startupTask, /Enable-ScheduledTask/);
});
