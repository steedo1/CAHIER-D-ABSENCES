import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function windowsScript(name: string) {
  return readFileSync(new URL(`../windows/${name}`, import.meta.url), "utf8");
}

test("l'installation configure un redémarrage SYSTEM au boot avec reprises", () => {
  const installer = windowsScript("install-startup-task.ps1");
  assert.match(installer, /New-ScheduledTaskTrigger\s+-AtStartup/);
  assert.match(installer, /-UserId\s+"SYSTEM"\s+-LogonType\s+ServiceAccount/);
  assert.match(installer, /-RestartCount\s+10/);
  assert.match(installer, /-RestartInterval\s+\(New-TimeSpan\s+-Minutes\s+1\)/);
  assert.match(installer, /Remove-Item\s+-LiteralPath\s+\$StartupShortcut/);
  assert.match(installer, /Register-ScheduledTask/);
});

test("la tâche de boot transmet des chemins explicites et non le profil SYSTEM", () => {
  const installer = windowsScript("install-startup-task.ps1");
  const runner = windowsScript("start-relay-at-boot.ps1");
  assert.match(installer, /-ConfigPath/);
  assert.match(installer, /-LogDirectory/);
  assert.match(runner, /MONCAHIER_RELAY_CONFIG\s*=\s*\$ResolvedConfigPath/);
  assert.match(runner, /MONCAHIER_RELAY_LOG_DIR\s*=\s*\$LogDirectory/);
  assert.doesNotMatch(runner, /\$env:LOCALAPPDATA/);
});
