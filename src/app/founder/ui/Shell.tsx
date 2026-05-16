// src/app/founder/ui/Shell.tsx
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  CalendarDays,
  ChevronRight,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import InstallAndPushCTA from "@/components/InstallAndPushCTA";
import TrueLogoutButton from "@/components/auth/TrueLogoutButton";

const NAV = [
  {
    href: "/founder/dashboard",
    label: "Vue globale",
    description: "Synthèse multi-écoles",
    Icon: BarChart3,
  },
  {
    href: "/founder/attendance-slots",
    label: "Vue créneau",
    description: "Appels et créneaux",
    Icon: CalendarDays,
  },
  {
    href: "/founder/finance",
    label: "Finance",
    description: "Encaissements et dépenses",
    Icon: Wallet,
  },
];

export default function FounderShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white shadow-sm">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-black text-slate-950 sm:text-base">
                Mon Cahier
              </div>
              <div className="truncate text-xs font-semibold text-slate-500 sm:text-sm">
                Espace Fondateur · Multi-écoles
              </div>
            </div>
          </div>

          <div className="shrink-0">
            <TrueLogoutButton label="Se déconnecter" />
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-3 py-5 sm:px-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-7 lg:py-7">
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <nav className="rounded-[28px] border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between px-3 pb-3 pt-2">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                  Fondateur
                </div>
                <div className="mt-1 text-xs font-semibold text-slate-500">
                  Pilotage consolidé
                </div>
              </div>
              <div className="grid h-9 w-9 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                <ShieldCheck className="h-4 w-4" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1">
              {NAV.map(({ href, label, description, Icon }) => {
                const active = pathname === href || pathname.startsWith(`${href}/`);

                return (
                  <Link
                    key={href}
                    href={href}
                    className={[
                      "group flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-bold transition",
                      active
                        ? "bg-slate-950 text-white shadow-sm"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-950",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "grid h-10 w-10 shrink-0 place-items-center rounded-2xl transition",
                        active ? "bg-white/10 text-white" : "bg-slate-100 text-slate-600 group-hover:bg-white",
                      ].join(" ")}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{label}</span>
                      <span
                        className={[
                          "mt-0.5 hidden truncate text-xs font-semibold sm:block",
                          active ? "text-slate-200" : "text-slate-400",
                        ].join(" ")}
                      >
                        {description}
                      </span>
                    </span>
                    <ChevronRight
                      className={[
                        "hidden h-4 w-4 shrink-0 transition lg:block",
                        active ? "text-white" : "text-slate-300 group-hover:text-slate-500",
                      ].join(" ")}
                    />
                  </Link>
                );
              })}
            </div>
          </nav>

          <InstallAndPushCTA />

          <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
              Rôle
            </div>
            <div className="mt-2 text-sm font-black text-slate-950">
              Fondateur multi-écoles
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Vue consolidée des établissements rattachés, des créneaux et des mouvements financiers.
            </p>
          </div>
        </aside>

        <main className="min-w-0 pb-10">{children}</main>
      </div>
    </div>
  );
}
