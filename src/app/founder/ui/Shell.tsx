// src/app/founder/ui/Shell.tsx
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Building2, CalendarDays, LogOut, Wallet } from "lucide-react";

const NAV = [
  { href: "/founder/dashboard", label: "Vue globale", Icon: BarChart3 },
  { href: "/founder/attendance-slots", label: "Vue créneau", Icon: CalendarDays },
  { href: "/founder/finance", label: "Finance", Icon: Wallet },
];

export default function FounderShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-950 text-white shadow-sm">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-black text-slate-950">Mon Cahier</div>
              <div className="text-xs font-semibold text-slate-500">Espace Fondateur · Multi-écoles</div>
            </div>
          </div>

          <Link href="/logout" className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
            <LogOut className="h-4 w-4" />
            Sortir
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <nav className="rounded-[28px] border border-slate-200 bg-white p-3 shadow-sm">
            <div className="px-3 pb-3 pt-2 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
              Fondateur
            </div>
            <div className="space-y-1">
              {NAV.map(({ href, label, Icon }) => {
                const active = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={[
                      "flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-bold transition",
                      active
                        ? "bg-slate-950 text-white shadow-sm"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-950",
                    ].join(" ")}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
        </aside>

        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
