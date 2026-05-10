// src/app/drenaet/ui/shell.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  ClipboardList,
  FileDown,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";

const NAV = [
  { href: "/drenaet/dashboard", label: "Tableau de bord", Icon: LayoutDashboard },
  { href: "/drenaet/etablissements", label: "Établissements", Icon: Building2 },
  { href: "/drenaet/assiduite", label: "Assiduité élèves", Icon: UsersRound },
  { href: "/drenaet/presence-enseignants", label: "Présence enseignants", Icon: ClipboardList },
  { href: "/drenaet/rapports", label: "Rapports", Icon: FileDown },
];

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-full flex-col bg-slate-950 text-white">
      <div className="border-b border-white/10 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-400/15 ring-1 ring-emerald-300/25">
            <ShieldCheck className="h-5 w-5 text-emerald-200" />
          </div>
          <div>
            <p className="text-sm font-black tracking-tight">Mon Cahier</p>
            <p className="text-xs font-semibold text-slate-300">Console DRENAET</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
        {NAV.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={[
                "flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold transition",
                active
                  ? "bg-white text-slate-950 shadow-lg shadow-black/20"
                  : "text-slate-200 hover:bg-white/10 hover:text-white",
              ].join(" ")}
            >
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-4">
        <div className="rounded-3xl bg-white/10 p-4 ring-1 ring-white/10">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-100">
            <BarChart3 className="h-4 w-4" />
            Pilotage régional
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-300">
            Lecture seule : suivi des établissements, assiduité, présence enseignants et rapports.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function DrenaetShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="grid min-h-screen lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-screen lg:block">
          <NavContent />
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm lg:hidden"
                  aria-label="Ouvrir le menu"
                >
                  <Menu className="h-5 w-5" />
                </button>
                <div>
                  <p className="text-sm font-black text-slate-950">Supervision régionale</p>
                  <p className="text-xs text-slate-500">DRENAET · Données consolidées en lecture seule</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="hidden rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200 sm:inline-flex">
                  Accès sécurisé
                </span>
                <Link
                  href="/logout"
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden sm:inline">Déconnexion</span>
                </Link>
              </div>
            </div>
          </header>

          <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Fermer"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-[min(86vw,360px)] shadow-2xl">
            <div className="absolute right-3 top-3 z-10">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full bg-white/10 p-2 text-white ring-1 ring-white/20"
                aria-label="Fermer le menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <NavContent onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
