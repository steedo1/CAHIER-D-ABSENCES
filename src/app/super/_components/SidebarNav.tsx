"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/super/dashboard",      icon: "🏠",  label: "Tableau de bord" },
  { href: "/super/etablissements", icon: "🏫",  label: "Établissements" },
  { href: "/super/abonnements",    icon: "🧾",  label: "Abonnements" },
  { href: "/super/admins",         icon: "🧑‍💼", label: "Admins" },       // (page à venir)
  { href: "/super/parametres",     icon: "⚙️",  label: "Paramètres" },    // (page à venir)
];

export default function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="rounded-2xl border bg-white p-3">
      <div className="px-2 mb-2 text-xs font-semibold text-slate-500">NAVIGATION</div>
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
              <span aria-hidden="true">{it.icon}</span>
              <span>{it.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
