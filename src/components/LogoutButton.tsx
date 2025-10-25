// src/components/auth/LogoutButton.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";

export function LogoutButton() {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    if (busy) return;
    setBusy(true);
    try {
      // 1) Déconnecte côté client (localStorage + mémoire SDK)
      try {
        await supabase.auth.signOut();
      } catch {}

      // 2) Purge les cookies SSR (sb-access / sb-refresh / sb-<project>-auth-token)
      try {
        await fetch("/api/auth/sync", { method: "DELETE" });
      } catch {}

      // 3) Redirection vers /login
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
