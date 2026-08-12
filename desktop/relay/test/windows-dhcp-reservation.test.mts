import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function windowsScript(name: string) {
  return readFileSync(new URL(`../windows/${name}`, import.meta.url), "utf8");
}

test("l'assistant DHCP détecte le réseau actif et propose l'IP actuelle à réserver", () => {
  const script = windowsScript("prepare-dhcp-reservation.ps1");
  assert.match(script, /Get-NetRoute/);
  assert.match(script, /Get-NetIPConfiguration/);
  assert.match(script, /Get-NetAdapter/);
  assert.match(script, /MacAddress/);
  assert.match(script, /IpAddress/);
  assert.match(script, /IP a reserver/);
  assert.match(script, /reserved_ip\s*=\s*\$network\.IpAddress/);
});

test("l'assistant DHCP reste non destructif côté adressage Windows", () => {
  const script = windowsScript("prepare-dhcp-reservation.ps1");
  assert.doesNotMatch(script, /New-NetIPAddress/);
  assert.doesNotMatch(script, /Set-NetIPAddress/);
  assert.doesNotMatch(script, /Remove-NetIPAddress/);
  assert.doesNotMatch(script, /Set-DnsClientServerAddress/);
  assert.doesNotMatch(script, /New-NetFirewallRule/);
  assert.match(script, /Windows reste en DHCP automatique/);
});

test("l'assistant produit un plan local et rappelle les règles de sécurité", () => {
  const script = windowsScript("prepare-dhcp-reservation.ps1");
  assert.match(script, /reservation-dhcp-a-configurer\.txt/);
  assert.match(script, /reservation-dhcp-plan\.json/);
  assert.match(script, /Ne pas mettre d'IP statique manuellement dans Windows/);
  assert.match(script, /Ne pas creer de redirection de port 4317 vers Internet/);
  assert.match(script, /meme LAN/);
});

test("le lanceur Windows ouvre l'assistant PowerShell", () => {
  const script = windowsScript("Assistant-Reservation-DHCP.cmd");
  assert.match(script, /prepare-dhcp-reservation\.ps1/);
  assert.match(script, /ExecutionPolicy Bypass/);
});
