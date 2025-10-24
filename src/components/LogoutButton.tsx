"use client";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";

export function LogoutButton() {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  return (
    <button
      onClick={async () => {
        await supabase.auth.signOut();
        try {
          await fetch("/api/auth/sync", { method: "DELETE", credentials: "include" });
        } catch {}
        router.replace("/login");
      }}
      className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50"
    >
      Se déconnecter
    </button>
  );
}
