"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/app/providers";
import {
  getActiveOfflineAccess,
  getOfflineAccessIntent,
} from "@/lib/offline-auth-client";
import { isOfflineAccessDestination } from "@/lib/offline-auth-contract";

const PUBLIC_PATHS = new Set(["/", "/login", "/recover", "/redirect"]);
const CLIENT_PROTECTED_PREFIXES = [
  "/attendance",
  "/class",
  "/choose-book",
  "/grades",
  "/enseignant",
  "/admin",
  "/super",
  "/founder",
  "/parent",
  "/parents",
  "/profile",
];

function isClientProtectedPath(pathname: string) {
  return CLIENT_PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

type GuardState =
  | { status: "checking" }
  | { status: "allowed" }
  | { status: "blocked"; destination: string | null; reason: string };

export default function OfflineAccessGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { session, loading } = useAuth();
  const [state, setState] = useState<GuardState>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (!pathname || PUBLIC_PATHS.has(pathname)) {
        if (!cancelled) setState({ status: "allowed" });
        return;
      }

      const intent = await getOfflineAccessIntent();
      if (cancelled) return;
      if (intent) {
        if (pathname !== intent.payload.destination) {
          setState({
            status: "blocked",
            destination: intent.payload.destination,
            reason:
              "La connexion hors ligne autorise uniquement la fonction préparée pour ce rôle.",
          });
          return;
        }
        const active = await getActiveOfflineAccess();
        if (cancelled) return;
        if (!active) {
          setState({
            status: "blocked",
            destination: null,
            reason: "La preuve locale de cette session n’est plus valide.",
          });
          return;
        }
        setState({ status: "allowed" });
        return;
      }

      // Une session Supabase déjà ouverte continue normalement pendant une
      // coupure. Sans session ni preuve locale, un document PWA mis en cache ne
      // doit pas devenir un contournement du middleware.
      if (!session && isClientProtectedPath(pathname)) {
        setState({
          status: "blocked",
          destination: null,
          reason: isOfflineAccessDestination(pathname)
            ? "Reconnectez-vous sur cet appareil pour ouvrir cet espace."
            : "Cette page ne fait pas partie des fonctions autorisées hors ligne.",
        });
        return;
      }
      setState({ status: "allowed" });
    };

    if (!loading) void check();
    return () => {
      cancelled = true;
    };
  }, [loading, pathname, session]);

  if (loading || state.status === "checking") {
    if (!pathname || !isClientProtectedPath(pathname)) return children;
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-sm text-slate-600">
        Vérification de l’accès…
      </main>
    );
  }

  if (state.status === "blocked") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <section className="w-full max-w-md rounded-3xl border border-amber-200 bg-white p-6 text-center shadow-xl">
          <h1 className="text-lg font-bold text-slate-950">Accès hors ligne limité</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{state.reason}</p>
          <a
            href={state.destination || "/login"}
            className="mt-5 inline-flex rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
          >
            {state.destination ? "Retour à l’espace autorisé" : "Se connecter"}
          </a>
        </section>
      </main>
    );
  }

  return children;
}
