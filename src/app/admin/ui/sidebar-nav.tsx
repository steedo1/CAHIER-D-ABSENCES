// src/app/admin/ui/sidebar-nav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Ban,
  School,
  Users,
  Puzzle,
  UserRoundCheck,
  Inbox,
  BarChart3,
  Settings,
  ShieldCheck, // ✅ icône
} from "lucide-react";
import type React from "react";

type NavItem = {
  href: string;
  label: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  badge?: string;
};

const NAV: NavItem[] = [
  { href: "/admin/dashboard", label: "Tableau de bord", Icon: LayoutDashboard },
  { href: "/admin/absences", label: "Absences (Dashboard)", Icon: Ban },
  { href: "/admin/classes", label: "Classes", Icon: School },
  { href: "/admin/users", label: "Enseignants", Icon: Users },
  { href: "/admin/affectations", label: "Affectations classes", Icon: Puzzle },
  { href: "/admin/parents", label: "Parents", Icon: UserRoundCheck },
  { href: "/admin/import", label: "Import", Icon: Inbox, badge: "OCT" },
  { href: "/admin/statistiques", label: "Statistiques", Icon: BarChart3 },
  { href: "/admin/conduite", label: "Conduite", Icon: ShieldCheck }, // ✅ nouveau
  { href: "/admin/parametres", label: "Paramètres", Icon: Settings },
];

export default function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex h-full flex-col">
      {/* ... entête inchangé ... */}
      <ul className="mt-2 flex-1 space-y-1 px-2">
        {NAV.map(({ href, label, Icon, badge }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <li key={href}>
              <Link
                href={href}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                className={[
                  "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm",
                  "transition hover:bg-slate-800/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/40",
                  active ? "bg-slate-800 text-white" : "text-slate-200",
                ].join(" ")}
              >
                <span
                  className={[
                    "absolute left-0 my-1 h-[calc(100%-0.5rem)] w-1.5 rounded-r-full",
                    active ? "bg-emerald-500" : "bg-transparent",
                  ].join(" ")}
                />
                <Icon className="h-5 w-5 shrink-0 opacity-90" />
                <span className="truncate">{label}</span>
                {badge && (
                  <span className="ml-auto rounded-full bg-emerald-600/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-300 ring-1 ring-emerald-700/40">
                    {badge}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="px-4 py-3 text-[11px] text-slate-500">© {new Date().getFullYear()}</div>
    </nav>
  );
}
