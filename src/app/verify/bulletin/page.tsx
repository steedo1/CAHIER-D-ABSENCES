// src/app/verify/bulletin/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type VerifyState = {
  loading: boolean;
  ok: boolean;
  data?: any;
  error?: string;
  debug?: { apiStatus?: number; apiHeader?: string | null; tokenSample?: string };
};

function maskToken(t: string) {
  if (!t) return "";
  if (t.length <= 16) return `${t.slice(0, 4)}…${t.slice(-4)}`;
  return `${t.slice(0, 8)}…${t.slice(-8)}`;
}

export default function VerifyBulletinPage() {
  const sp = useSearchParams();

  const token = useMemo(() => (sp?.get("t") || "").trim(), [sp]);

  const [state, setState] = useState<VerifyState>({
    loading: true,
    ok: false,
  });

  useEffect(() => {
    // ✅ si token manquant, inutile d'appeler l'API
    if (!token) {
      setState({
        loading: false,
        ok: false,
        error: "Lien invalide : token manquant (paramètre ?t=...).",
        debug: { tokenSample: maskToken(token) },
      });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const url = `/api/public/bulletins/verify?t=${encodeURIComponent(token)}`;

        const r = await fetch(url, {
          cache: "no-store",
          headers: { accept: "application/json" },
        });

        const apiHeader = r.headers.get("x-qr-debug");
        const apiStatus = r.status;

        const j = await r.json().catch(() => ({}));

        if (cancelled) return;

        if (!r.ok) {
          setState({
            loading: false,
            ok: false,
            error: j?.error || `HTTP ${r.status}`,
            debug: { apiStatus, apiHeader, tokenSample: maskToken(token) },
          });
          return;
        }

        // ✅ on accepte soit {ok:true,data}, soit directement {data}
        const data = j?.data ?? j;

        setState({
          loading: false,
          ok: true,
          data,
          debug: { apiStatus, apiHeader, tokenSample: maskToken(token) },
        });
      } catch (e: any) {
        if (cancelled) return;
        setState({
          loading: false,
          ok: false,
          error: e?.message || "Erreur réseau",
          debug: { tokenSample: maskToken(token) },
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.loading) {
    return <div className="p-6 text-sm text-slate-600">Vérification du bulletin…</div>;
  }

  if (!state.ok) {
    return (
      <div className="p-6 space-y-3">
        <div className="inline-flex rounded-full bg-rose-100 px-3 py-1 text-rose-800 text-sm font-medium">
          Bulletin invalide ❌
        </div>
        <div className="text-sm text-slate-700">{state.error}</div>

        {/* Debug en dev (facultatif) */}
        {process.env.NODE_ENV !== "production" && state.debug && (
          <div className="rounded-xl border bg-white p-3 text-xs text-slate-600">
            <div><b>Debug</b></div>
            <div>token: {state.debug.tokenSample}</div>
            <div>apiStatus: {state.debug.apiStatus ?? "—"}</div>
            <div>x-qr-debug: {state.debug.apiHeader ?? "—"}</div>
          </div>
        )}
      </div>
    );
  }

  const d = state.data || {};

  return (
    <div className="p-6 space-y-3">
      <div className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-emerald-800 text-sm font-medium">
        Bulletin authentique ✅
      </div>

      <div className="rounded-xl border bg-white p-4 text-sm text-slate-800 space-y-2">
        <div>
          <b>Établissement :</b> {d?.institution?.name ?? "—"}
        </div>
        <div>
          <b>Élève :</b> {d?.student?.full_name ?? "—"} ({d?.student?.matricule ?? "—"})
        </div>
        <div>
          <b>Classe :</b> {d?.class?.name ?? "—"} {d?.class?.level ? `(${d.class.level})` : ""}
        </div>
        <div>
          <b>Année scolaire :</b> {d?.academic_year ?? "—"}
        </div>
        <div>
          <b>Période :</b> {d?.term_label ?? "—"}
        </div>
      </div>

      {/* Debug en dev (facultatif) */}
      {process.env.NODE_ENV !== "production" && state.debug && (
        <div className="rounded-xl border bg-white p-3 text-xs text-slate-600">
          <div><b>Debug</b></div>
          <div>token: {state.debug.tokenSample}</div>
          <div>apiStatus: {state.debug.apiStatus ?? "—"}</div>
          <div>x-qr-debug: {state.debug.apiHeader ?? "—"}</div>
        </div>
      )}

      <div className="text-sm text-slate-600">
        Pour voir le bulletin complet, connectez-vous :
        <div className="mt-2 flex gap-2">
          <a className="rounded-lg bg-emerald-600 px-3 py-2 text-white text-sm" href="/login">
            Connexion admin
          </a>
          <a className="rounded-lg border px-3 py-2 text-sm" href="/parents/login">
            Connexion parent
          </a>
        </div>
      </div>
    </div>
  );
}
