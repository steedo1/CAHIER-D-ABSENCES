"use client";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";

export function LogoutButton() {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  return (
    <button
      onClick={async () => {
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
      }}
      className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50"
    >
      Se dÃ©connecter
    </button>
  );
}
