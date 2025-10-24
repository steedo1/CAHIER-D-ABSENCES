//src/app/logout/page.tsx
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function LogoutPage() {
  const router = useRouter();
  const did = useRef(false);

  useEffect(() => {
    if (did.current) return;
    did.current = true;

    (async () => {
      const supabase = getSupabaseBrowserClient();

      // 1) Vide localStorage + mémoire du SDK
      try {
        await supabase.auth.signOut();
      } catch {}

      // 2) Supprime tous les cookies SSR (sb-access, sb-refresh, sb-<project>-auth-token)
      try {
        await fetch("/api/auth/sync", { method: "DELETE", credentials: "include" });
      } catch {}

      // 3) Redirige vers /login
      router.replace("/login");
    })();
  }, [router]);

  return <main className="p-6">Déconnexion…</main>;
}
