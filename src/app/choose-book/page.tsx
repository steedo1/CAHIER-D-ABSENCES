"use client";

import React, { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { probeCloudSchedule } from "@/lib/cloud-availability";
import {
  Notebook,
  NotebookPen,
  BookOpen,
  PenTool,
  FileText,
  ArrowRight,
  ArrowUpRight,
  Loader2,
  ShieldCheck,
  Wifi,
  WifiOff,
} from "lucide-react";

type SigEligibility = "checking" | "eligible" | "ineligible";

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[2]) : null;
}

function validateOfflineBookDestination(
  book: "attendance" | "grades",
  candidate: string | null
) {
  if (!candidate || typeof window === "undefined") return null;

  try {
    const url = new URL(candidate, window.location.origin);
    if (url.origin !== window.location.origin) return null;

    const path = url.pathname;
    const allowed =
      book === "grades"
        ? path === "/grades" || path === "/grades/class-device"
        : path === "/attendance" || path === "/class" || path.startsWith("/class/");

    return allowed ? `${path}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

function MiniSpinner({ className = "" }: { className?: string }) {
  return <Loader2 className={`h-4 w-4 animate-spin ${className}`} />;
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
            <div className="mt-1 text-lg font-black text-white">{label}</div>
          </div>
        </div>

        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-emerald-400" />
        </div>
      </div>
    </div>
  );
}

function PremiumActionCard({
  href,
  onClick,
  icon,
  title,
  description,
  accent = "emerald",
  loading = false,
}: {
  href: string;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  icon: ReactNode;
  title: string;
  description: string;
  accent?: "emerald" | "violet" | "teal" | "amber" | "slate";
  loading?: boolean;
}) {
  const tones = {
    emerald: {
      icon: "bg-emerald-50 text-emerald-700",
      border: "hover:border-emerald-200",
      action: "text-emerald-700",
    },
    violet: {
      icon: "bg-violet-50 text-violet-700",
      border: "hover:border-violet-200",
      action: "text-violet-700",
    },
    teal: {
      icon: "bg-teal-50 text-teal-700",
      border: "hover:border-teal-200",
      action: "text-teal-700",
    },
    amber: {
      icon: "bg-amber-50 text-amber-700",
      border: "hover:border-amber-200",
      action: "text-amber-700",
    },
    slate: {
      icon: "bg-slate-100 text-slate-700",
      border: "hover:border-slate-300",
      action: "text-slate-700",
    },
  } as const;
  const tone = tones[accent];

  return (
    <Link
      href={href}
      onClick={onClick}
      aria-busy={loading}
      className={[
        "group flex min-h-[180px] flex-col rounded-[22px] border border-slate-200 bg-white p-4",
        "shadow-sm transition-[transform,box-shadow,border-color] duration-200",
        "hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600",
        "motion-reduce:transform-none motion-reduce:transition-none",
        tone.border,
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={"grid h-11 w-11 shrink-0 place-items-center rounded-xl " + tone.icon}>
          {icon}
        </span>
        {loading ? (
          <MiniSpinner className={tone.action} />
        ) : (
          <ArrowUpRight aria-hidden="true" className={"h-5 w-5 " + tone.action} />
        )}
      </div>

      <div className="mt-4 flex-1">
        <h2 className="text-[15px] font-extrabold leading-5 tracking-tight text-slate-900 sm:text-base">
          {title}
        </h2>
        <p className="mt-1 text-xs leading-4 text-slate-500">{description}</p>
      </div>

      <span className={"mt-4 inline-flex items-center gap-1.5 text-xs font-bold " + tone.action}>
        {loading ? "Ouverture…" : "Ouvrir"}
        {!loading ? <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /> : null}
      </span>
    </Link>
  );
}

export default function ChooseBookPage() {
  const router = useRouter();

  const [isOnline, setIsOnline] = useState(true);
  const [sigEligibility, setSigEligibility] =
    useState<SigEligibility>("checking");
  const [sigHint, setSigHint] = useState<string | null>(null);

  const [routeLoading, setRouteLoading] = useState(false);
  const [routeLabel, setRouteLabel] = useState("Ouverture…");

  useEffect(() => {
    const update = () =>
      void probeCloudSchedule().then((result) => setIsOnline(Boolean(result)));

    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);

    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/teacher/signature", {
          cache: "no-store",
          credentials: "include",
        });

        if (cancelled) return;

        if (res.ok) {
          const json = await res.json().catch(() => null);
          setSigEligibility(json?.ok ? "eligible" : "ineligible");
          setSigHint(null);
        } else {
          setSigEligibility("ineligible");
          setSigHint(null);
        }
      } catch {
        if (cancelled) return;

        setSigEligibility("ineligible");

        setSigHint(
          "Cloud indisponible : vérification suspendue. Reconnectez-vous une fois."
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function resolveOfflineDest(book: "attendance" | "grades") {
    const byBook = getCookie(`mc_last_dest_${book}`);
    const generic = getCookie("mc_last_dest");
    const preparedDest = validateOfflineBookDestination(book, byBook);
    if (preparedDest) return preparedDest;

    // Compatibilite avec les appareils deja prepares, sans jamais reutiliser
    // une destination Appel pour Notes (ou l'inverse).
    const compatibleLegacyDest = validateOfflineBookDestination(book, generic);
    if (compatibleLegacyDest) return compatibleLegacyDest;

    return book === "grades" ? "/grades" : "/attendance";
  }

  function openWithSpinner(
    dest: string,
    label: string,
    documentNavigation = false
  ) {
    setRouteLabel(label);
    setRouteLoading(true);
    if (documentNavigation) {
      window.location.assign(dest);
      return;
    }
    router.push(dest);
  }

  function handleBookClick(book: "attendance" | "grades", label: string) {
    return async (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();

      const cloudReachable = Boolean(await probeCloudSchedule());
      setIsOnline(cloudReachable);

      const dest = cloudReachable
        ? `/redirect?book=${book}`
        : resolveOfflineDest(book);

      // Hors ligne, Next router.push tente de récupérer un flux RSC sur le
      // réseau. Une navigation documentaire permet au service worker de
      // servir directement la page HTML préparée dans son cache.
      openWithSpinner(dest, label, !cloudReachable);
    };
  }

  function handleSimplePush(dest: string, label: string) {
    return async (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      const cloudReachable = Boolean(await probeCloudSchedule());
      setIsOnline(cloudReachable);
      const offlineCapable = dest === "/enseignant/cahier-de-texte";

      if (!cloudReachable && !offlineCapable) {
        window.alert("Cette fonctionnalité nécessite une connexion Internet.");
        return;
      }

      openWithSpinner(dest, label, !cloudReachable);
    };
  }

  async function handleReturnClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();

    const cloudReachable = Boolean(await probeCloudSchedule());
    setIsOnline(cloudReachable);
    if (!cloudReachable) {
      router.back();
      return;
    }

    openWithSpinner("/redirect", "Retour à votre espace");
  }

  return (
    <>
      {routeLoading ? <LoadingOverlay label={routeLabel} /> : null}

      <main className="min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                <ShieldCheck aria-hidden="true" className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-500 sm:text-xs">
                  Espace enseignant
                </p>
                <h1 className="text-lg font-black tracking-tight text-slate-900 sm:text-xl">
                  Mes cahiers
                </h1>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <div
                className={[
                  "hidden items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold sm:inline-flex",
                  isOnline ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
                ].join(" ")}
              >
                {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                {isOnline ? "Cloud accessible" : "Cloud indisponible"}
              </div>
              <Link
                href={isOnline ? "/redirect" : "/choose-book"}
                onClick={handleReturnClick}
                className="inline-flex min-h-10 items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                Retour
              </Link>
            </div>
          </div>
        </header>

        <section className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
          <div className="mb-5">
            <p className="text-sm text-slate-600">
              Choisissez votre espace de travail.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            <PremiumActionCard
              href={isOnline ? "/redirect?book=attendance" : resolveOfflineDest("attendance")}
              onClick={handleBookClick("attendance", "Ouverture du cahier des absences")}
              icon={<Notebook className="h-6 w-6" />}
              title="Cahier des absences"
              description="Présences et appels"
              accent="emerald"
              loading={routeLoading && routeLabel.includes("absences")}
            />

            <PremiumActionCard
              href={isOnline ? "/redirect?book=grades" : resolveOfflineDest("grades")}
              onClick={handleBookClick("grades", "Ouverture du cahier de notes")}
              icon={<NotebookPen className="h-6 w-6" />}
              title="Cahier de notes"
              description="Notes et évaluations"
              accent="violet"
              loading={routeLoading && routeLabel.includes("notes")}
            />

            <PremiumActionCard
              href="/enseignant/cahier-de-texte"
              onClick={handleSimplePush("/enseignant/cahier-de-texte", "Ouverture du cahier de texte")}
              icon={<BookOpen className="h-6 w-6" />}
              title="Cahier de texte"
              description="Suivi des progressions"
              accent="teal"
              loading={routeLoading && routeLabel.includes("texte")}
            />

            <PremiumActionCard
              href="/enseignant/autorisation-absence"
              onClick={handleSimplePush("/enseignant/autorisation-absence", "Ouverture des autorisations d’absence")}
              icon={<FileText className="h-6 w-6" />}
              title="Autorisation d’absence"
              description="Demandes d'autorisation"
              accent="amber"
              loading={routeLoading && routeLabel.includes("autorisations d’absence")}
            />

            {sigEligibility === "eligible" ? (
              <PremiumActionCard
                href="/enseignant/signature"
                onClick={handleSimplePush("/enseignant/signature", "Ouverture de votre signature")}
                icon={<PenTool className="h-6 w-6" />}
                title="Ma signature"
                description="Bulletins et documents"
                accent="slate"
                loading={routeLoading && routeLabel.includes("votre signature")}
              />
            ) : (
              <div
                aria-disabled="true"
                className="flex min-h-[180px] flex-col rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
                    {sigEligibility === "checking" ? (
                      <MiniSpinner className="h-5 w-5" />
                    ) : (
                      <PenTool className="h-6 w-6" />
                    )}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">
                    {sigEligibility === "checking" ? "Analyse" : "Indisponible"}
                  </span>
                </div>
                <div className="mt-4 flex-1">
                  <h2 className="text-[15px] font-extrabold leading-5 tracking-tight text-slate-900 sm:text-base">
                    Ma signature
                  </h2>
                  <p className="mt-1 text-xs leading-4 text-slate-500">Bulletins et documents</p>
                </div>
                <span className="mt-4 text-xs font-semibold text-slate-500">
                  {sigEligibility === "checking" ? "Vérification en cours…" : "Accès indisponible"}
                </span>
                {sigHint ? <p className="mt-2 text-xs text-slate-500">{sigHint}</p> : null}
              </div>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
