// src/components/auth/LogoutButton.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const supRef = useRef<SupabaseClient | null>(null);

  // Crée le client uniquement dans le navigateur
  useEffect(() => {
    supRef.current = getSupabaseBrowserClient();
  }, []);

  async function handleLogout() {
    if (busy) return;
    setBusy(true);
    try {
      const supabase = supRef.current ?? getSupabaseBrowserClient();

      // 1) Déconnecte côté client (localStorage + mémoire SDK)
      await supabase.auth.signOut().catch(() => {});

      // 2) Purge cookies SSR
      await fetch("/api/auth/sync", { method: "DELETE", cache: "no-store" }).catch(() => {});

      // 3) Redirection
      router.replace("/login");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={busy}
      aria-busy={busy}
      className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60"
      title="Se déconnecter"
    >
      {busy ? "Déconnexion…" : "Se déconnecter"}
    </button>
  );
}
