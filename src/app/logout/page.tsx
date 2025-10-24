//src/app/logout/page.tsx
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";

export default function LogoutPage() {
  const router = useRouter();
  const did = useRef(false);

  useEffect(() => {
    if (did.current) return;
    did.current = true;

    (async () => {
      const supabase = getSupabaseBrowserClient();

      try {
        await supabase.auth.signOut();
      } catch {}

      try {
        await fetch("/api/auth/sync", {
          method: "DELETE",
          credentials: "include",
        });
      } catch {}

      router.replace("/login?from=logout");
    })();
  }, [router]);

  return <main className="p-6">DÃ©connexionâ€¦</main>;
}
