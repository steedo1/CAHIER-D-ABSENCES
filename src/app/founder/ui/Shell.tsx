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
  Loader2,
  Menu,
  ShieldCheck,
  Wallet,
  X,
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
    description: "Synthèse",
    Icon: BarChart3,
  },
  {
    href: "/founder/attendance-slots",
    label: "Créneaux",
    description: "Présence",
    Icon: CalendarDays,
  },
  {
    href: "/admin/finance",
    label: "Finance",
    description: "Gestion",
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setRouteLoading(false);
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!routeLoading) return;
    const timer = window.setTimeout(() => setRouteLoading(false), 10000);
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

  const navigation = (
    <>
      <div className="border-b border-white/15 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/20 text-white">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="text-[12px] text-white/80">Espace fondateur</div>
            <div className="truncate text-[15px] font-extrabold">Mon Cahier</div>
            <div className="mt-1 flex items-center gap-2 text-[12px] text-emerald-200">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <span>Connecté</span>
            </div>
          </div>
        </div>
      </div>

      <div className="border-b border-white/15 px-4 py-3">
        <div className="mb-3 text-[12px] font-extrabold uppercase tracking-wide text-amber-200">
          Navigation
        </div>
        <nav className="space-y-2" aria-label="Navigation fondateur">
          {NAV.map(({ href, label, Icon }) => {
            const active = isActivePath(pathname, href);

            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={[
                  "group flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-[14px] font-extrabold transition",
                  active
                    ? "bg-white text-[#003766]"
                    : "bg-white/10 text-white hover:bg-white/15",
                ].join(" ")}
              >
                <span
                  className={[
                    "grid h-10 w-10 shrink-0 place-items-center rounded-2xl transition",
                    active ? "bg-[#e7f0fa] text-[#003766]" : "bg-white/15 text-white",
                  ].join(" ")}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <ChevronRight
                  className={[
                    "h-4 w-4 shrink-0 transition",
                    active ? "text-[#003766]" : "text-white/45 group-hover:text-white/80",
                  ].join(" ")}
                />
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="border-b border-white/15 px-4 py-3">
        <details open className="rounded-2xl bg-white/10 px-3 py-3">
          <summary className="cursor-pointer list-none text-[13px] font-extrabold text-white">
            Notifications fondateur
            <span className="ml-2 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-black text-emerald-200">
              statut visible
            </span>
          </summary>
          <div className="mt-3 [&>div]:border-white/20 [&>div]:shadow-none">
            <InstallAndPushCTA />
          </div>
        </details>
      </div>

      <div className="flex-1" />

      <div className="border-t border-white/15 px-4 py-4">
        <TrueLogoutButton
          label="Déconnexion"
          className="inline-flex w-full items-center justify-start gap-2 rounded-2xl bg-amber-400 px-4 py-3 text-[14px] font-extrabold text-slate-950 shadow-sm shadow-amber-950/20 transition hover:bg-amber-300 disabled:cursor-wait disabled:opacity-70"
        />
        <div className="mt-4 leading-tight text-white/80">
          <div className="text-[12px] opacity-80">Développé par</div>
          <div className="text-[15px] font-extrabold text-amber-300">
            Nexa Digital SARL
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div
      className="min-h-screen bg-slate-50 text-slate-950"
      onClickCapture={handleShellClickCapture}
      onSubmitCapture={handleShellSubmitCapture}
    >
      {routeLoading ? <LoadingOverlay label={routeLabel} /> : null}

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <aside className="flex h-full w-[86vw] max-w-[330px] flex-col overflow-y-auto bg-[#003766] text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/15 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white/15">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="leading-tight">
                  <div className="text-[13px] font-extrabold uppercase tracking-wide">Mon Cahier</div>
                  <div className="text-[12px] text-white/80">Fondateur</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-2xl bg-white/10 text-white"
                aria-label="Fermer le menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {navigation}
          </aside>
          <button
            type="button"
            aria-label="Fermer le menu"
            className="flex-1 bg-black/30"
            onClick={() => setMobileNavOpen(false)}
          />
        </div>
      ) : null}

      <header className="sticky top-0 z-40 bg-[#003766] text-white shadow">
        <div className="mx-auto flex w-full max-w-none items-center justify-between px-3 py-3 sm:px-4 lg:px-5 xl:px-6 2xl:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#006633] text-white lg:hidden"
              aria-label="Ouvrir le menu"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10 text-white">
                <Building2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 leading-tight">
                <div className="text-[13px] font-extrabold uppercase tracking-wide">
                  Mon Cahier
                </div>
                <div className="truncate text-[12px] opacity-80">
                  Espace fondateur
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-right leading-tight">
            <div>
              <div className="text-[12px] font-extrabold uppercase tracking-[0.25em] text-amber-300">
                FOUNDER
              </div>
              <div className="text-[13px] font-bold">Pilotage</div>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-none min-w-0 grid-cols-1 gap-0 px-0 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-5 lg:px-5 xl:grid-cols-[270px_minmax(0,1fr)] xl:px-6 2xl:px-8">
        <aside className="hidden w-full shrink-0 bg-[#003766] text-white lg:sticky lg:top-[72px] lg:flex lg:h-[calc(100vh-72px)] lg:flex-col lg:overflow-y-auto lg:overscroll-contain lg:rounded-b-[28px] lg:shadow-xl lg:shadow-slate-900/10">
          {navigation}
        </aside>

        <main className="min-w-0 px-3 py-4 pb-8 sm:px-4 lg:px-0 lg:py-5">
          {children}
        </main>
      </div>
    </div>
  );
}
