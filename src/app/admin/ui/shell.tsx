"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu,
  X,
  LayoutDashboard,
  Ban,
  NotebookPen,
  Settings,
  FileSpreadsheet,
  UserRoundCheck,
  HeartPulse,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/app/providers";
import { LogoutButton } from "@/components/LogoutButton";
import TrueLogoutButton from "@/components/auth/TrueLogoutButton";
import {
  OFFLINE_AUTH_STATE_EVENT,
  getOfflineAccessIntent,
} from "@/lib/offline-auth-client";
import {
  OFFLINE_ADMIN_STATIC_PATHS,
  isOfflinePathAllowedForRole,
} from "@/lib/offline-auth-contract";
import { warmOfflineShell } from "@/lib/offline";
import SidebarNav from "./sidebar-nav";
import ContactUsButton from "@/components/ContactUsButton";
import MonCahierAiChatBubble from "@/components/admin/MonCahierAiChatBubble";

const OFFLINE_ADMIN_NAV_ITEMS = [
  {
    href: "/admin/absences/appels-matrice",
    label: "Appels",
    Icon: Ban,
  },
  { href: "/admin/parents", label: "Listes", Icon: UserRoundCheck },
  { href: "/admin/bulletins", label: "Bulletins", Icon: FileSpreadsheet },
  {
    href: "/admin/notes/conseil-classe",
    label: "Conseil",
    Icon: NotebookPen,
  },
] as const;

const adminShellWarmByUser = new Map<string, Promise<void>>();
const adminShellWarmDone = new Set<string>();

function warmAdminEssentialShellOnce(userId: string) {
  if (adminShellWarmDone.has(userId)) return Promise.resolve();
  const running = adminShellWarmByUser.get(userId);
  if (running) return running;
  const task = warmOfflineShell([...OFFLINE_ADMIN_STATIC_PATHS])
    .then(() => {
      adminShellWarmDone.add(userId);
    })
    .catch(() => undefined)
    .finally(() => {
      adminShellWarmByUser.delete(userId);
    });
  adminShellWarmByUser.set(userId, task);
  return task;
}

function OfflineAdminEssentialNav({
  pathname,
}: {
  pathname: string | null;
}) {
  return (
    <nav className="flex h-full min-h-0 flex-col bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-3 text-white">
      <div className="mb-3 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3">
        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-300">
          Mode hors ligne
        </div>
        <div className="mt-1 text-sm font-semibold text-white">
          Fonctions essentielles
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-300">
          Le menu complet revient automatiquement avec une session Cloud normale.
        </p>
      </div>
      <div className="space-y-1">
        {OFFLINE_ADMIN_NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = pathname === href || (pathname ?? "").startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={[
                "flex items-center gap-3 rounded-xl border px-3 py-3 text-sm font-semibold transition",
                active
                  ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-100"
                  : "border-white/5 bg-white/[0.03] text-slate-200 hover:bg-white/[0.07]",
              ].join(" ")}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function LoadingOverlay({ label }: { label: string }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[28px] border border-white/10 bg-slate-950/95 p-6 text-white shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="relative grid h-14 w-14 place-items-center rounded-2xl border border-emerald-400/20 bg-emerald-500/10">
            <span className="absolute inset-0 rounded-2xl bg-emerald-400/10 blur-md" />
            <Loader2 className="relative z-10 h-7 w-7 animate-spin text-emerald-300" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
              Chargement
            </div>
            <div className="mt-1 truncate text-lg font-black text-white">
              {label}
            </div>
          </div>
        </div>
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-emerald-400" />
        </div>
      </div>

    </div>
  );
}

export default function AdminShell({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const pathname = usePathname();
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeLabel, setRouteLabel] = useState("Chargement…");
  const [offlineAdminMode, setOfflineAdminMode] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      if (session) {
        if (!cancelled) setOfflineAdminMode(false);
        return;
      }
      const intent = await getOfflineAccessIntent().catch(() => null);
      if (!cancelled) {
        setOfflineAdminMode(intent?.payload.role === "admin");
      }
    };

    const handleAuthState = () => void refresh();
    void refresh();
    window.addEventListener(OFFLINE_AUTH_STATE_EVENT, handleAuthState);
    return () => {
      cancelled = true;
      window.removeEventListener(OFFLINE_AUTH_STATE_EVENT, handleAuthState);
    };
  }, [session]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const r = await fetch("/api/auth/role", { cache: "no-store" });
        if (!r.ok) return;

        const j = await r.json().catch(() => ({}));
        if (!cancelled) setRole(j?.role ? String(j.role) : null);
      } catch {
        if (!cancelled) setRole(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (role !== "admin" || !session?.user?.id) return;

    // Préparation purement Cloud/PWA : aucune présence du relais n'est exigée.
    // Elle tourne en arrière-plan et ne bloque jamais la navigation normale.
    void warmAdminEssentialShellOnce(session.user.id);

    if (
      pathname &&
      pathname.startsWith("/admin/classes/liste/") &&
      isOfflinePathAllowedForRole("admin", pathname)
    ) {
      void warmOfflineShell([pathname]).catch(() => undefined);
    }
  }, [pathname, role, session?.user?.id]);

  useEffect(() => {
    setRouteLoading(false);
  }, [pathname]);

  useEffect(() => {
    if (!routeLoading) return;
    const timer = window.setTimeout(() => setRouteLoading(false), 10000);
    return () => window.clearTimeout(timer);
  }, [routeLoading]);

  useEffect(() => {
    if (role !== "founder") return;
    if (!pathname || pathname.startsWith("/admin/finance")) return;
    window.location.replace("/founder/dashboard");
  }, [role, pathname]);

  useEffect(() => {
    if (role !== "infirmier") return;
    if (pathname === "/admin/infirmerie") return;
    window.location.replace("/admin/infirmerie");
  }, [role, pathname]);

  function startLoading(label: string) {
    setRouteLabel(label || "Chargement…");
    setRouteLoading(true);
  }

  function handleShellClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented) return;
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;

    const target = event.target as HTMLElement | null;
    const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    if (anchor.target && anchor.target !== "_self") return;
    if (anchor.hasAttribute("download")) return;

    const href = anchor.getAttribute("href") || "";
    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("javascript:")
    )
      return;

    let nextUrl: URL;
    try {
      nextUrl = new URL(anchor.href, window.location.href);
    } catch {
      return;
    }

    if (nextUrl.origin !== window.location.origin) return;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const next = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    if (current === next) return;

    const label =
      anchor.getAttribute("aria-label") ||
      anchor.textContent?.replace(/\s+/g, " ").trim() ||
      "Ouverture de la page…";

    startLoading(label.length > 48 ? "Ouverture de la page…" : label);
  }

  function handleShellSubmitCapture(event: FormEvent<HTMLDivElement>) {
    const form = event.target as HTMLFormElement | null;
    if (!form || form.tagName !== "FORM") return;
    if (form.target && form.target !== "_self") return;
    startLoading("Traitement en cours…");
  }

  const isFinanceManager = role === "finance_manager";
  const isInfirmier = role === "infirmier";
  const isAdmin = role === "admin" || offlineAdminMode;
  const isFinancePath = pathname?.startsWith("/admin/finance") ?? false;
  const isFounderFinance = role === "founder" && isFinancePath;
  const canUseMonCahierAi =
    !offlineAdminMode &&
    (role === "admin" || role === "super_admin" || role === "educator");

  const mobileItems = useMemo(() => {
    if (offlineAdminMode) return [...OFFLINE_ADMIN_NAV_ITEMS];

    if (isInfirmier) {
      return [
        { href: "/admin/infirmerie", label: "Infirmerie", Icon: HeartPulse },
      ];
    }

    if (isFounderFinance) {
      return [
        { href: "/admin/finance", label: "Finance", Icon: FileSpreadsheet },
        {
          href: "/admin/finance/payments",
          label: "Paiements",
          Icon: FileSpreadsheet,
        },
        {
          href: "/admin/finance/reports",
          label: "Rapports",
          Icon: FileSpreadsheet,
        },
        { href: "/admin/finance/payroll", label: "Paie", Icon: UserRoundCheck },
      ];
    }

    if (isFinanceManager) {
      return [
        { href: "/admin/dashboard", label: "Accueil", Icon: LayoutDashboard },
        { href: "/admin/parents", label: "Listes", Icon: UserRoundCheck },
        { href: "/admin/finance", label: "Finance", Icon: FileSpreadsheet },
      ];
    }

    if (isAdmin && isFinancePath) {
      return [
        { href: "/admin/dashboard", label: "Accueil", Icon: LayoutDashboard },
        { href: "/admin/finance/payroll", label: "Paie", Icon: UserRoundCheck },
        { href: "/admin/absences", label: "Absences", Icon: Ban },
        { href: "/admin/notes", label: "Notes", Icon: NotebookPen },
      ];
    }

    return [
      { href: "/admin/dashboard", label: "Accueil", Icon: LayoutDashboard },
      { href: "/admin/absences", label: "Absences", Icon: Ban },
      { href: "/admin/notes", label: "Notes", Icon: NotebookPen },
      { href: "/admin/parametres", label: "Paramètres", Icon: Settings },
    ];
  }, [
    isAdmin,
    isFinanceManager,
    isFinancePath,
    isFounderFinance,
    isInfirmier,
    offlineAdminMode,
  ]);

  function isActive(href: string) {
    return pathname === href || (pathname ?? "").startsWith(href + "/");
  }

  return (
    <div
      className="min-h-screen bg-slate-50"
      onClickCapture={handleShellClickCapture}
      onSubmitCapture={handleShellSubmitCapture}
    >
      {routeLoading ? <LoadingOverlay label={routeLabel} /> : null}
      {/* ─────────────────────────────
          Drawer mobile (sidebar complète)
      ───────────────────────────── */}
      <div
        className={[
          "fixed inset-0 z-50 bg-black/40 transition-opacity md:hidden",
          mobileOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        ].join(" ")}
      >
        <div
          className={[
            "absolute left-0 top-0 h-full w-[min(88vw,420px)] bg-slate-900 shadow-xl",
            "transform transition-transform",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          ].join(" ")}
        >
          {/* Header du drawer */}
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <span className="text-sm font-semibold text-white">Navigation</span>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="rounded-full bg-white/10 p-1.5 text-slate-100 hover:bg-white/15"
              aria-label="Fermer le menu"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="h-[calc(100%-3rem)] overflow-y-auto">
            {offlineAdminMode ? (
              <OfflineAdminEssentialNav pathname={pathname} />
            ) : (
              <SidebarNav />
            )}
          </div>
        </div>

        {/* Clic sur le fond → ferme le drawer */}
        <button
          type="button"
          className="h-full w-full cursor-default"
          onClick={() => setMobileOpen(false)}
          aria-label="Fermer le menu"
        />
      </div>

      {/* ─────────────────────────────
          Layout principal
      ───────────────────────────── */}
      <div className="grid md:grid-cols-[auto_minmax(0,1fr)]">
        {/* Sidebar desktop */}
        <aside className="sticky top-0 hidden h-screen bg-slate-900 md:block">
          <div className="h-full overflow-y-auto scrollbar-thin scrollbar-track-slate-900 scrollbar-thumb-slate-700/70">
            {offlineAdminMode ? (
              <OfflineAdminEssentialNav pathname={pathname} />
            ) : (
              <SidebarNav />
            )}
          </div>
        </aside>

        <div className="min-h-screen min-w-0">
          {/* HEADER BLEU NUIT */}
          <header className="sticky top-0 z-40 border-b border-blue-900/60 bg-blue-950 text-white ring-1 ring-blue-800/40">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                {/* Bouton menu mobile */}
                <button
                  type="button"
                  onClick={() => setMobileOpen(true)}
                  className="mr-1 inline-flex items-center justify-center rounded-full bg-white/10 p-2 ring-1 ring-white/20 hover:bg-white/15 md:hidden"
                  aria-label="Ouvrir le menu"
                >
                  <Menu className="h-4 w-4" />
                </button>

                <span className="text-sm font-semibold tracking-tight">
                  Mon Cahier
                </span>

                {/* Tagline masquée sur très petit écran pour un rendu plus "app" */}
                <span className="hidden rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold ring-1 ring-white/20 sm:inline-flex">
                  {isFounderFinance
                    ? "Gestion financière · Fondateur"
                    : isFinanceManager
                      ? "Gestion financière · Établissement"
                      : isAdmin && isFinancePath
                        ? "Paie des enseignants"
                        : offlineAdminMode
                          ? "Mode hors ligne · Admin établissement"
                          : "Absences & notes · Admin établissement"}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {isFounderFinance ? (
                  <Link
                    href="/founder/dashboard"
                    className="hidden rounded-full bg-white/10 px-3 py-1.5 text-sm font-black text-white ring-1 ring-white/20 transition hover:bg-white/15 sm:inline-flex"
                  >
                    ← Retour au tableau de bord
                  </Link>
                ) : null}

                <ContactUsButton variant="chip" />

                {isFounderFinance ? (
                  <TrueLogoutButton
                    label="Déconnexion"
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-sm font-black text-white shadow-sm transition hover:bg-white/15 disabled:cursor-wait disabled:opacity-70"
                  />
                ) : (
                  <div className="rounded-full bg-white/10 px-2 py-1 ring-1 ring-white/20 hover:bg-white/15">
                    <LogoutButton />
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* Contenu principal */}
          <main className="mx-auto max-w-7xl px-4 py-6 pb-20 md:pb-8">
            {children}
          </main>

          {/* ─────────────────────────────
              MENU MOBILE EN BAS (style app / Ecolemedia)
          ───────────────────────────── */}
          <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 shadow-[0_-4px_12px_rgba(15,23,42,0.12)] backdrop-blur md:hidden">
            <div className="mx-auto flex max-w-7xl items-stretch justify-between">
              {mobileItems.map(({ href, label, Icon }) => {
                const active = isActive(href);

                return (
                  <Link
                    key={href}
                    href={href}
                    className={[
                      "flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[11px]",
                      "transition-colors",
                      active
                        ? "font-semibold text-emerald-700"
                        : "text-slate-500 hover:text-slate-800",
                    ].join(" ")}
                  >
                    <div
                      className={[
                        "flex h-9 w-9 items-center justify-center rounded-full border text-xs",
                        active
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-slate-200 bg-slate-50",
                      ].join(" ")}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="truncate">{label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      </div>

      {canUseMonCahierAi ? <MonCahierAiChatBubble /> : null}
    </div>
  );
}
