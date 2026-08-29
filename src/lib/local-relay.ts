"use client";

export * from "@/lib/local-relay-core";

import { syncRelayBootstrap as syncRelayBootstrapCore } from "@/lib/local-relay-core";
import { isRelayFallbackAllowed } from "@/lib/relay-capability-client";

/**
 * Point d'entrée public de la synchronisation relais.
 *
 * Le simple fait qu'un service réponde sur localhost ne suffit jamais à
 * autoriser le relais. L'établissement doit avoir reçu explicitement la
 * capacité relais depuis le Cloud. Sans cette capacité, aucun probe local,
 * aucun snapshot et aucun état "synchronisation relais" ne sont déclenchés.
 */
export async function syncRelayBootstrap(
  input?: Parameters<typeof syncRelayBootstrapCore>[0],
): Promise<Awaited<ReturnType<typeof syncRelayBootstrapCore>>> {
  if (!isRelayFallbackAllowed()) return "absent";
  return await syncRelayBootstrapCore(input);
}
