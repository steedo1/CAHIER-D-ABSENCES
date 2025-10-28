// src/app/super/_components/SidebarNav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  BadgeDollarSign,
  Users,
  Settings,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

const items: NavItem[] = [
  { href: "/super/dashboard",        label: "Tableau de bord", Icon: LayoutDashboard },
  { href: "/super/etablissements",   label: "Etablissements",  Icon: Building2 },
  { href: "/super/abonnements",      label: "Abonnements",     Icon: BadgeDollarSign },
  { href: "/super/admins",           label: "Admins",          Icon: Users },
  { href: "/super/parametres",       label: "Parametres",      Icon: Settings },
];

export default function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="rounded-2xl border bg-white p-3">
      <div className="mb-2 px-2 text-xs font-semibold text-slate-500">NAVIGATION</div>
      <div className="space-y-1">
        {items.map(({ href, label, Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={
                "flex items-center gap-2 rounded-xl px-3 py-2 text-sm " +
                (active
                  ? "bg-violet-600 text-white"
                  : "text-slate-700 hover:bg-slate-50")
              }
            >
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
