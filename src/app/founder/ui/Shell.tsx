// src/app/founder/ui/Shell.tsx
"use client";

import { useEffect, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  CalendarDays,
  ChevronRight,
  LayoutDashboard,
  ShieldCheck,
  Wallet,
  Loader2,
} from "lucide-react";
import InstallAndPushCTA from "@/components/InstallAndPushCTA";
import TrueLogoutButton from "@/components/auth/TrueLogoutButton";

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
            <div className="mt-1 truncate text-lg font-black text-white">{label}</div>
          </div>
        </div>
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-emerald-400" />
        </div>
      </div>
    </div>
  );
}


const NAV = [
  {
    href: "/founder/dashboard",
    label: "Vue globale",
    shortLabel: "Global",
    description: "Synthèse multi-écoles",
    Icon: BarChart3,
  },
  {
    href: "/founder/attendance-slots",
    label: "Vue créneau",
    shortLabel: "Créneaux",
    description: "Appels et créneaux",
    Icon: CalendarDays,
  },
  {
    href: "/admin/finance",
    label: "Gestion financière",
    shortLabel: "Finance",
    description: "Module complet admin",
    Icon: Wallet,
  },
];

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function FounderShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/founder/dashboard";
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeLabel, setRouteLabel] = useState("Chargement…");

  useEffect(() => {
    setRouteLoading(false);
  }, [pathname]);

  useEffect(() => {
    if (!routeLoading) return;
    const timer = window.setTimeout(() => setRouteLoading(false), 25000);
    return () => window.clearTimeout(timer);
  }, [routeLoading]);

  function startLoading(label: string) {
    setRouteLabel(label || "Chargement…");
    setRouteLoading(true);
  }

  function handleShellClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const target = event.target as HTMLElement | null;
    const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    if (anchor.target && anchor.target !== "_self") return;
    if (anchor.hasAttribute("download")) return;

    const href = anchor.getAttribute("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) return;

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

  const activeItem = NAV.find((item) => isActivePath(pathname, item.href)) ?? NAV[0];
  const ActiveIcon = activeItem.Icon;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950" onClickCapture={handleShellClickCapture} onSubmitCapture={handleShellSubmitCapture}>
      {routeLoading ? <LoadingOverlay label={routeLabel} /> : null}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-3 sm:px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white shadow-sm sm:h-12 sm:w-12">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-black text-slate-950 sm:text-base">
                Mon Cahier
              </div>
              <div className="truncate text-xs font-semibold text-slate-500 sm:text-sm">
                Espace Fondateur
                <span className="hidden sm:inline"> · Multi-écoles</span>
              </div>
            </div>
          </div>

          <div className="shrink-0">
            <TrueLogoutButton label="Se déconnecter" />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-2 py-3 sm:px-4 lg:px-6 lg:py-7">
        <div className="lg:grid lg:min-h-[calc(100vh-116px)] lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-7">
          <aside className="fixed left-2 top-[82px] z-40 h-[calc(100dvh-98px)] w-[86px] overflow-hidden rounded-[26px] border border-slate-200 bg-white p-2 shadow-sm sm:left-4 sm:w-[104px] lg:sticky lg:left-auto lg:top-24 lg:z-auto lg:h-[calc(100vh-116px)] lg:w-auto lg:self-start lg:rounded-[30px] lg:p-3">
            <div className="mb-3 hidden items-center justify-between rounded-[22px] bg-slate-950 px-4 py-4 text-white lg:flex">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.2em] text-white/55">
                  Fondateur
                </div>
                <div className="mt-1 text-sm font-black">Pilotage consolidé</div>
              </div>
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white/10 text-emerald-200">
                <ShieldCheck className="h-5 w-5" />
              </div>
            </div>

            <div className="mb-3 grid place-items-center rounded-[22px] bg-slate-950 px-2 py-3 text-white lg:hidden">
              <ShieldCheck className="h-5 w-5" />
              <span className="mt-1 text-[10px] font-black uppercase tracking-[0.12em] text-white/70">
                Founder
              </span>
            </div>

            <nav className="space-y-2" aria-label="Navigation fondateur">
              {NAV.map(({ href, label, shortLabel, description, Icon }) => {
                const active = isActivePath(pathname, href);

                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={[
                      "group flex flex-col items-center justify-center rounded-[20px] px-2 py-3 text-center text-xs font-black transition lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:py-3 lg:text-left lg:text-sm",
                      active
                        ? "bg-slate-950 text-white shadow-sm"
                        : "text-slate-500 hover:bg-slate-50 hover:text-slate-950",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "grid h-10 w-10 shrink-0 place-items-center rounded-2xl transition lg:h-11 lg:w-11",
                        active
                          ? "bg-white/10 text-white"
                          : "bg-slate-100 text-slate-500 group-hover:bg-white group-hover:text-slate-900",
                      ].join(" ")}
                    >
                      <Icon className="h-5 w-5" />
                    </span>

                    <span className="mt-1 block max-w-full truncate text-[10px] leading-3 sm:text-[11px] lg:hidden">
                      {shortLabel}
                    </span>

                    <span className="hidden min-w-0 flex-1 lg:block">
                      <span className="block truncate">{label}</span>
                      <span
                        className={[
                          "mt-0.5 block truncate text-xs font-semibold",
                          active ? "text-slate-200" : "text-slate-400",
                        ].join(" ")}
                      >
                        {description}
                      </span>
                    </span>

                    <ChevronRight
                      className={[
                        "hidden h-4 w-4 shrink-0 transition lg:block",
                        active ? "text-white" : "text-slate-300 group-hover:text-slate-500",
                      ].join(" ")}
                    />
                  </Link>
                );
              })}
            </nav>

            <div className="mt-4 hidden lg:block">
              <InstallAndPushCTA />
            </div>

            <div className="mt-4 hidden rounded-[26px] border border-slate-200 bg-slate-50 p-4 lg:block">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                Rôle
              </div>
              <div className="mt-2 text-sm font-black text-slate-950">
                Fondateur multi-écoles
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Vue consolidée des établissements rattachés, des créneaux et des mouvements financiers.
              </p>
            </div>
          </aside>

          <main className="min-w-0 pb-8 pl-[96px] sm:pl-[116px] lg:pl-0 lg:pb-10">
            <div className="mb-3 rounded-[22px] border border-slate-200 bg-white p-3 shadow-sm lg:hidden">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white">
                  <ActiveIcon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                    <LayoutDashboard className="h-3.5 w-3.5" /> Onglet actif
                  </div>
                  <div className="mt-1 truncate text-base font-black text-slate-950">
                    {activeItem.label}
                  </div>
                  <div className="truncate text-xs font-semibold text-slate-500">
                    {activeItem.description}
                  </div>
                </div>
              </div>
            </div>

            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
