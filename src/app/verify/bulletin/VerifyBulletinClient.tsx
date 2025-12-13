//src/app/verify/bulletin/VerifyBulletinClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type VerifyState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: any }
  | { status: "error"; error: string };

export default function VerifyBulletinClient() {
  const sp = useSearchParams();
  const token = useMemo(() => sp.get("t") ?? "", [sp]);

  const [state, setState] = useState<VerifyState>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!token) {
        setState({
          status: "error",
          error: "Paramètre 't' manquant dans l'URL.",
        });
        return;
      }

      setState({ status: "loading" });

      try {
        const res = await fetch(
          `/api/public/bulletins/verify?t=${encodeURIComponent(token)}`,
          { cache: "no-store" }
        );

        const json = await res.json();

        if (cancelled) return;

        if (!res.ok || !json?.ok) {
          throw new Error(json?.error ?? "Vérification impossible.");
        }

        setState({ status: "ok", data: json });
      } catch (e: any) {
        if (cancelled) return;
        setState({
          status: "error",
          error: e?.message ?? "Erreur inconnue.",
        });
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.status === "idle" || state.status === "loading") {
    return <div className="p-6 text-sm">Vérification en cours…</div>;
  }

  if (state.status === "error") {
    return (
      <div className="p-6">
        <div className="text-lg font-semibold">QR invalide</div>
        <div className="mt-2 text-sm opacity-80">{state.error}</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="text-lg font-semibold">Bulletin vérifié ✅</div>
      <pre className="mt-4 overflow-auto rounded border p-3 text-xs">
        {JSON.stringify(state.data, null, 2)}
      </pre>
    </div>
  );
}
