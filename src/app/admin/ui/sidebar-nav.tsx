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
  ShieldCheck,     // ✅ existant (Conduite + Règles de conduite)
  NotebookPen,     // ✅ (Notes)
  FileSpreadsheet, // ✅ (Bulletins)
} from "lucide-react";
import React from "react";
import type { AppRole } from "@/lib/auth/role";

type NavItem = {
  href: string;
  label: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  badge?: string;
};

function useIsActive(pathname: string | null, href: string) {
  return pathname === href || pathname?.startsWith(href + "/");
}

/* =========================
   Top-level (hors groupes)
========================= */
const BASE_NAV: NavItem[] = [
  { href: "/admin/dashboard", label: "Tableau de bord", Icon: LayoutDashboard },

  // ⭐️ Onglet prédictions IA, très visible et distinctif
  { href: "/admin/notes/predictions", label: "Prédictions de réussite", Icon: BarChart3, badge: "IA" },

  { href: "/admin/classes", label: "Créer vos Classes", Icon: School },
  { href: "/admin/users", label: "Utilisateurs & rôles", Icon: Users },
  { href: "/admin/affectations", label: "Attribution des classes", Icon: Puzzle },
  { href: "/admin/parents", label: "Liste des classes", Icon: UserRoundCheck },
  { href: "/admin/import", label: "Import classes-enseignants", Icon: Inbox, badge: "OCT" },
  // ✅ Nouvel onglet top-level pour l'import des emplois du temps (utilisable pour absences + notes)
  { href: "/admin/import-emplois-du-temps", label: "Import emplois du temps", Icon: Inbox },
  // ✅ Nouvel onglet dédié aux règles de conduite
  { href: "/admin/regles-conduite", label: "Règles de conduite", Icon: ShieldCheck },
  { href: "/admin/parametres", label: "Paramètres", Icon: Settings },
];

/* =========================
   Groupe : Cahier des absences
========================= */
const ABS_ITEMS: NavItem[] = [
  { href: "/admin/absences", label: "Matrice des Absences", Icon: Ban },
  { href: "/admin/assiduite", label: "Assiduité & justifications", Icon: UserRoundCheck },
  { href: "/admin/statistiques", label: "Contrôle Enseignants", Icon: BarChart3 },
  { href: "/admin/absences/appels", label: "Surveillance des appels", Icon: BarChart3 },
  { href: "/admin/conduite", label: "Moyenne de Conduite", Icon: ShieldCheck },
];

/* =========================
   Groupe : Cahier de notes
========================= */
const NOTES_ITEMS: NavItem[] = [
  { href: "/admin/notes", label: "Vue d’ensemble", Icon: NotebookPen },
  { href: "/admin/notes/evaluations", label: "Évaluations", Icon: NotebookPen },
  { href: "/admin/bulletins", label: "Bulletins & moyennes", Icon: FileSpreadsheet },
  { href: "/admin/notes/statistiques", label: "Statistiques", Icon: BarChart3 },
];

export default function SidebarNav() {
  const pathname = usePathname();

  // Rôle courant (pour adapter le menu)
  const [role, setRole] = React.useState<AppRole | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/auth/role", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json().catch(() => ({}));
        if (!cancelled) {
          setRole((j.role ?? null) as AppRole | null);
        }
      } catch {
        if (!cancelled) setRole(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isEducator = role === "educator";

  // Ouverture auto selon l'URL courante
  const [absOpen, setAbsOpen] = React.useState<boolean>(() =>
    !!(
      pathname &&
      (pathname.startsWith("/admin/absences") ||
        pathname.startsWith("/admin/statistiques") ||
        pathname.startsWith("/admin/conduite") ||
        pathname.startsWith("/admin/assiduite"))
    )
  );
  const [notesOpen, setNotesOpen] = React.useState<boolean>(() =>
    pathname?.startsWith("/admin/notes") ?? false
  );

  const absHeaderActive =
    pathname?.startsWith("/admin/absences") ||
    pathname?.startsWith("/admin/statistiques") ||
    pathname?.startsWith("/admin/conduite") ||
    pathname?.startsWith("/admin/assiduite");

  const notesHeaderActive = pathname?.startsWith("/admin/notes");

  // Base nav adaptée au rôle :
  // 👉 Pour un ÉDUCATEUR : on retire les entrées purement "notes" (ex: prédictions IA)
  const topNavItems = React.useMemo(
    () =>
      BASE_NAV.filter(({ href }) => {
        if (isEducator) {
          if (href.startsWith("/admin/notes")) return false;
        }
        return true;
      }),
    [isEducator]
  );

  return (
    <nav className="flex h-full flex-col">
      <ul className="mt-2 flex-1 space-y-1 px-2">
        {/* Top-level items */}
        {topNavItems.map(({ href, label, Icon, badge }) => {
          const active = useIsActive(pathname, href);
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

        {/* ─────────────────────────────
            Groupe pliable : Cahier des absences
        ───────────────────────────── */}
        <li className="mt-2">
          <button
            type="button"
            onClick={() => setAbsOpen((v) => !v)}
            aria-expanded={absOpen}
            className={[
              "w-full select-none rounded-lg px-3 py-2 text-left text-sm",
              "flex items-center gap-3",
              "transition hover:bg-slate-800/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/40",
              absHeaderActive ? "bg-slate-800 text-white" : "text-slate-200",
            ].join(" ")}
          >
            <span
              className={[
                "inline-block h-5 w-5 rotate-0 transition-transform",
                absOpen ? "rotate-90" : "rotate-0",
              ].join(" ")}
              aria-hidden
            >
              {/* caret “>” */}
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5 opacity-70"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
            <Ban className="h-5 w-5 opacity-90" />
            <span className="truncate">Cahier des absences</span>
          </button>

          {absOpen && (
            <ul className="mt-1 space-y-1 pl-8">
              {ABS_ITEMS.map(({ href, label, Icon }) => {
                const active = useIsActive(pathname, href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      prefetch={false}
                      aria-current={active ? "page" : undefined}
                      className={[
                        "relative flex items-center gap-2 rounded-md px-3 py-2 text-sm",
                        "transition hover:bg-slate-800/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/40",
                        active ? "bg-slate-800 text-white" : "text-slate-300",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "absolute left-0 my-1 h-[calc(100%-0.5rem)] w-1 rounded-r-full",
                          active ? "bg-emerald-500" : "bg-transparent",
                        ].join(" ")}
                      />
                      <Icon className="h-4 w-4 shrink-0 opacity-90" />
                      <span className="truncate">{label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </li>

        {/* ─────────────────────────────
            Groupe pliable : Cahier de notes
            👉 Masqué pour les ÉDUCATEURS
        ───────────────────────────── */}
        {!isEducator && (
          <li className="mt-2">
            <button
              type="button"
              onClick={() => setNotesOpen((v) => !v)}
              aria-expanded={notesOpen}
              className={[
                "w-full select-none rounded-lg px-3 py-2 text-left text-sm",
                "flex items-center gap-3",
                "transition hover:bg-slate-800/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/40",
                notesHeaderActive ? "bg-slate-800 text-white" : "text-slate-200",
              ].join(" ")}
            >
              <span
                className={[
                  "inline-block h-5 w-5 rotate-0 transition-transform",
                  notesOpen ? "rotate-90" : "rotate-0",
                ].join(" ")}
                aria-hidden
              >
                {/* caret “>” */}
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5 opacity-70"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </span>
              <NotebookPen className="h-5 w-5 opacity-90" />
              <span className="truncate">Cahier de notes</span>
            </button>

            {notesOpen && (
              <ul className="mt-1 space-y-1 pl-8">
                {NOTES_ITEMS.map(({ href, label, Icon }) => {
                  const active = useIsActive(pathname, href);
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        prefetch={false}
                        aria-current={active ? "page" : undefined}
                        className={[
                          "relative flex items-center gap-2 rounded-md px-3 py-2 text-sm",
                          "transition hover:bg-slate-800/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/40",
                          active ? "bg-slate-800 text-white" : "text-slate-300",
                        ].join(" ")}
                      >
                        <span
                          className={[
                            "absolute left-0 my-1 h-[calc(100%-0.5rem)] w-1 rounded-r-full",
                            active ? "bg-violet-500" : "bg-transparent",
                          ].join(" ")}
                        />
                        <Icon className="h-4 w-4 shrink-0 opacity-90" />
                        <span className="truncate">{label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        )}
      </ul>

      {/* ✅ Signature Nexa Digitale en bas du menu admin */}
      <div className="px-4 py-3 text-[11px] text-slate-500">
        <div>© {new Date().getFullYear()} Mon Cahier</div>
        <div className="text-[10px] text-slate-400">
          Conçu et développé par{" "}
          <span className="font-semibold text-slate-200">NEXA DIGITALE SARL</span>
        </div>
      </div>
    </nav>
  );
}
