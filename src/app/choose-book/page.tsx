"use client";

import React, { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Notebook,
  NotebookPen,
  PenTool,
  FileText,
  ArrowRight,
  Loader2,
  ShieldCheck,
  Wifi,
  WifiOff,
  Sparkles,
} from "lucide-react";

type SigEligibility = "checking" | "eligible" | "ineligible";

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[2]) : null;
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
            <div className="mt-1 text-sm text-slate-300">
              Préparation de votre espace…
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

function ThreeDCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const rotateX = -((y - rect.height / 2) / rect.height) * 10;
    const rotateY = ((x - rect.width / 2) / rect.width) * 10;

    el.style.transform = `perspective(1200px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`;
  }

  function handleLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.transform =
      "perspective(1200px) rotateX(0deg) rotateY(0deg) translateY(0px)";
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={`transform-gpu transition-transform duration-200 will-change-transform ${className}`}
    >
      {children}
    </div>
  );
}

function PremiumActionCard({
  href,
  onClick,
  icon,
  title,
  description,
  badge,
  accent = "emerald",
  disabled = false,
  hint,
  loading = false,
  colSpan = false,
}: {
  href: string;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  icon: ReactNode;
  title: string;
  description: string;
  badge?: string;
  accent?: "emerald" | "violet" | "amber" | "slate";
  disabled?: boolean;
  hint?: string | null;
  loading?: boolean;
  colSpan?: boolean;
}) {
  const tones = {
    emerald: {
      border: "border-emerald-200",
      ring: "ring-emerald-100",
      iconWrap: "bg-emerald-600 text-white",
      badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
      glow: "from-emerald-500/10 via-emerald-200/5 to-transparent",
      arrow: "text-emerald-700",
    },
    violet: {
      border: "border-violet-200",
      ring: "ring-violet-100",
      iconWrap: "bg-violet-600 text-white",
      badge: "bg-violet-50 text-violet-700 ring-violet-200",
      glow: "from-violet-500/10 via-violet-200/5 to-transparent",
      arrow: "text-violet-700",
    },
    amber: {
      border: "border-amber-200",
      ring: "ring-amber-100",
      iconWrap: "bg-amber-600 text-white",
      badge: "bg-amber-50 text-amber-700 ring-amber-200",
      glow: "from-amber-500/10 via-amber-200/5 to-transparent",
      arrow: "text-amber-700",
    },
    slate: {
      border: "border-slate-200",
      ring: "ring-slate-200",
      iconWrap: "bg-slate-900 text-white",
      badge: "bg-slate-100 text-slate-700 ring-slate-200",
      glow: "from-slate-500/10 via-slate-200/5 to-transparent",
      arrow: "text-slate-700",
    },
  } as const;

  const t = tones[accent];

  const content = (
    <>
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${t.glow}`}
      />
      <div className="relative flex h-full flex-col justify-between">
        <div>
          <div className="flex items-start justify-between gap-3">
            <div className={`grid h-14 w-14 place-items-center rounded-2xl shadow-sm ${t.iconWrap}`}>
              {icon}
            </div>

            <div className="flex flex-col items-end gap-2">
              {badge ? (
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.12em] ring-1 ${t.badge}`}
                >
                  {badge}
                </span>
              ) : null}

              <div
                className={`grid h-10 w-10 place-items-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 ${t.arrow}`}
              >
                {loading ? (
                  <MiniSpinner className={t.arrow} />
                ) : (
                  <ArrowRight className="h-5 w-5 transition group-hover:translate-x-0.5" />
                )}
              </div>
            </div>
          </div>

          <div className="mt-5">
            <h2 className="text-xl font-black tracking-tight text-slate-900">
              {title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {description}
            </p>

            {hint ? (
              <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
                {hint}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-6 flex items-center gap-2 text-sm font-black text-slate-700">
          {loading ? (
            <>
              <MiniSpinner />
              <span>Ouverture…</span>
            </>
          ) : (
            <>
              <span>Ouvrir</span>
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </div>
      </div>
    </>
  );

  return (
    <ThreeDCard className={colSpan ? "md:col-span-2" : ""}>
      <Link
        href={href}
        onClick={disabled ? (e) => e.preventDefault() : onClick}
        aria-disabled={disabled}
        className={[
          "group relative block h-full overflow-hidden rounded-[32px] border bg-white p-6 shadow-sm ring-1 transition",
          "hover:shadow-xl",
          t.border,
          t.ring,
          disabled ? "cursor-not-allowed opacity-75" : "",
        ].join(" ")}
      >
        {content}
      </Link>
    </ThreeDCard>
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
      setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true);

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

        if (typeof navigator !== "undefined" && !navigator.onLine) {
          setSigHint(
            "Hors ligne : vérification indisponible. Reconnectez-vous une fois pour activer la vérification."
          );
        } else {
          setSigHint(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function resolveOfflineDest(book: "attendance" | "grades") {
    const byBook = getCookie(`mc_last_dest_${book}`);
    const generic = getCookie("mc_last_dest");
    const cookieDest = byBook || generic;
    const fallback = book === "grades" ? "/grades/class-device" : "/class";

    if (!cookieDest) return fallback;
    if (cookieDest.startsWith("http")) return fallback;
    return cookieDest.startsWith("/") ? cookieDest : fallback;
  }

  function openWithSpinner(dest: string, label: string) {
    setRouteLabel(label);
    setRouteLoading(true);
    router.push(dest);
  }

  function handleBookClick(book: "attendance" | "grades", label: string) {
    return (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();

      const isOffline =
        typeof navigator !== "undefined" ? !navigator.onLine : false;

      const dest = isOffline
        ? resolveOfflineDest(book)
        : `/redirect?book=${book}`;

      openWithSpinner(dest, label);
    };
  }

  function handleSimplePush(dest: string, label: string) {
    return (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      openWithSpinner(dest, label);
    };
  }

  function handleReturnClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      router.back();
      return;
    }

    openWithSpinner("/redirect", "Retour à votre espace");
  }

  return (
    <>
      {routeLoading ? <LoadingOverlay label={routeLabel} /> : null}

      <main className="min-h-screen bg-slate-50">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
        >
          <div className="absolute left-[8%] top-[-8%] h-56 w-56 rounded-full bg-emerald-200/20 blur-3xl md:h-72 md:w-72" />
          <div className="absolute right-[-5%] top-[18%] h-64 w-64 rounded-full bg-sky-200/15 blur-3xl md:h-80 md:w-80" />
          <div className="absolute bottom-[-10%] left-[18%] h-56 w-56 rounded-full bg-violet-200/15 blur-3xl md:h-72 md:w-72" />
        </div>

        <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                <ShieldCheck className="h-6 w-6" />
              </div>

              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                  Espace enseignant
                </div>
                <div className="text-xl font-black tracking-tight text-slate-900">
                  Choisir votre cahier
                </div>
              </div>
            </div>

            <Link
              href="/redirect"
              onClick={handleReturnClick}
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Retour
            </Link>
          </div>
        </header>

        <section className="mx-auto max-w-6xl px-4 py-8 md:py-10">
          <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-6 py-7 text-white shadow-xl">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-emerald-100 ring-1 ring-white/15">
                  <Sparkles className="h-3.5 w-3.5" />
                  Accès rapide aux outils enseignants
                </div>

                <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
                  Ouvrez le bon cahier en un clic
                </h1>

                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-[15px]">
                  Retrouvez vos deux cahiers principaux, votre espace de
                  signature pour les bulletins et votre module
                  d’autorisation d’absence, dans une présentation plus claire,
                  plus moderne et plus professionnelle.
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-200">
                  <span className="rounded-full bg-emerald-500/15 px-3 py-1 ring-1 ring-emerald-400/25">
                    Navigation premium
                  </span>

                  <span
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1 ring-1 ${
                      isOnline
                        ? "bg-white/10 ring-white/15"
                        : "bg-amber-500/15 ring-amber-400/25"
                    }`}
                  >
                    {isOnline ? (
                      <Wifi className="h-3.5 w-3.5" />
                    ) : (
                      <WifiOff className="h-3.5 w-3.5" />
                    )}
                    {isOnline ? "En ligne" : "Mode hors ligne"}
                  </span>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-100">
                    Cahiers disponibles
                  </div>
                  <div className="mt-2 text-3xl font-black text-white">2</div>
                  <div className="mt-1 text-sm text-slate-200">
                    Absences et notes
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-100">
                    Signature
                  </div>
                  <div className="mt-2 text-lg font-black text-white">
                    {sigEligibility === "checking"
                      ? "Vérification…"
                      : sigEligibility === "eligible"
                      ? "Disponible"
                      : "À vérifier"}
                  </div>
                  <div className="mt-1 text-sm text-slate-200">
                    Bulletins enseignants
                  </div>
                </div>
              </div>
            </div>
          </div>

          <section className="mt-8">
            <div className="grid gap-5 md:grid-cols-2">
              <PremiumActionCard
                href="/redirect?book=attendance"
                onClick={handleBookClick(
                  "attendance",
                  "Ouverture du cahier des absences"
                )}
                icon={<Notebook className="h-7 w-7" />}
                title="Cahier des absences"
                description="Lancez l’appel, gérez les absences et retards, puis accédez rapidement à votre dernier écran même hors ligne."
                badge="Présences"
                accent="emerald"
                loading={routeLoading && routeLabel.includes("absences")}
              />

              <PremiumActionCard
                href="/redirect?book=grades"
                onClick={handleBookClick(
                  "grades",
                  "Ouverture du cahier de notes"
                )}
                icon={<NotebookPen className="h-7 w-7" />}
                title="Cahier de notes"
                description="Saisissez vos évaluations, notes et moyennes dans une interface claire, rapide et prête pour la classe."
                badge="Évaluations"
                accent="violet"
                loading={routeLoading && routeLabel.includes("notes")}
              />

              <PremiumActionCard
                href="/enseignant/autorisation-absence"
                onClick={handleSimplePush(
                  "/enseignant/autorisation-absence",
                  "Ouverture des autorisations d’absence"
                )}
                icon={<FileText className="h-7 w-7" />}
                title="Autorisation d’absence"
                description="Déclarez une absence sur une ou plusieurs journées et transmettez votre demande à l’administration."
                badge="Demande"
                accent="amber"
                loading={
                  routeLoading &&
                  routeLabel.includes("autorisations d’absence")
                }
              />

              {sigEligibility === "eligible" ? (
                <PremiumActionCard
                  href="/enseignant/signature"
                  onClick={handleSimplePush(
                    "/enseignant/signature",
                    "Ouverture de votre signature"
                  )}
                  icon={<PenTool className="h-7 w-7" />}
                  title="Ma signature (bulletins)"
                  description="Enregistrez votre signature une seule fois pour l’utiliser ensuite dans les documents et bulletins."
                  badge="Bulletins"
                  accent="slate"
                  loading={
                    routeLoading && routeLabel.includes("votre signature")
                  }
                />
              ) : (
                <ThreeDCard>
                  <div className="relative h-full overflow-hidden rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-200">
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-slate-500/10 via-slate-200/5 to-transparent" />
                    <div className="relative">
                      <div className="flex items-start justify-between gap-3">
                        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-900 text-white shadow-sm">
                          {sigEligibility === "checking" ? (
                            <MiniSpinner className="h-6 w-6" />
                          ) : (
                            <PenTool className="h-7 w-7" />
                          )}
                        </div>

                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-slate-700 ring-1 ring-slate-200">
                          {sigEligibility === "checking"
                            ? "Analyse"
                            : "Indisponible"}
                        </span>
                      </div>

                      <h2 className="mt-5 text-xl font-black tracking-tight text-slate-900">
                        Ma signature (bulletins)
                      </h2>

                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {sigEligibility === "checking"
                          ? "Nous vérifions votre éligibilité pour l’enregistrement de la signature."
                          : "Cette fonctionnalité n’est pas disponible pour le moment sur votre compte."}
                      </p>

                      {sigHint ? (
                        <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
                          {sigHint}
                        </div>
                      ) : null}

                      <div className="mt-6 flex items-center gap-2 text-sm font-black text-slate-500">
                        {sigEligibility === "checking" ? (
                          <>
                            <MiniSpinner />
                            <span>Vérification en cours…</span>
                          </>
                        ) : (
                          <span>Accès indisponible</span>
                        )}
                      </div>
                    </div>
                  </div>
                </ThreeDCard>
              )}
            </div>
          </section>
        </section>
      </main>
    </>
  );
}