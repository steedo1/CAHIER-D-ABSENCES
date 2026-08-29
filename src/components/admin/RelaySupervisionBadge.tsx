"use client";

import Link from "next/link";
import { ServerCog } from "lucide-react";
import { useEffect, useState } from "react";
import { readAdminRelayCapability } from "@/lib/admin-relay-capability";
import {
  probeRelayHealth,
  type RelayHealthProbe,
} from "@/lib/relay-supervision";

function labelFor(probe: RelayHealthProbe | null) {
  if (!probe) return "Relais : vérification…";
  if (!probe.reachable) return "Relais : non détecté";
  if (!probe.data_ready) return "Relais : préparation";
  return "Relais : prêt";
}

function classesFor(probe: RelayHealthProbe | null) {
  if (!probe) return "border-slate-200 bg-white text-slate-600";
  if (!probe.reachable) return "border-rose-200 bg-rose-50 text-rose-700";
  if (!probe.data_ready) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

export default function RelaySupervisionBadge() {
  const [enabled, setEnabled] = useState(false);
  const [probe, setProbe] = useState<RelayHealthProbe | null>(null);

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;

    void readAdminRelayCapability().then((relayEnabled) => {
      if (cancelled || !relayEnabled) return;
      setEnabled(true);
      controller = new AbortController();
      void probeRelayHealth(controller.signal).then((result) => {
        if (!cancelled && !controller?.signal.aborted) setProbe(result);
      });
    });

    return () => {
      cancelled = true;
      controller?.abort();
    };
  }, []);

  if (!enabled) return null;

  return (
    <Link
      href="/admin/relais"
      title="Ouvrir la supervision Mon Cahier Relais"
      className={`fixed bottom-4 right-24 z-40 hidden items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur md:flex ${classesFor(probe)}`}
    >
      <ServerCog className="h-4 w-4" aria-hidden="true" />
      <span>{labelFor(probe)}</span>
    </Link>
  );
}
