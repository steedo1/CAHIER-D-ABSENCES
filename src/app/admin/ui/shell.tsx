"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, LayoutDashboard, Ban, NotebookPen, Settings } from "lucide-react";
import { LogoutButton } from "@/components/LogoutButton";
import SidebarNav from "./sidebar-nav";
import ContactUsButton from "@/components/ContactUsButton";

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  function isActive(href: string) {
    return pathname === href || (pathname ?? "").startsWith(href + "/");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ─────────────────────────────
          Drawer mobile (sidebar complète)
      ───────────────────────────── */}
      <div
        className={[
          "fixed inset-0 z-50 bg-black/40 transition-opacity md:hidden",
          mobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        ].join(" ")}
      >
        <div
          className={[
            "absolute left-0 top-0 h-full w-[min(88vw,420px)] bg-slate-900 shadow-xl",
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
            <SidebarNav />
          </div>
        </div>

        {/* Clic sur le fond → ferme le drawer */}
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
      <div className="grid md:grid-cols-[auto_minmax(0,1fr)]">
        {/* Sidebar desktop */}
        <aside className="sticky top-0 hidden h-screen bg-slate-900 md:block">
          <div className="h-full overflow-y-auto scrollbar-thin scrollbar-track-slate-900 scrollbar-thumb-slate-700/70">
            <SidebarNav />
          </div>
        </aside>

        <div className="min-h-screen min-w-0">
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

                <span className="text-sm font-semibold tracking-tight">Mon Cahier</span>

                {/* Tagline masquée sur très petit écran pour un rendu plus "app" */}
                <span className="hidden rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold ring-1 ring-white/20 sm:inline-flex">
                  Absences &amp; notes · Admin établissement
                </span>
              </div>

              <div className="flex items-center gap-2">
                <ContactUsButton variant="chip" />

                <div className="rounded-full bg-white/10 px-2 py-1 ring-1 ring-white/20 hover:bg-white/15">
                  <LogoutButton />
                </div>
              </div>
            </div>
          </header>

          {/* Contenu principal */}
          <main className="mx-auto max-w-7xl px-4 py-6 pb-20 md:pb-8">{children}</main>

          {/* ─────────────────────────────
              MENU MOBILE EN BAS (style app / Ecolemedia)
          ───────────────────────────── */}
          <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 shadow-[0_-4px_12px_rgba(15,23,42,0.12)] backdrop-blur md:hidden">
            <div className="mx-auto flex max-w-7xl items-stretch justify-between">
              {[
                {
                  href: "/admin/dashboard",
                  label: "Accueil",
                  Icon: LayoutDashboard,
                },
                {
                  href: "/admin/absences",
                  label: "Absences",
                  Icon: Ban,
                },
                {
                  href: "/admin/notes",
                  label: "Notes",
                  Icon: NotebookPen,
                },
                {
                  href: "/admin/parametres",
                  label: "Paramètres",
                  Icon: Settings,
                },
              ].map(({ href, label, Icon }) => {
                const active = isActive(href);

                return (
                  <Link
                    key={href}
                    href={href}
                    className={[
                      "flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[11px]",
                      "transition-colors",
                      active
                        ? "font-semibold text-emerald-700"
                        : "text-slate-500 hover:text-slate-800",
                    ].join(" ")}
                  >
                    <div
                      className={[
                        "flex h-9 w-9 items-center justify-center rounded-full border text-xs",
                        active
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-slate-200 bg-slate-50",
                      ].join(" ")}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="truncate">{label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      </div>
    </div>
  );
}