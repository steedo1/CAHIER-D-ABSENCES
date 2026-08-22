import { hostname as systemHostname } from "node:os";
import {
  normalizeRelayMdnsHostname,
  startRelayMdns,
} from "./mdns.mjs";
import {
  shouldUseWindowsNativeMdns,
  startWindowsNativeRelayMdns,
} from "./windows-mdns-native.mjs";

export type RelayDiscoveryStartInput = {
  hostname: string;
  port: number;
  institutionCode?: string | null | undefined;
  refreshIntervalMs?: number;
  log?: (message: string) => void;
};

export function relayDiscoveryHostname(
  configuredHostname: string,
  platform = process.platform,
  machineHostname = systemHostname(),
) {
  const configured = normalizeRelayMdnsHostname(configuredHostname);

  if (platform !== "win32") {
    return configured;
  }

  const machine = String(machineHostname || "").trim();

  return machine
    ? normalizeRelayMdnsHostname(machine)
    : configured;
}

export function startRelayDiscovery(
  input: RelayDiscoveryStartInput,
  platform = process.platform,
  machineHostname = systemHostname(),
) {
  const hostname = relayDiscoveryHostname(
    input.hostname,
    platform,
    machineHostname,
  );

  const scopedInput = {
    ...input,
    hostname,
  };

  return shouldUseWindowsNativeMdns(platform)
    ? startWindowsNativeRelayMdns(scopedInput)
    : startRelayMdns(scopedInput);
}