// src/app/super/_components/SidebarNav.tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/super/dashboard", icon: "ðŸ ", label: "Tableau de bord" },
  { href: "/super/etablissements", icon: "ðŸ«", label: "Ã‰tablissements" },
  { href: "/super/abonnements", icon: "ðŸ§¾", label: "Abonnements" },
  { href: "/super/admins", icon: "ðŸ§‘â€ðŸ’¼", label: "Admins" },       // (page Ã  venir)
  { href: "/super/parametres", icon: "âš™ï¸", label: "Paramètres" }, // (page Ã  venir)
];

export default function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="rounded-2xl border bg-white p-3">
      <div className="text-xs font-semibold text-slate-500 px-2 mb-2">NAVIGATION</div>
      <div className="space-y-1">
        {items.map((it) => {
          const active = pathname.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={
                "flex items-center gap-2 rounded-xl px-3 py-2 text-sm " +
                (active ? "bg-violet-600 text-white" : "hover:bg-slate-50")
              }
            >
              <span>{it.icon}</span>
              <span>{it.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}


