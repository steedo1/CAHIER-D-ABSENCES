"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BookOpenCheck,
  FileSpreadsheet,
  FileText,
  Inbox,
  Menu,
  NotebookPen,
  Puzzle,
  School,
  Settings,
  ShieldCheck,
  UserRoundCheck,
  Users,
  X,
} from "lucide-react";
import { LogoutButton } from "@/components/LogoutButton";

type NavItem = {
  href: string;
  label: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  allowSubpaths?: boolean;
};

type NavGroup = {
  title: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  items: NavItem[];
};

const DEFAULT_ROUTE = "/admin/export-moyennes";

const GROUPS: NavGroup[] = [
  {
    title: "Correspondant fichier",
    Icon: FileSpreadsheet,
    items: [
      { href: "/admin/export-moyennes", label: "Export DESPS", Icon: FileSpreadsheet },
      { href: "/admin/notes/conseil-classe", label: "Conseil de classe", Icon: FileText },
      { href: "/admin/bulletins", label: "Bulletins", Icon: FileSpreadsheet, allowSubpaths: true },
      { href: "/admin/notes/bilan", label: "Bilan trimestriel / annuel", Icon: FileText },
      { href: "/admin/notes/matrices", label: "Matrices trimestrielles", Icon: FileSpreadsheet },
      { href: "/admin/notes/matrice-annuelle", label: "Matrice annuelle", Icon: FileSpreadsheet },
      { href: "/admin/notes/non-classes", label: "Élèves non classés", Icon: UserRoundCheck },
    ],
  },
  {
    title: "Organisation scolaire",
    Icon: School,
    items: [
      {
        href: "/admin/organisation-pedagogique",
        label: "Organisation pédagogique",
        Icon: BookOpenCheck,
        allowSubpaths: true,
      },
      { href: "/admin/classes", label: "Créer vos classes", Icon: School, allowSubpaths: true },
      { href: "/admin/users", label: "Utilisateurs & rôles", Icon: Users },
      { href: "/admin/affectations", label: "Attribution des classes", Icon: Puzzle, allowSubpaths: true },
      { href: "/admin/parents", label: "Liste des classes", Icon: UserRoundCheck, allowSubpaths: true },
      { href: "/admin/import", label: "Import classes-enseignants", Icon: Inbox, allowSubpaths: true },
      { href: "/admin/import-emplois-du-temps", label: "Emploi du temps", Icon: Inbox, allowSubpaths: true },
      { href: "/admin/notes/predictions", label: "Prédiction de réussite", Icon: NotebookPen, allowSubpaths: true },
    ],
  },
  {
    title: "Paramètres",
    Icon: Settings,
    items: [
      { href: "/admin/relais", label: "Mon Cahier Relais", Icon: Settings, allowSubpaths: true },
      { href: "/admin/parametres?tab=security", label: "Accès & sécurité", Icon: ShieldCheck },
      { href: "/admin/parametres?tab=school", label: "Établissement & horaires", Icon: School },
      { href: "/admin/parametres?tab=academic-years", label: "Années scolaires", Icon: NotebookPen },
      { href: "/admin/parametres?tab=grading-periods", label: "Périodes d’évaluation", Icon: FileText },
      { href: "/admin/parametres?tab=rapport-f", label: "Rapport F", Icon: FileSpreadsheet },
      { href: "/admin/parametres?tab=coefficients", label: "Coefficients & sous-matières", Icon: FileSpreadsheet },
    ],
  },
];

function hrefPath(href: string) {
  return href.split("?")[0] || href;
}

function itemAllowsPath(item: NavItem, pathname: string) {
  const path = hrefPath(item.href);
  if (pathname === path) return true;
  return Boolean(item.allowSubpaths && pathname.startsWith(`${path}/`));
}

function isAllowedPath(pathname: string | null) {
  if (!pathname) return false;
  return GROUPS.some((group) =>
    group.items.some((item) => itemAllowsPath(item, pathname)),
  );
}

function isItemActive(item: NavItem, pathname: string | null) {
  if (!pathname) return false;
  return itemAllowsPath(item, pathname);
}

function RestrictedNavigation({
  pathname,
  onNavigate,
}: {
  pathname: string | null;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex h-full min-h-0 flex-col bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="border-b border-white/10 px-4 py-4">
        <div className="rounded-2xl border border-violet-400/20 bg-violet-500/10 p-4">
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-300">
            Profil dédié
          </div>
          <div className="mt-1 text-base font-black">Correspondant fichier</div>
          <p className="mt-1 text-xs leading-5 text-slate-300">
            Correspondant fichier · Organisation scolaire · Paramètres
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-3">
          {GROUPS.map((group) => (
            <section
              key={group.title}
              className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]"
            >
              <div className="flex items-center gap-3 border-b border-white/8 px-3 py-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/8 text-slate-100">
                  <group.Icon className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">
                    Module
                  </div>
                  <div className="text-sm font-bold text-white">{group.title}</div>
                </div>
              </div>

              <div className="space-y-1 p-2">
                {group.items.map((item) => {
                  const active = isItemActive(item, pathname);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch={false}
                      onClick={onNavigate}
                      className={[
                        "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-semibold transition",
                        active
                          ? "border-violet-400/25 bg-violet-500/15 text-white"
                          : "border-transparent text-slate-300 hover:bg-white/[0.06] hover:text-white",
                      ].join(" ")}
                    >
                      <item.Icon className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      <div className="border-t border-white/10 bg-slate-950/60 p-3">
        <div className="rounded-xl bg-white p-2 text-slate-900">
          <LogoutButton />
        </div>
      </div>
    </nav>
  );
}

export default function FileCorrespondentShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const allowed = useMemo(() => isAllowedPath(pathname), [pathname]);

  useEffect(() => {
    if (!pathname || allowed) return;
    router.replace(DEFAULT_ROUTE);
  }, [allowed, pathname, router]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (pathname && !allowed) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 px-4">
        <div className="rounded-2xl border bg-white px-6 py-5 text-sm font-semibold text-slate-700 shadow-sm">
          Redirection vers l’espace Correspondant fichier…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="fixed inset-y-0 left-0 z-40 hidden w-[352px] md:block">
        <RestrictedNavigation pathname={pathname} />
      </div>

      <div
        className={[
          "fixed inset-0 z-50 bg-black/45 transition-opacity md:hidden",
          mobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        ].join(" ")}
        aria-hidden={!mobileOpen}
      >
        <div
          className={[
            "absolute inset-y-0 left-0 w-[min(90vw,390px)] bg-slate-950 shadow-2xl transition-transform",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          ].join(" ")}
        >
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="absolute right-3 top-3 z-10 rounded-full bg-white/10 p-2 text-white"
            aria-label="Fermer le menu"
          >
            <X className="h-4 w-4" />
          </button>
          <RestrictedNavigation
            pathname={pathname}
            onNavigate={() => setMobileOpen(false)}
          />
        </div>
      </div>

      <div className="md:pl-[352px]">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-white/95 px-4 shadow-sm backdrop-blur md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-xl border p-2 text-slate-700"
            aria-label="Ouvrir le menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-600">
              Mon Cahier
            </div>
            <div className="text-sm font-bold text-slate-900">Correspondant fichier</div>
          </div>
        </header>

        <main className="min-h-screen">{children}</main>
      </div>
    </div>
  );
}
