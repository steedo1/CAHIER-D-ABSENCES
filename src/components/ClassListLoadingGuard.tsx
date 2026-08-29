"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type GuardState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "stalled"; message: string; canRetry: boolean };

function cleanText(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function findLoadingCard() {
  return Array.from(document.querySelectorAll<HTMLElement>("div")).find(
    (element) => cleanText(element.textContent) === "Chargement de la liste…",
  );
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
  }
}

export default function ClassListLoadingGuard() {
  const pathname = usePathname();
  const isClassListPage = Boolean(pathname?.startsWith("/admin/classes/liste/"));
  const [state, setState] = useState<GuardState>({ kind: "idle" });

  useEffect(() => {
    if (!isClassListPage) {
      setState({ kind: "idle" });
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    const runCheck = async () => {
      if (cancelled || !findLoadingCard()) return;
      setState({ kind: "checking" });

      const classId = decodeURIComponent(pathname?.split("/").pop() || "").trim();
      const academicYear = new URLSearchParams(window.location.search).get("academic_year") || "";
      const qs = academicYear
        ? `?academic_year=${encodeURIComponent(academicYear)}`
        : "";

      if (!classId) {
        if (!cancelled) {
          setState({
            kind: "stalled",
            message: "Le lien de cette classe est invalide.",
            canRetry: false,
          });
        }
        return;
      }

      try {
        const [rosterResult, organizationResult] = await Promise.allSettled([
          fetchWithTimeout(
            `/api/admin/classes/${encodeURIComponent(classId)}/roster${qs}`,
            9000,
          ),
          fetchWithTimeout("/api/admin/institution/education-organization", 9000),
        ]);

        if (cancelled || !findLoadingCard()) return;

        if (rosterResult.status === "fulfilled") {
          const roster = rosterResult.value;
          if (roster.status === 404) {
            setState({
              kind: "stalled",
              message:
                "Cette classe n’est plus disponible ou ce lien est devenu obsolète. Revenez à la liste des classes puis ouvrez la classe actuelle.",
              canRetry: false,
            });
            return;
          }
          if (roster.status === 401) {
            setState({
              kind: "stalled",
              message: "Votre session a expiré. Reconnectez-vous puis réessayez.",
              canRetry: true,
            });
            return;
          }
          if (!roster.ok) {
            setState({
              kind: "stalled",
              message: `Le chargement de la liste a échoué (erreur ${roster.status}).`,
              canRetry: true,
            });
            return;
          }

          if (
            organizationResult.status === "rejected" ||
            (organizationResult.status === "fulfilled" && !organizationResult.value.ok)
          ) {
            setState({
              kind: "stalled",
              message:
                "La liste des élèves répond, mais un service secondaire ralentit l’écran. Réessayez : la page ne doit plus rester bloquée indéfiniment.",
              canRetry: true,
            });
            return;
          }

          setState({
            kind: "stalled",
            message:
              "Les données répondent correctement mais l’écran est resté bloqué. Rechargez cette page pour reprendre immédiatement.",
            canRetry: true,
          });
          return;
        }

        setState({
          kind: "stalled",
          message:
            "La connexion est trop lente ou interrompue. La page ne restera plus bloquée sans explication.",
          canRetry: true,
        });
      } catch {
        if (!cancelled) {
          setState({
            kind: "stalled",
            message:
              "La connexion est trop lente ou interrompue. Réessayez le chargement.",
            canRetry: true,
          });
        }
      }
    };

    const arm = () => {
      if (cancelled) return;
      const loadingCard = findLoadingCard();
      if (!loadingCard) {
        setState({ kind: "idle" });
        if (timer !== null) {
          window.clearTimeout(timer);
          timer = null;
        }
        return;
      }
      if (timer === null) {
        timer = window.setTimeout(() => {
          timer = null;
          void runCheck();
        }, 8000);
      }
    };

    arm();
    const observer = new MutationObserver(arm);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      observer.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [isClassListPage, pathname]);

  if (!isClassListPage || state.kind === "idle") return null;

  return (
    <div className="fixed inset-x-0 bottom-5 z-[2000] mx-auto w-[min(92vw,760px)] rounded-2xl border border-amber-300 bg-white p-4 shadow-2xl print:hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-semibold text-slate-950">
            {state.kind === "checking" ? "Vérification du chargement…" : "Chargement bloqué"}
          </div>
          {state.kind === "stalled" ? (
            <div className="mt-1 text-sm text-slate-700">{state.message}</div>
          ) : (
            <div className="mt-1 text-sm text-slate-600">
              La liste met anormalement longtemps à s’afficher. Je vérifie la réponse du serveur.
            </div>
          )}
        </div>
        {state.kind === "stalled" ? (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => window.history.back()}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Retour
            </button>
            {state.canRetry ? (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Réessayer
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
