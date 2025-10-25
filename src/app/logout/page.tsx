// src/app/logout/page.tsx
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export const dynamic = "force-dynamic";

export default function LogoutPage() {
  const router = useRouter();
  const did = useRef(false);

  useEffect(() => {
    if (did.current) return;
    did.current = true;

    (async () => {
      const supabase = getSupabaseBrowserClient();

      // 1) Déconnexion SDK (cache + localStorage)
      const signout = supabase.auth.signOut().catch(() => {});

      // 2) Nettoyage cookies SSR (même origine)
      const unsync = fetch("/api/auth/sync", { method: "DELETE", cache: "no-store" }).catch(() => {});

      await Promise.allSettled([signout, unsync]);

      // 3) Redirection vers /login
      router.replace("/login");
    })();
  }, [router]);

  return <main className="p-6">Déconnexion…</main>;
}
