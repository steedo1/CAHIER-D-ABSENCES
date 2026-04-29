"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
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
  ShieldCheck,
  NotebookPen,
  FileSpreadsheet,
  FileText,
} from "lucide-react";
import React from "react";
import type { AppRole } from "@/lib/auth/role";

type NavItem = {
  href: string;
  label: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  badge?: string;
  matchTab?: string;
};

type PendingAbsenceCountResponse =
  | {
      ok: true;
      items?: Array<{ id: string }>;
    }
  | {
      ok: false;
      error?: string;
    };

type PendingGradePublicationCountResponse =
  | {
      ok: true;
      items?: Array<{ id?: string; evaluation_id?: string }>;
      meta?: {
        count?: number;
      };
    }
  | {
      ok: false;
      error?: string;
    };

type Accent = "emerald" | "violet" | "sky" | "amber" | "cyan";

const SIDEBAR_WIDTH_KEY = "mc_admin_sidebar_width";
const DEFAULT_SIDEBAR_WIDTH = 352;
const MIN_SIDEBAR_WIDTH = 320;
const MAX_SIDEBAR_WIDTH = 460;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getHrefPath(href: string): string {
  return href.split("?")[0]?.split("#")[0] || href;
}

function getHrefTab(href: string): string | null {
  const query = href.includes("?") ? href.split("?")[1] ?? "" : "";
  if (!query) return null;
  return new URLSearchParams(query).get("tab");
}

function isPathActive(
  pathname: string | null,
  item: NavItem,
  currentTab: string | null
): boolean {
  const hrefPath = getHrefPath(item.href);
  const pathActive =
    pathname === hrefPath || (pathname?.startsWith(hrefPath + "/") ?? false);

  if (!pathActive) return false;

  const targetTab = item.matchTab ?? getHrefTab(item.href);
  if (!targetTab) return true;

  return currentTab === targetTab;
}

function groupHasActiveItem(
  pathname: string | null,
  items: NavItem[],
  currentTab: string | null
): boolean {
  return items.some((item) => isPathActive(pathname, item, currentTab));
}

function getAccentClasses(accent: Accent, active: boolean) {
  const base = {
    emerald: {
      bar: active ? "bg-emerald-400" : "bg-transparent",
      dot: "bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-500/25",
      activeBg:
        "bg-gradient-to-r from-emerald-500/12 via-slate-800/95 to-slate-800/95 border-emerald-500/20",
      activeRing: "shadow-[0_0_0_1px_rgba(16,185,129,0.10)]",
    },
    violet: {
      bar: active ? "bg-violet-400" : "bg-transparent",
      dot: "bg-violet-400/15 text-violet-300 ring-1 ring-violet-500/25",
      activeBg:
        "bg-gradient-to-r from-violet-500/12 via-slate-800/95 to-slate-800/95 border-violet-500/20",
      activeRing: "shadow-[0_0_0_1px_rgba(139,92,246,0.10)]",
    },
    sky: {
      bar: active ? "bg-sky-400" : "bg-transparent",
      dot: "bg-sky-400/15 text-sky-300 ring-1 ring-sky-500/25",
      activeBg:
        "bg-gradient-to-r from-sky-500/12 via-slate-800/95 to-slate-800/95 border-sky-500/20",
      activeRing: "shadow-[0_0_0_1px_rgba(14,165,233,0.10)]",
    },
    amber: {
      bar: active ? "bg-amber-400" : "bg-transparent",
      dot: "bg-amber-400/15 text-amber-300 ring-1 ring-amber-500/25",
      activeBg:
        "bg-gradient-to-r from-amber-500/12 via-slate-800/95 to-slate-800/95 border-amber-500/20",
      activeRing: "shadow-[0_0_0_1px_rgba(245,158,11,0.10)]",
    },
    cyan: {
      bar: active ? "bg-cyan-400" : "bg-transparent",
      dot: "bg-cyan-400/15 text-cyan-300 ring-1 ring-cyan-500/25",
      activeBg:
        "bg-gradient-to-r from-cyan-500/12 via-slate-800/95 to-slate-800/95 border-cyan-500/20",
      activeRing: "shadow-[0_0_0_1px_rgba(6,182,212,0.10)]",
    },
  } as const;

  return base[accent];
}

function CountBadge({ count }: { count: number }) {
  return (
    <span className="ml-auto inline-flex min-w-[22px] shrink-0 items-center justify-center rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white shadow-sm ring-1 ring-red-400/40">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function TextBadge({ text }: { text: string }) {
  return (
    <span className="ml-auto shrink-0 rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-200 ring-1 ring-white/10">
      {text}
    </span>
  );
}

/* =========================
   Hors groupes
========================= */
const TOP_LEVEL_ITEMS: NavItem[] = [
  { href: "/admin/dashboard", label: "Tableau de bord", Icon: LayoutDashboard },
];

const PREDICTION_ITEMS: NavItem[] = [
  {
    href: "/admin/notes/predictions",
    label: "Prédictions de réussite",
    Icon: BarChart3,
    badge: "IA",
  },
];

const NON_CLASSES_ITEMS: NavItem[] = [
  {
    href: "/admin/notes/non-classes",
    label: "Élèves non classés",
    Icon: UserRoundCheck,
  },
];

/* =========================
   Groupe : Correspondant fichier
========================= */
const FILE_CORRESPONDENCE_ITEMS: NavItem[] = [
  {
    href: "/admin/export-moyennes",
    label: "Export moyennes",
    Icon: FileSpreadsheet,
  },
  {
    href: "/admin/notes/conseil-classe",
    label: "Conseil de classe",
    Icon: FileText,
  },
  {
    href: "/admin/bulletins",
    label: "Bulletins",
    Icon: FileSpreadsheet,
  },
  {
    href: "/admin/notes/matrice-annuelle",
    label: "Matrice annuelle",
    Icon: FileSpreadsheet,
  },
  {
    href: "/admin/notes/statistiques",
    label: "Matrice matière",
    Icon: BarChart3,
  },
];

/* =========================
   Groupe : Gestion conduite
========================= */
const CONDUCT_MANAGEMENT_ITEMS: NavItem[] = [
  {
    href: "/admin/regles-conduite",
    label: "Règles de conduite",
    Icon: ShieldCheck,
  },
  {
    href: "/admin/conduite",
    label: "Moyenne de conduite",
    Icon: BarChart3,
  },
];

/* =========================
   Groupe : Organisation scolaire
========================= */
const ORGANISATION_ITEMS: NavItem[] = [
  { href: "/admin/classes", label: "Créer vos classes", Icon: School },
  { href: "/admin/users", label: "Utilisateurs & rôles", Icon: Users },
  { href: "/admin/affectations", label: "Attribution des classes", Icon: Puzzle },
  { href: "/admin/parents", label: "Liste des classes", Icon: UserRoundCheck },
  {
    href: "/admin/import",
    label: "Import classes-enseignants",
    Icon: Inbox,
    badge: "OCT",
  },
  {
    href: "/admin/import-emplois-du-temps",
    label: "Import emplois du temps",
    Icon: Inbox,
  },
];

/* =========================
   Groupe : Administration & services
========================= */
const ADMIN_ITEMS: NavItem[] = [
  {
    href: "/admin/autorisations",
    label: "Autorisation absences",
    Icon: FileText,
  },
  {
    href: "/admin/finance",
    label: "Gestion financière",
    Icon: FileSpreadsheet,
    badge: "PRO",
  },
];

/* =========================
   Groupe : Paramètres
========================= */
const SETTINGS_ITEMS: NavItem[] = [
  {
    href: "/admin/parametres?tab=security",
    label: "Accès & sécurité",
    Icon: ShieldCheck,
    matchTab: "security",
  },
  {
    href: "/admin/parametres?tab=school",
    label: "Établissement & horaires",
    Icon: School,
    matchTab: "school",
  },
  {
    href: "/admin/parametres?tab=academic-years",
    label: "Années scolaires",
    Icon: NotebookPen,
    matchTab: "academic-years",
  },
  {
    href: "/admin/parametres?tab=grading-periods",
    label: "Périodes d’évaluation",
    Icon: FileText,
    matchTab: "grading-periods",
  },
  {
    href: "/admin/parametres?tab=coefficients",
    label: "Coefficients & sous-matières",
    Icon: FileSpreadsheet,
    matchTab: "coefficients",
  },
];

/* =========================
   Groupe : Contrôle des appels
========================= */
const CALLS_CONTROL_ITEMS: NavItem[] = [
  { href: "/admin/absences/appels", label: "Surveillance des appels", Icon: BarChart3 },
  {
    href: "/admin/absences/appels-matrice",
    label: "Vue par créneau",
    Icon: BarChart3,
  },
  { href: "/admin/statistiques", label: "Contrôle enseignants", Icon: BarChart3 },
];

/* =========================
   Groupe : Cahier des absences
========================= */
const ABS_ITEMS: NavItem[] = [
  { href: "/admin/absences", label: "Matrice des absences", Icon: Ban },
  { href: "/admin/assiduite", label: "Assiduité & justifications", Icon: UserRoundCheck },
  {
    href: "/admin/absences/appel-administratif",
    label: "Appel administratif",
    Icon: Users,
  },
];

/* =========================
   Groupe : Cahier de notes
========================= */
const NOTES_ITEMS: NavItem[] = [
  { href: "/admin/notes", label: "Vue d’ensemble", Icon: NotebookPen },
  {
    href: "/admin/notes/publication-requests",
    label: "Demandes de publication",
    Icon: FileText,
  },
  {
    href: "/admin/notes/publication-settings",
    label: "Paramètres de publication",
    Icon: Settings,
  },
  { href: "/admin/notes/evaluations", label: "Stats évaluations", Icon: NotebookPen },
];

function NavLinkItem({
  item,
  pathname,
  currentTab,
  accent,
  pendingAbsenceCount = 0,
  pendingGradePublicationCount = 0,
  topLevel = false,
}: {
  item: NavItem;
  pathname: string | null;
  currentTab: string | null;
  accent: Accent;
  pendingAbsenceCount?: number;
  pendingGradePublicationCount?: number;
  topLevel?: boolean;
}) {
  const active = isPathActive(pathname, item, currentTab);
  const accentClasses = getAccentClasses(accent, active);

  const isAbsenceAuthorization = item.href === "/admin/autorisations";
  const isGradePublicationRequests =
    item.href === "/admin/notes/publication-requests";

  const showPendingAbsenceBadge =
    isAbsenceAuthorization && pendingAbsenceCount > 0;

  const showPendingGradePublicationBadge =
    isGradePublicationRequests && pendingGradePublicationCount > 0;

  return (
    <li key={item.href}>
      <Link
        href={item.href}
        prefetch={false}
        aria-current={active ? "page" : undefined}
        className={[
          "group relative flex items-center gap-3 overflow-hidden rounded-xl border px-3 py-2.5 text-sm",
          "transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/30",
          active
            ? [
                "border-white/10 text-white",
                accentClasses.activeBg,
                accentClasses.activeRing,
              ].join(" ")
            : [
                "border-transparent text-slate-300",
                "hover:border-white/8 hover:bg-white/[0.04] hover:text-white",
              ].join(" "),
          topLevel ? "min-h-[48px]" : "min-h-[44px]",
        ].join(" ")}
      >
        <span
          className={[
            "absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full transition-all",
            topLevel ? "h-8 w-1.5" : "h-7 w-1",
            accentClasses.bar,
          ].join(" ")}
        />

        <span
          className={[
            "inline-flex shrink-0 items-center justify-center rounded-lg",
            topLevel ? "h-9 w-9" : "h-8 w-8",
            active ? accentClasses.dot : "bg-white/5 text-slate-300 ring-1 ring-white/8",
            "transition-all duration-200 group-hover:bg-white/10 group-hover:text-white",
          ].join(" ")}
        >
          <item.Icon className={topLevel ? "h-5 w-5" : "h-4 w-4"} />
        </span>

        <span
          className={[
            "min-w-0 flex-1 pr-2 whitespace-normal break-words leading-snug",
            topLevel ? "font-medium" : "font-normal",
          ].join(" ")}
        >
          {item.label}
        </span>

        {showPendingAbsenceBadge ? (
          <CountBadge count={pendingAbsenceCount} />
        ) : showPendingGradePublicationBadge ? (
          <CountBadge count={pendingGradePublicationCount} />
        ) : item.badge ? (
          <TextBadge text={item.badge} />
        ) : null}
      </Link>
    </li>
  );
}

function GroupSection({
  title,
  Icon,
  items,
  pathname,
  currentTab,
  open,
  onToggle,
  accent,
  badgeCount = 0,
  pendingAbsenceCount = 0,
  pendingGradePublicationCount = 0,
}: {
  title: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  items: NavItem[];
  pathname: string | null;
  currentTab: string | null;
  open: boolean;
  onToggle: () => void;
  accent: Accent;
  badgeCount?: number;
  pendingAbsenceCount?: number;
  pendingGradePublicationCount?: number;
}) {
  const active = groupHasActiveItem(pathname, items, currentTab);
  const accentClasses = getAccentClasses(accent, active);

  return (
    <li className="mt-3">
      <div
        className={[
          "overflow-hidden rounded-2xl border backdrop-blur-sm",
          active
            ? "border-white/12 bg-white/[0.045] shadow-[0_10px_30px_rgba(0,0,0,0.20)]"
            : "border-white/8 bg-white/[0.025]",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={[
            "group flex w-full items-center gap-3 px-3 py-3 text-left text-sm",
            "transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/30",
            active ? "text-white" : "text-slate-200 hover:bg-white/[0.03]",
          ].join(" ")}
        >
          <span
            className={[
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all",
              active ? accentClasses.dot : "bg-white/5 text-slate-300 ring-1 ring-white/8",
            ].join(" ")}
          >
            <Icon className="h-4 w-4" />
          </span>

          <span className="min-w-0 flex-1 pr-2">
            <span className="block whitespace-normal break-words leading-snug font-semibold tracking-[0.01em]">
              {title}
            </span>
          </span>

          {badgeCount > 0 ? <CountBadge count={badgeCount} /> : null}

          <span
            className={[
              "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-all",
              open ? "rotate-90 bg-white/8 text-slate-200" : "bg-white/5",
            ].join(" ")}
            aria-hidden
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </button>

        {open && (
          <div className="border-t border-white/6 px-2 pb-2 pt-2">
            <ul className="space-y-1.5">
              {items.map((item) => (
                <NavLinkItem
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  currentTab={currentTab}
                  accent={accent}
                  pendingAbsenceCount={pendingAbsenceCount}
                  pendingGradePublicationCount={pendingGradePublicationCount}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </li>
  );
}

export default function SidebarNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab");

  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const isResizingRef = React.useRef(false);

  const [role, setRole] = React.useState<AppRole | null>(null);
  const [pendingAbsenceCount, setPendingAbsenceCount] = React.useState<number>(0);
  const [pendingGradePublicationCount, setPendingGradePublicationCount] =
    React.useState<number>(0);
  const [sidebarWidth, setSidebarWidth] = React.useState<number>(DEFAULT_SIDEBAR_WIDTH);

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
      if (!raw) return;

      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        setSidebarWidth(clamp(parsed, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH));
      }
    } catch {
      // no-op
    }
  }, []);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      // no-op
    }
  }, [sidebarWidth]);

  React.useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      if (!isResizingRef.current || !wrapperRef.current) return;

      const left = wrapperRef.current.getBoundingClientRect().left;
      const nextWidth = clamp(event.clientX - left, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
      setSidebarWidth(nextWidth);
    }

    function stopResize() {
      if (!isResizingRef.current) return;

      isResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResize);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResize);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  const startResize = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();

    isResizingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const resetWidth = React.useCallback(() => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
  }, []);

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

  React.useEffect(() => {
    let cancelled = false;

    async function loadPendingAbsenceCount() {
      try {
        const res = await fetch("/api/admin/absence-requests?status=pending", {
          cache: "no-store",
        });

        if (!res.ok) {
          if (!cancelled) setPendingAbsenceCount(0);
          return;
        }

        const json = (await res.json().catch(() => null)) as
          | PendingAbsenceCountResponse
          | null;

        if (!json || !json.ok) {
          if (!cancelled) setPendingAbsenceCount(0);
          return;
        }

        const count = Array.isArray(json.items) ? json.items.length : 0;

        if (!cancelled) {
          setPendingAbsenceCount(count);
        }
      } catch {
        if (!cancelled) setPendingAbsenceCount(0);
      }
    }

    void loadPendingAbsenceCount();

    const timer = window.setInterval(() => {
      void loadPendingAbsenceCount();
    }, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    async function loadPendingGradePublicationCount() {
      try {
        const res = await fetch(
          "/api/admin/grades/publication-requests?status=submitted&limit=300",
          { cache: "no-store" }
        );

        if (!res.ok) {
          if (!cancelled) setPendingGradePublicationCount(0);
          return;
        }

        const json = (await res.json().catch(() => null)) as
          | PendingGradePublicationCountResponse
          | null;

        if (!json || !json.ok) {
          if (!cancelled) setPendingGradePublicationCount(0);
          return;
        }

        const count =
          typeof json.meta?.count === "number"
            ? json.meta.count
            : Array.isArray(json.items)
              ? json.items.length
              : 0;

        if (!cancelled) {
          setPendingGradePublicationCount(count);
        }
      } catch {
        if (!cancelled) setPendingGradePublicationCount(0);
      }
    }

    void loadPendingGradePublicationCount();

    const timer = window.setInterval(() => {
      void loadPendingGradePublicationCount();
    }, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const isEducator = role === "educator";

  const topLevelItems = React.useMemo(() => TOP_LEVEL_ITEMS, []);

  const predictionItems = React.useMemo(
    () =>
      PREDICTION_ITEMS.filter((item) => {
        if (isEducator && item.href.startsWith("/admin/notes")) return false;
        return true;
      }),
    [isEducator]
  );

  const nonClassesItems = React.useMemo(
    () =>
      NON_CLASSES_ITEMS.filter((item) => {
        if (isEducator && item.href.startsWith("/admin/notes")) return false;
        return true;
      }),
    [isEducator]
  );

  const fileCorrespondenceItems = React.useMemo(
    () =>
      FILE_CORRESPONDENCE_ITEMS.filter((item) => {
        if (isEducator) return false;
        return true;
      }),
    [isEducator]
  );

  const conductManagementItems = React.useMemo(() => CONDUCT_MANAGEMENT_ITEMS, []);

  const organisationItems = React.useMemo(() => ORGANISATION_ITEMS, []);

  const adminItems = React.useMemo(
    () =>
      ADMIN_ITEMS.filter((item) => {
        if (isEducator && item.href.startsWith("/admin/finance")) return false;
        return true;
      }),
    [isEducator]
  );

  const callsControlItems = React.useMemo(() => CALLS_CONTROL_ITEMS, []);
  const absItems = React.useMemo(() => ABS_ITEMS, []);

  const notesItems = React.useMemo(
    () =>
      NOTES_ITEMS.filter((item) => {
        if (isEducator && item.href.startsWith("/admin/notes")) return false;
        return true;
      }),
    [isEducator]
  );

  const settingsItems = React.useMemo(() => SETTINGS_ITEMS, []);

  const fileCorrespondenceActive =
    !isEducator && groupHasActiveItem(pathname, fileCorrespondenceItems, currentTab);
  const conductManagementActive = groupHasActiveItem(
    pathname,
    conductManagementItems,
    currentTab
  );
  const organisationActive = groupHasActiveItem(pathname, organisationItems, currentTab);
  const adminActive = groupHasActiveItem(pathname, adminItems, currentTab);
  const callsControlActive = groupHasActiveItem(pathname, callsControlItems, currentTab);
  const absActive = groupHasActiveItem(pathname, absItems, currentTab);
  const notesActive = !isEducator && groupHasActiveItem(pathname, notesItems, currentTab);
  const settingsActive = groupHasActiveItem(pathname, settingsItems, currentTab);

  const [fileCorrespondenceOpen, setFileCorrespondenceOpen] =
    React.useState<boolean>(fileCorrespondenceActive);
  const [conductManagementOpen, setConductManagementOpen] =
    React.useState<boolean>(conductManagementActive);
  const [organisationOpen, setOrganisationOpen] =
    React.useState<boolean>(organisationActive);
  const [adminOpen, setAdminOpen] = React.useState<boolean>(adminActive);
  const [callsControlOpen, setCallsControlOpen] =
    React.useState<boolean>(callsControlActive);
  const [absOpen, setAbsOpen] = React.useState<boolean>(absActive);
  const [notesOpen, setNotesOpen] = React.useState<boolean>(notesActive);
  const [settingsOpen, setSettingsOpen] = React.useState<boolean>(settingsActive);

  React.useEffect(() => {
    if (fileCorrespondenceActive) setFileCorrespondenceOpen(true);
  }, [fileCorrespondenceActive]);

  React.useEffect(() => {
    if (conductManagementActive) setConductManagementOpen(true);
  }, [conductManagementActive]);

  React.useEffect(() => {
    if (organisationActive) setOrganisationOpen(true);
  }, [organisationActive]);

  React.useEffect(() => {
    if (adminActive) setAdminOpen(true);
  }, [adminActive]);

  React.useEffect(() => {
    if (callsControlActive) setCallsControlOpen(true);
  }, [callsControlActive]);

  React.useEffect(() => {
    if (absActive) setAbsOpen(true);
  }, [absActive]);

  React.useEffect(() => {
    if (notesActive) setNotesOpen(true);
  }, [notesActive]);

  React.useEffect(() => {
    if (settingsActive) setSettingsOpen(true);
  }, [settingsActive]);

  return (
    <div
      ref={wrapperRef}
      className="relative h-full min-h-0 shrink-0 overflow-visible"
      style={{
        width: `${sidebarWidth}px`,
        minWidth: `${sidebarWidth}px`,
      }}
    >
      <nav className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
        <div className="shrink-0 border-b border-white/6 px-4 pb-3 pt-4">
          <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Navigation
            </div>
            <div className="mt-1 text-sm font-semibold text-white">Mon Cahier</div>
            <div className="text-xs leading-snug text-slate-400">
              Pilotage scolaire & suivi en temps réel
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 pr-4">
          <ul className="space-y-1">
            {topLevelItems.map((item) => (
              <NavLinkItem
                key={item.href}
                item={item}
                pathname={pathname}
                currentTab={currentTab}
                accent="emerald"
                pendingAbsenceCount={pendingAbsenceCount}
                pendingGradePublicationCount={pendingGradePublicationCount}
                topLevel
              />
            ))}

            {predictionItems.map((item) => (
              <NavLinkItem
                key={item.href}
                item={item}
                pathname={pathname}
                currentTab={currentTab}
                accent="cyan"
                pendingAbsenceCount={pendingAbsenceCount}
                pendingGradePublicationCount={pendingGradePublicationCount}
                topLevel
              />
            ))}

            {nonClassesItems.map((item) => (
              <NavLinkItem
                key={item.href}
                item={item}
                pathname={pathname}
                currentTab={currentTab}
                accent="amber"
                pendingAbsenceCount={pendingAbsenceCount}
                pendingGradePublicationCount={pendingGradePublicationCount}
                topLevel
              />
            ))}

            {!isEducator && fileCorrespondenceItems.length > 0 && (
              <GroupSection
                title="Correspondant fichier"
                Icon={FileSpreadsheet}
                items={fileCorrespondenceItems}
                pathname={pathname}
                currentTab={currentTab}
                open={fileCorrespondenceOpen}
                onToggle={() => setFileCorrespondenceOpen((v) => !v)}
                accent="violet"
              />
            )}

            {conductManagementItems.length > 0 && (
              <GroupSection
                title="Gestion conduite"
                Icon={ShieldCheck}
                items={conductManagementItems}
                pathname={pathname}
                currentTab={currentTab}
                open={conductManagementOpen}
                onToggle={() => setConductManagementOpen((v) => !v)}
                accent="amber"
              />
            )}

            <GroupSection
              title="Organisation scolaire"
              Icon={School}
              items={organisationItems}
              pathname={pathname}
              currentTab={currentTab}
              open={organisationOpen}
              onToggle={() => setOrganisationOpen((v) => !v)}
              accent="sky"
            />

            <GroupSection
              title="Administration & services"
              Icon={Settings}
              items={adminItems}
              pathname={pathname}
              currentTab={currentTab}
              open={adminOpen}
              onToggle={() => setAdminOpen((v) => !v)}
              accent="amber"
              badgeCount={pendingAbsenceCount}
              pendingAbsenceCount={pendingAbsenceCount}
              pendingGradePublicationCount={pendingGradePublicationCount}
            />

            <GroupSection
              title="Contrôle des appels"
              Icon={BarChart3}
              items={callsControlItems}
              pathname={pathname}
              currentTab={currentTab}
              open={callsControlOpen}
              onToggle={() => setCallsControlOpen((v) => !v)}
              accent="cyan"
            />

            <GroupSection
              title="Cahier des absences"
              Icon={Ban}
              items={absItems}
              pathname={pathname}
              currentTab={currentTab}
              open={absOpen}
              onToggle={() => setAbsOpen((v) => !v)}
              accent="emerald"
            />

            {!isEducator && notesItems.length > 0 && (
              <GroupSection
                title="Cahier de notes"
                Icon={NotebookPen}
                items={notesItems}
                pathname={pathname}
                currentTab={currentTab}
                open={notesOpen}
                onToggle={() => setNotesOpen((v) => !v)}
                accent="violet"
                badgeCount={pendingGradePublicationCount}
                pendingGradePublicationCount={pendingGradePublicationCount}
              />
            )}

            <GroupSection
              title="Paramètres"
              Icon={Settings}
              items={settingsItems}
              pathname={pathname}
              currentTab={currentTab}
              open={settingsOpen}
              onToggle={() => setSettingsOpen((v) => !v)}
              accent="amber"
            />
          </ul>
        </div>

        <div className="shrink-0 border-t border-white/6 px-4 py-4">
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3 text-[11px] text-slate-400">
            <div>© {new Date().getFullYear()} Mon Cahier</div>
            <div className="mt-1 text-[10px] text-slate-500">
              Conçu et développé par{" "}
              <span className="font-semibold text-slate-200">
                NEXA DIGITAL SARL
              </span>
            </div>
          </div>
        </div>
      </nav>

      <div
        onMouseDown={startResize}
        onDoubleClick={resetWidth}
        className="absolute right-[-8px] top-1/2 z-30 hidden h-24 w-4 -translate-y-1/2 cursor-col-resize items-center justify-center lg:flex"
        title="Glisser pour redimensionner • Double-clic pour réinitialiser"
        aria-hidden
      >
        <div className="flex h-20 w-3 items-center justify-center rounded-full border border-white/10 bg-slate-900/80 shadow-lg backdrop-blur">
          <div className="h-10 w-[3px] rounded-full bg-emerald-400/70 transition hover:bg-emerald-300" />
        </div>
      </div>
    </div>
  );
}