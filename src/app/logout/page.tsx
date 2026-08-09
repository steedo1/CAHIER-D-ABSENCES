// src/app/logout/page.tsx
"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { clearActiveOfflineAccess } from "@/lib/offline-auth-client";

export const dynamic = "force-dynamic";

function clearLocalAuthStorage() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (
        key.startsWith("sb-") ||
        key.includes("supabase.auth.token") ||
        key.includes("auth-token")
      ) {
        keys.push(key);
      }
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Tolérant.
  }

  try {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (!key) continue;
      if (
        key.startsWith("sb-") ||
        key.includes("supabase.auth.token") ||
        key.includes("auth-token")
      ) {
        keys.push(key);
      }
    }
    keys.forEach((key) => window.sessionStorage.removeItem(key));
  } catch {
    // Tolérant.
  }
}

export default function LogoutPage() {
  const did = useRef(false);

  useEffect(() => {
    if (did.current) return;
    did.current = true;

    (async () => {
      const supabase = getSupabaseBrowserClient();

      // 1) Déconnexion SDK navigateur.
      await supabase.auth.signOut().catch(() => {});

      // 2) Nettoyage cookies SSR / cookies de compatibilité.
      await Promise.allSettled([
        fetch("/api/auth/sync", {
          method: "DELETE",
          cache: "no-store",
          credentials: "include",
        }),
        fetch("/api/auth/signout", {
          method: "POST",
          cache: "no-store",
          credentials: "include",
        }),
      ]);

      // 3) Ferme la session hors ligne active sans révoquer l'appareil autorisé.
      await clearActiveOfflineAccess().catch(() => {});

      // 4) Les cartes admin préparées restent sur l'appareil autorisé afin de
      // permettre une reconnexion hors ligne. Seule la session active est fermée.

      // 5) Nettoyage local supplémentaire pour éviter les restes après reconnexion.
      clearLocalAuthStorage();

      // 6) Navigation complète vers login pour éviter les caches client.
      window.location.replace("/login");
    })();
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-[28px] border border-slate-200 bg-white p-6 text-center shadow-xl">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-[#003766]" />
        <h1 className="text-xl font-black text-slate-950">Déconnexion…</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Nettoyage sécurisé de la session en cours.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-flex items-center justify-center rounded-2xl bg-[#003766] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#002b50]"
        >
          Retour à la connexion
        </Link>
      </div>
    </main>
  );
}
