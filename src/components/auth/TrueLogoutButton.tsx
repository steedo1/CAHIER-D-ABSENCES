// src/components/auth/TrueLogoutButton.tsx
"use client";

import { useCallback, useState } from "react";
import { LogOut } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type TrueLogoutButtonProps = {
  className?: string;
  label?: string;
  busyLabel?: string;
};

function clearBrowserStorage() {
  const shouldRemove = (key: string) =>
    key.startsWith("sb-") ||
    key.includes("supabase.auth.token") ||
    key.includes("auth-token");

  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && shouldRemove(key)) keys.push(key);
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Nettoyage tolérant.
  }

  try {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (key && shouldRemove(key)) keys.push(key);
    }
    keys.forEach((key) => window.sessionStorage.removeItem(key));
  } catch {
    // Nettoyage tolérant.
  }
}

function clearReadableCookies() {
  const names = [
    "sb-access-token",
    "sb-refresh-token",
    "mc_last_dest",
    "mc_last_dest_attendance",
    "mc_last_dest_grades",
  ];

  const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(
    /^https:\/\/([^.]+)\.supabase\.co/i
  )?.[1];

  if (projectRef) names.push(`sb-${projectRef}-auth-token`);

  for (const name of names) {
    try {
      document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
    } catch {
      // Ignore.
    }
  }
}

export default function TrueLogoutButton({
  className,
  label = "Se déconnecter",
  busyLabel = "Déconnexion…",
}: TrueLogoutButtonProps) {
  const [busy, setBusy] = useState(false);

  const handleLogout = useCallback(async () => {
    if (busy) return;
    setBusy(true);

    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut().catch(() => {});

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
    } finally {
      clearBrowserStorage();
      clearReadableCookies();
      window.location.replace("/login");
    }
  }, [busy]);

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={busy}
      className={
        className ??
        "inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-70"
      }
    >
      <LogOut className="h-4 w-4" />
      {busy ? busyLabel : label}
    </button>
  );
}
