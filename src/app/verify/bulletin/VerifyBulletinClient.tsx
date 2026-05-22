// src/app/verify/bulletin/VerifyBulletinClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type VerifyState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: any }
  | { status: "error"; error: string };

type SubjectRow = {
  id: string;
  name: string;
  avg: number | null;
  coeff: number | null;
  total: number | null;
};

function formatNumber(value: unknown, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function formatDateFR(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("fr-FR");
}

function getInstitutionLogoUrl(data: any) {
  const inst = data?.institution ?? {};
  return String(
    inst?.institution_logo_url ||
      inst?.logo_url ||
      inst?.settings_json?.institution_logo_url ||
      ""
  ).trim();
}

function buildSubjectRows(data: any): SubjectRow[] {
  const subjects = Array.isArray(data?.subjects) ? data.subjects : [];
  const perSubject = Array.isArray(data?.bulletin?.per_subject)
    ? data.bulletin.per_subject
    : [];

  const perSubjectMap = new Map<string, any>();
  for (const item of perSubject) {
    const sid = String(item?.subject_id ?? "");
    if (sid) perSubjectMap.set(sid, item);
  }

  return subjects
    .map((subject: any) => {
      const id = String(subject?.subject_id ?? subject?.id ?? "");
      const note = perSubjectMap.get(id);
      if (!id || !note) return null;

      const avg = Number(note?.avg20);
      const coeff = Number(subject?.coeff_bulletin ?? note?.coeff ?? 0);
      const total =
        Number.isFinite(avg) && Number.isFinite(coeff) && coeff > 0
          ? Math.round(avg * coeff * 100) / 100
          : null;

      return {
        id,
        name: String(subject?.subject_name ?? subject?.name ?? "Matière"),
        avg: Number.isFinite(avg) ? avg : null,
        coeff: Number.isFinite(coeff) && coeff > 0 ? coeff : null,
        total,
      };
    })
    .filter(Boolean) as SubjectRow[];
}

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
    return (
      <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-lg font-semibold text-slate-900">
            Vérification en cours…
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Lecture sécurisée des données officielles du bulletin.
          </p>
        </div>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-5xl rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
          <div className="text-lg font-bold text-rose-700">QR invalide</div>
          <div className="mt-2 text-sm text-slate-700">{state.error}</div>
        </div>
      </main>
    );
  }

  const data = state.data;
  const inst = data?.institution ?? {};
  const cls = data?.class ?? {};
  const stu = data?.student ?? {};
  const period = data?.period ?? {};
  const bulletin = data?.bulletin ?? {};
  const logoUrl = getInstitutionLogoUrl(data);
  const subjectRows = buildSubjectRows(data);
  const conductAvg = Number(data?.conduct?.avg20 ?? data?.conduct?.total);
  const hasConduct = Number.isFinite(conductAvg);
  const annualAvg = Number(bulletin?.annual_avg);
  const hasAnnual = Number.isFinite(annualAvg);

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="relative mx-auto max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 h-[72%] max-h-[560px] -translate-x-1/2 -translate-y-1/2 object-contain opacity-[0.055]"
          />
        ) : null}

        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt="Logo établissement"
                className="h-14 w-14 rounded-xl border border-slate-200 object-contain p-1"
              />
            ) : null}
            <div>
              <h1 className="text-xl font-extrabold text-slate-900">
                Vérification du bulletin
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Contrôle public d’authenticité et des moyennes officielles.
              </p>
            </div>
          </div>

          <span className="inline-flex w-fit rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">
            BULLETIN VALIDE
          </span>
        </div>

        <div className="relative mt-6 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Établissement
            </div>
            <div className="mt-1 font-semibold text-slate-900">
              {inst?.name ?? inst?.institution_name ?? "—"}
            </div>
            {inst?.code ? (
              <div className="mt-1 text-sm text-slate-600">Code : {inst.code}</div>
            ) : null}
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Élève</div>
            <div className="mt-1 font-semibold text-slate-900">
              {stu?.full_name ?? "—"}
            </div>
            {stu?.matricule ? (
              <div className="mt-1 text-sm text-slate-600">
                Matricule : {stu.matricule}
              </div>
            ) : null}
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Classe</div>
            <div className="mt-1 font-semibold text-slate-900">
              {cls?.label ?? cls?.name ?? "—"}
            </div>
            {(cls?.academic_year || period?.academic_year) && (
              <div className="mt-1 text-sm text-slate-600">
                Année : {cls?.academic_year ?? period?.academic_year}
              </div>
            )}
            {(period?.short_label || period?.label) && (
              <div className="mt-1 text-sm text-slate-600">
                Période : {period?.short_label ?? period?.label}
              </div>
            )}
          </div>
        </div>

        <div className="relative mt-6 rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/50 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">
                Résultat officiel vérifié
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Ces valeurs proviennent des notes officielles publiées dans Mon Cahier.
              </p>
            </div>
            {(period?.from || period?.to) && (
              <div className="text-xs text-slate-600">
                {formatDateFR(period?.from)} → {formatDateFR(period?.to)}
              </div>
            )}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-emerald-100">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                Moyenne de la période
              </div>
              <div className="mt-2 text-2xl font-extrabold text-emerald-900">
                {formatNumber(bulletin?.general_avg)} / 20
              </div>
            </div>

            <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                Moyenne annuelle
              </div>
              <div className="mt-2 text-2xl font-extrabold text-slate-900">
                {hasAnnual ? `${formatNumber(annualAvg)} / 20` : "—"}
              </div>
            </div>

            <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-amber-100">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                Moyenne de conduite
              </div>
              <div className="mt-2 text-2xl font-extrabold text-amber-900">
                {hasConduct ? `${formatNumber(conductAvg)} / 20` : "—"}
              </div>
            </div>
          </div>

          {subjectRows.length > 0 ? (
            <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-sm font-semibold text-slate-800">
                  Notes par matière
                </div>
                <div className="text-xs text-slate-500">
                  Affichage public des moyennes utilisées pour vérifier le bulletin.
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left">Matière</th>
                      <th className="px-3 py-2 text-center">Moy.</th>
                      <th className="px-3 py-2 text-center">Coef.</th>
                      <th className="px-3 py-2 text-center">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subjectRows.map((row) => (
                      <tr key={row.id} className="border-t border-slate-200">
                        <td className="px-3 py-2 font-medium text-slate-900">
                          {row.name}
                        </td>
                        <td className="px-3 py-2 text-center">{formatNumber(row.avg)}</td>
                        <td className="px-3 py-2 text-center">
                          {formatNumber(row.coeff, 0)}
                        </td>
                        <td className="px-3 py-2 text-center">{formatNumber(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <p className="mt-4 text-[11px] leading-snug text-slate-500">
            En cas d’écart entre une ancienne capture papier et cette page, il faut revérifier
            le bulletin imprimé depuis la dernière version publiée.
          </p>
        </div>
      </div>
    </main>
  );
}
