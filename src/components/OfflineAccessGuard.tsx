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
import { useRelayCapability } from "@/components/RelayCapabilityProvider";
import { assertOfflineFunctionPrepared } from "@/lib/offline-auth-readiness";

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
  const {
    relayEnabled,
    resolved: relayCapabilityResolved,
  } = useRelayCapability();
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
        // Le worker ramène le démarrage / de la PWA vers le login préparé
        // quand le Cloud ne répond pas, même si le Wi-Fi paraît connecté.
        const offlineEntry = navigator.onLine === false ||
          new URLSearchParams(window.location.search).get("offline_resume") === "1";
        if ((pathname === "/" || pathname === "/login") && offlineEntry) {
          const intent = await getOfflineAccessIntent();
          if (!intent || cancelled || getOfflineLogoutLock()) return;
          try {
            await assertOfflineFunctionPrepared(intent.payload);
            if (!cancelled && !getOfflineLogoutLock()) {
              window.location.replace(intent.payload.destination);
            }
          } catch {
            // Une préparation incomplète reste sur le formulaire de connexion.
          }
        }
        return;
      }

      const logoutLock = getOfflineLogoutLock();
      if (logoutLock) {
        if (!cancelled) {
          setState({
            status: "blocked",
            destination: logoutLock,
            reason:
              "Téléphone verrouillé après déconnexion. Saisis de nouveau les identifiants autorisés sur cet appareil.",
            inline_reauth: logoutLock === pathname &&
              (pathname === "/class" || pathname === "/attendance"),
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

      if (pathname.startsWith("/admin") && !relayCapabilityResolved) return;

      const intent = await getOfflineAccessIntent();
      if (cancelled) return;
      if (intent) {
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
        // Sans Relais, une coupure réseau conserve la page Cloud/PWA courante :
        // elle ne transforme jamais le grant Admin en navigation réduite Relais.
        if (
          intent.payload.role === "admin" &&
          pathname.startsWith("/admin") &&
          !relayEnabled
        ) {
          setState({ status: "allowed" });
          return;
        }
        if (!isOfflinePathAllowedForRole(intent.payload.role, pathname)) {
          setState({
            status: "blocked",
            destination: intent.payload.destination,
            reason:
              "Cette page n’est pas disponible dans le périmètre hors ligne préparé pour ce rôle.",
          });
          return;
        }
        try {
          if (intent.payload.role !== "admin") {
            await assertOfflineFunctionPrepared(intent.payload);
          }
        } catch {
          if (!cancelled) setState({
            status: "blocked",
            destination: null,
            reason: "Cet espace doit être préparé avec Internet avant de reprendre l’appel hors ligne.",
          });
          return;
        }
        if (cancelled) return;
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
          inline_reauth: pathname === "/class" || pathname === "/attendance",
        });
        return;
      }
      setState({ status: "allowed" });
    };

    if (!loading) void check();
    return () => {
      cancelled = true;
    };
  }, [
    authRevision,
    loading,
    pathname,
    relayCapabilityResolved,
    relayEnabled,
    session,
  ]);

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
    (pathname === "/class" || pathname === "/attendance")
  ) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md">
          <LoginCard
            forcedMode={pathname === "/class" ? "phoneOnly" : undefined}
            redirectTo={pathname}
            requiredDestination={pathname}
            onAuthenticated={async (destination) => {
              if (destination !== pathname) {
                throw new Error(
                  "Ces identifiants ne correspondent pas à cet espace d’appel.",
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
