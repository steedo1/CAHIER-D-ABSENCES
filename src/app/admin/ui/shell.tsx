// src/app/admin/ui/shell.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { LogoutButton } from "@/components/LogoutButton";
import SidebarNav from "./sidebar-nav";
import ContactUsButton from "@/components/ContactUsButton";

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ─────────────────────────────
          Drawer mobile (sidebar)
      ───────────────────────────── */}
      <div
        className={[
          "fixed inset-0 z-50 bg-black/40 transition-opacity md:hidden",
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        ].join(" ")}
      >
        <div
          className={[
            "absolute left-0 top-0 h-full w-72 max-w-[80%] bg-slate-900 shadow-xl",
            "transform transition-transform",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          ].join(" ")}
        >
          {/* Header du drawer */}
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <span className="text-sm font-semibold text-white">Navigation</span>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="rounded-full bg-white/10 p-1.5 text-slate-100 hover:bg-white/15"
              aria-label="Fermer le menu"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="h-[calc(100%-3rem)] overflow-y-auto">
            {/* ✅ On réutilise exactement le même menu */}
            <SidebarNav />
          </div>
        </div>

        {/* Cliquer sur le fond ferme le drawer */}
        <button
          type="button"
          className="h-full w-full cursor-default"
          onClick={() => setMobileOpen(false)}
          aria-label="Fermer le menu"
        />
      </div>

      {/* ─────────────────────────────
          Layout principal
      ───────────────────────────── */}
      <div className="grid md:grid-cols-[250px_1fr]">
        {/* Sidebar desktop */}
        <aside className="sticky top-0 hidden h-screen bg-slate-900 md:block">
          <div className="h-full overflow-y-auto scrollbar-thin scrollbar-track-slate-900 scrollbar-thumb-slate-700/70">
            <SidebarNav />
          </div>
        </aside>

        <div className="min-h-screen">
          {/* HEADER BLEU NUIT */}
          <header className="sticky top-0 z-40 border-b border-blue-900/60 bg-blue-950 text-white ring-1 ring-blue-800/40">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                {/* Bouton menu mobile */}
                <button
                  type="button"
                  onClick={() => setMobileOpen(true)}
                  className="mr-1 inline-flex items-center justify-center rounded-full bg-white/10 p-2 ring-1 ring-white/20 hover:bg-white/15 md:hidden"
                  aria-label="Ouvrir le menu"
                >
                  <Menu className="h-4 w-4" />
                </button>

                <span className="text-sm font-medium tracking-tight">Mon Cahier</span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold ring-1 ring-white/20">
                  Absences &amp; notes · Admin établissement
                </span>
              </div>

              <div className="flex items-center gap-2">
                {/* 🔥 Raccourci Assiduité toujours visible */}
                <Link
                  href="/admin/assiduite"
                  className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold ring-1 ring-white/20 hover:bg-white/15"
                >
                  Assiduité
                </Link>

                {/* Conduite */}
                <Link
                  href="/admin/conduite"
                  className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold ring-1 ring-white/20 hover:bg-white/15"
                >
                  Conduite
                </Link>

                <ContactUsButton variant="chip" />

                <div className="rounded-full bg-white/10 px-2 py-1 ring-1 ring-white/20 hover:bg-white/15">
                  <LogoutButton />
                </div>
              </div>
            </div>
          </header>

          <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
