"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Notebook, NotebookPen, ChevronRight, PenTool } from "lucide-react";

type SigEligibility = "checking" | "eligible" | "ineligible";

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[2]) : null;
}

export default function ChooseBookPage() {
  const router = useRouter();

  const [isOnline, setIsOnline] = useState(true);
  const [sigEligibility, setSigEligibility] = useState<SigEligibility>("checking");
  const [sigHint, setSigHint] = useState<string | null>(null);

  // Online/offline status (UI + logique)
  useEffect(() => {
    const update = () => setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // Signature eligibility (ne doit JAMAIS bloquer la page)
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
          setSigHint("Hors ligne : vérification indisponible (reconnectez-vous une fois pour activer la vérification).");
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
    // 1) cookies posés par /redirect (si tu as ajouté mc_last_dest*)
    const byBook = getCookie(`mc_last_dest_${book}`);
    const generic = getCookie("mc_last_dest");
    const cookieDest = byBook || generic;

    // 2) fallback safe si aucun “dernier dest” connu
    const fallback = book === "grades" ? "/grades/class-device" : "/class";

    // Nettoyage simple
    if (!cookieDest) return fallback;
    if (cookieDest.startsWith("http")) return fallback; // sécurité
    return cookieDest.startsWith("/") ? cookieDest : fallback;
  }

  function handleBookClick(book: "attendance" | "grades") {
    return (e: React.MouseEvent) => {
      // En ligne -> comportement inchangé (Link vers /redirect)
      if (typeof navigator !== "undefined" && navigator.onLine) return;

      // Hors ligne -> on évite /redirect (serveur) et on route direct
      e.preventDefault();
      router.push(resolveOfflineDest(book));
    };
  }

  function handleReturnClick(e: React.MouseEvent) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      e.preventDefault();
      router.back(); // évite /redirect hors-ligne
    }
  }

  const SignatureCardEligible = (
    <Link
      href="/enseignant/signature"
      className="group block rounded-3xl border border-emerald-200 bg-white p-6 shadow-sm ring-1 ring-emerald-100 transition hover:shadow-md md:col-span-2"
    >
      <div className="flex items-start gap-4">
        <div className="grid h-12 w-12 flex-none place-items-center rounded-xl bg-emerald-600 text-white shadow-sm">
          <PenTool className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <div className="text-xl font-semibold text-slate-900">Ma signature (bulletins)</div>
          <p className="mt-1 text-sm text-slate-700">
            Enregistrez votre signature une seule fois. Elle sera utilisée si l’établissement active la signature
            électronique.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
            Ouvrir <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </div>
        </div>
      </div>
    </Link>
  );

  const SignatureCardDisabled = (
    <div
      className="block cursor-not-allowed rounded-3xl border border-slate-200 bg-slate-50 p-6 shadow-sm ring-1 ring-slate-100 md:col-span-2"
      aria-disabled
      title="Réservé au compte individuel enseignant"
    >
      <div className="flex items-start gap-4 opacity-90">
        <div className="grid h-12 w-12 flex-none place-items-center rounded-xl bg-slate-300 text-white shadow-sm">
          <PenTool className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <div className="text-xl font-semibold text-slate-800">Ma signature (bulletins)</div>
          <p className="mt-1 text-sm text-slate-700">
            {sigEligibility === "checking" ? (
              <>Vérification du type de compte…</>
            ) : sigHint ? (
              <>{sigHint}</>
            ) : (
              <>
                Réservé au <b>compte individuel enseignant</b>. Connectez-vous avec votre compte individuel pour
                enregistrer votre signature.
              </>
            )}
          </p>

          <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-500">
            Indisponible <ChevronRight className="h-4 w-4" />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <main className="relative min-h-screen bg-white">
      {/* décor léger */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[5%] top-[-8%] h-80 w-80 rounded-full bg-violet-300/40 blur-2xl md:h-[28rem] md:w-[28rem]" />
        <div className="absolute right-[2%] top-[10%] h-72 w-72 rounded-full bg-indigo-300/40 blur-2xl md:h-[26rem] md:w-[26rem]" />
        <div className="absolute bottom-[-10%] left-[15%] h-72 w-72 rounded-full bg-emerald-300/40 blur-2xl md:h-[26rem] md:w-[26rem]" />
      </div>

      <header className="w-full bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 py-6 text-white shadow-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/15">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3z" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide text-white/80">Espace enseignant</div>
              <div className="text-lg font-extrabold">Choisir votre cahier</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className="rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-bold ring-1 ring-white/20"
              title={isOnline ? "Connexion détectée" : "Hors connexion"}
            >
              {isOnline ? "En ligne" : "Hors ligne"}
            </span>

            <Link
              href="/redirect"
              onClick={handleReturnClick}
              className="rounded-full bg-white/15 px-3.5 py-1.5 text-sm font-semibold text-white ring-1 ring-white/20 hover:bg-white/25"
              title="Retourner à l’application"
            >
              Retour
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-4 py-10 md:py-14">
        <p className="mx-auto max-w-2xl text-center text-slate-700">
          Sélectionnez le cahier pour démarrer. Vous pourrez changer à tout moment en revenant ici.
        </p>

        {!isOnline && (
          <p className="mx-auto mt-4 max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-900">
            Hors connexion : on évite la redirection serveur. Certaines pages fonctionneront si elles ont déjà été
            ouvertes une fois en ligne (cache).
          </p>
        )}

        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* Absences */}
          <Link
            href="/redirect?book=attendance"
            onClick={handleBookClick("attendance")}
            className="group block rounded-3xl border border-indigo-200 bg-white p-6 shadow-sm ring-1 ring-indigo-100 transition hover:shadow-md"
          >
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 flex-none place-items-center rounded-xl bg-indigo-600 text-white shadow-sm">
                <Notebook className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <div className="text-xl font-semibold text-slate-900">Cahier des absences</div>
                <p className="mt-1 text-sm text-slate-700">
                  Appel express, retards, validation et notifications immédiates aux parents.
                </p>
                <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-indigo-700">
                  Continuer <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </div>
              </div>
            </div>
          </Link>

          {/* Notes */}
          <Link
            href="/redirect?book=grades"
            onClick={handleBookClick("grades")}
            className="group block rounded-3xl border border-violet-200 bg-white p-6 shadow-sm ring-1 ring-violet-100 transition hover:shadow-md"
          >
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 flex-none place-items-center rounded-xl bg-violet-600 text-white shadow-sm">
                <NotebookPen className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <div className="text-xl font-semibold text-slate-900">Cahier de notes</div>
                <p className="mt-1 text-sm text-slate-700">
                  Évaluations, coefficients, calcul de moyennes et partage aux parents.
                </p>
                <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-violet-700">
                  Continuer <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </div>
              </div>
            </div>
          </Link>

          {/* Signature (active si teacher, sinon disabled) */}
          {sigEligibility === "eligible" ? SignatureCardEligible : SignatureCardDisabled}
        </div>
      </section>
    </main>
  );
}
