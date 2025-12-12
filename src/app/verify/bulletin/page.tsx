//src/app/verify/bulletin/page.tsx
"use client";

import React, { useEffect, useState } from "react";

export default function VerifyBulletinPage() {
  const [state, setState] = useState<{ loading: boolean; ok?: boolean; data?: any; error?: string }>({
    loading: true,
  });

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get("t") || "";
    (async () => {
      try {
        const r = await fetch(`/api/public/bulletins/verify?t=${encodeURIComponent(t)}`, {
          cache: "no-store",
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          setState({ loading: false, ok: false, error: j?.error || `HTTP ${r.status}` });
          return;
        }
        setState({ loading: false, ok: true, data: j?.data });
      } catch (e: any) {
        setState({ loading: false, ok: false, error: e?.message || "Erreur réseau" });
      }
    })();
  }, []);

  if (state.loading) {
    return <div className="p-6 text-sm text-slate-600">Vérification du bulletin…</div>;
  }

  if (!state.ok) {
    return (
      <div className="p-6">
        <div className="inline-flex rounded-full bg-rose-100 px-3 py-1 text-rose-800 text-sm font-medium">
          Bulletin invalide ❌
        </div>
        <div className="mt-3 text-sm text-slate-700">{state.error}</div>
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
        <div><b>Établissement :</b> {d?.institution?.name ?? "—"}</div>
        <div><b>Élève :</b> {d?.student?.full_name ?? "—"} ({d?.student?.matricule ?? "—"})</div>
        <div><b>Classe :</b> {d?.class?.name ?? "—"} {d?.class?.level ? `(${d.class.level})` : ""}</div>
        <div><b>Année scolaire :</b> {d?.academic_year ?? "—"}</div>
        <div><b>Période :</b> {d?.term_label ?? "—"}</div>
      </div>

      <div className="text-sm text-slate-600">
        Pour voir le bulletin complet, connectez-vous :
        <div className="mt-2 flex gap-2">
          <a className="rounded-lg bg-emerald-600 px-3 py-2 text-white text-sm" href="/login">Connexion admin</a>
          <a className="rounded-lg border px-3 py-2 text-sm" href="/parents/login">Connexion parent</a>
        </div>
      </div>
    </div>
  );
}
