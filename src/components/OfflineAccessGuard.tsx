"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/app/providers";
import LoginCard from "@/components/auth/LoginCard";
import {
  OFFLINE_AUTH_STATE_EVENT,
  clearOfflineLogoutLock,
  getActiveOfflineAccess,
  getOfflineAccessIntent,
  getOfflineLogoutLock,
} from "@/lib/offline-auth-client";
import {
  isOfflineAccessPath,
  isOfflinePathAllowedForRole,
} from "@/lib/offline-auth-contract";

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
  | {
      status: "blocked";
      destination: string | null;
      reason: string;
      inline_reauth?: boolean;
    };

export default function OfflineAccessGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { session, loading } = useAuth();
  const [state, setState] = useState<GuardState>({ status: "checking" });
  const [authRevision, setAuthRevision] = useState(0);

  useEffect(() => {
    const handleOfflineAuthState = () =>
      setAuthRevision((value) => value + 1);
    window.addEventListener(OFFLINE_AUTH_STATE_EVENT, handleOfflineAuthState);
    return () =>
      window.removeEventListener(
        OFFLINE_AUTH_STATE_EVENT,
        handleOfflineAuthState,
      );
  }, []);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (!pathname || PUBLIC_PATHS.has(pathname)) {
        if (!cancelled) setState({ status: "allowed" });
        return;
      }

      const logoutLock = getOfflineLogoutLock();
      if (logoutLock === pathname && pathname === "/class") {
        if (!cancelled) {
          setState({
            status: "blocked",
            destination: pathname,
            reason:
              "Téléphone verrouillé après déconnexion. Saisis de nouveau les identifiants autorisés sur cet appareil.",
            inline_reauth: true,
          });
        }
        return;
      }

      // Une vraie session Cloud reste prioritaire. Un appareil déjà préparé
      // hors ligne ne doit jamais réduire l'espace Admin lorsque Supabase est
      // disponible et que l'utilisateur possède une session normale.
      if (session) {
        setState({ status: "allowed" });
        return;
      }

      const intent = await getOfflineAccessIntent();
      if (cancelled) return;
      if (intent) {
        if (!isOfflinePathAllowedForRole(intent.payload.role, pathname)) {
          setState({
            status: "blocked",
            destination: intent.payload.destination,
            reason:
              "Cette page n’est pas disponible dans le périmètre hors ligne préparé pour ce rôle.",
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

      // Sans session Cloud ni preuve locale, un document PWA mis en cache ne
      // doit pas devenir un contournement du middleware.
      if (isClientProtectedPath(pathname)) {
        setState({
          status: "blocked",
          destination: null,
          reason: isOfflineAccessPath(pathname)
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
  }, [authRevision, loading, pathname, session]);

  if (loading || state.status === "checking") {
    if (!pathname || !isClientProtectedPath(pathname)) return children;
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-sm text-slate-600">
        Vérification de l’accès…
      </main>
    );
  }

  if (
    state.status === "blocked" &&
    state.inline_reauth &&
    pathname === "/class"
  ) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md">
          <LoginCard
            forcedMode="phoneOnly"
            redirectTo="/class"
            onAuthenticated={async (destination) => {
              if (destination !== "/class") {
                throw new Error(
                  "Cette autorisation hors ligne ne correspond pas au téléphone de classe.",
                );
              }
              clearOfflineLogoutLock();
              setState({ status: "allowed" });
            }}
          />
        </div>
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
