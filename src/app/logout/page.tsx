// src/app/logout/page.tsx
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

      // 1) Déconnexion SDK (cache + localStorage)
      try {
        await supabase.auth.signOut();
      } catch {}

      // 2) Nettoyage cookies SSR (fire-and-forget, sans credentials)
      try {
        fetch("/api/auth/sync", { method: "DELETE" }).catch(() => {});
      } catch {}

      // 3) Redirection vers /login
      router.replace("/login");
    })();
  }, [router]);

  return <main className="p-6">Déconnexion…</main>;
}
