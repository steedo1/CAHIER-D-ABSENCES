// src/app/super/ui/Shell.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/super/dashboard", label: "Tableau de bord", icon: "ðŸ " },
  // on garde cette page comme outil de création (ton écran actuel)
  { href: "/super/etablissements", label: "Créer un abonnement", icon: "ðŸ§©" },
  // âž• nouvel onglet : liste paginée + suppression
  { href: "/super/etablissements/liste", label: "Liste des établissements", icon: "ðŸ“‹" },
  { href: "/super/abonnements", label: "Mes abonnements", icon: "ðŸ§¾" },
  { href: "/super/admins", label: "Liste des admins", icon: "ðŸ§‘â€ðŸ’¼" },
  { href: "/super/parametres", label: "Paramètres", icon: "âš™ï¸" },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-700">Mon Cahier d’Absences</span>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
              Super Admin
            </span>
          </div>
          <Link href="/logout" className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">
            Se déconnecter
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-12 gap-6 px-4 py-6">
        <aside className="col-span-12 md:col-span-3">
          <nav className="rounded-xl border bg-white p-3">
            <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Navigation</div>
            <ul className="space-y-1">
              {NAV.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={[
                        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                        active ? "bg-violet-600 text-white" : "text-slate-700 hover:bg-slate-50",
                      ].join(" ")}
                    >
                      <span className="text-base">{item.icon}</span>
                      <span>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        <main className="col-span-12 md:col-span-9">{children}</main>
      </div>
    </div>
  );
}


