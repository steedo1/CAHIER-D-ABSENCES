// src/app/super/_components/SidebarNav.tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/super/dashboard", icon: "�x��", label: "Tableau de bord" },
  { href: "/super/etablissements", icon: "�x��", label: "�0tablissements" },
  { href: "/super/abonnements", icon: "�x��", label: "Abonnements" },
  { href: "/super/admins", icon: "�x��x�", label: "Admins" },       // (page � venir)
  { href: "/super/parametres", icon: "�a"", label: "Param�tres" }, // (page � venir)
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


