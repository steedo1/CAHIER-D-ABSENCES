// src/app/v/[code]/page.tsx
import { headers } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Récupère l’origin public à partir des headers (robuste local/prod) */
async function getOriginFromHeaders() {
  const h = await headers();

  const host =
    h.get("x-forwarded-host") ??
    h.get("host") ??
    (process.env.VERCEL_URL ? process.env.VERCEL_URL : null) ??
    null;

  if (!host) {
    const fallback =
      process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "";
    return fallback;
  }

  const protoHeader =
    h.get("x-forwarded-proto") ?? h.get("x-forwarded-protocol") ?? null;

  const isLocal =
    host.includes("localhost") ||
    host.includes("127.0.0.1") ||
    host.includes("0.0.0.0");

  const proto = protoHeader ?? (isLocal ? "http" : "https");

  const normalizedHost =
    host.startsWith("http://") || host.startsWith("https://")
      ? host
      : `${proto}://${host}`;

  return normalizedHost;
}

/**
 * ✅ Détecte si la période est ANNUELLE
 * Important: ne pas confondre avec "année scolaire ..." dans un label de trimestre/semestre.
 */
function looksAnnualPeriod(period: any): boolean {
  if (!period) return false;

  const codeRaw = String(period?.code ?? "").trim();
  const shortRaw = String(period?.short_label ?? "").trim();
  const labelRaw = String(period?.label ?? "").trim();

  const codeUp = codeRaw.toUpperCase();
  const shortUp = shortRaw.toUpperCase();
  const labelLow = labelRaw.toLowerCase();

  if (shortUp.startsWith("T") || shortUp.startsWith("S")) return false;
  if (codeUp.startsWith("T") || codeUp.startsWith("S")) return false;
  if (labelLow.includes("trimestre") || labelLow.includes("semestre")) return false;

  const txt = `${codeRaw} ${shortRaw} ${labelRaw}`.toLowerCase();

  if (txt.includes("annuel") || txt.includes("annuelle") || txt.includes("annual")) {
    return true;
  }

  if (
    (txt.includes("année") || txt.includes("annee") || txt.includes("year")) &&
    !txt.includes("année scolaire") &&
    !txt.includes("annee scolaire") &&
    !txt.includes("academic year")
  ) {
    return true;
  }

  if (["A", "AN", "ANN", "YR", "YEAR"].includes(codeUp)) return true;
  if (["A", "AN", "ANN", "YR", "YEAR"].includes(shortUp)) return true;

  return false;
}

function mainAvgLabel(period: any): string {
  if (!period) return "Moyenne de la période";

  const shortUp = String(period?.short_label ?? "").trim().toUpperCase();
  const label = String(period?.label ?? "").trim().toLowerCase();
  const code = String(period?.code ?? "").trim().toUpperCase();

  if (looksAnnualPeriod(period)) return "Moyenne annuelle";

  if (shortUp.startsWith("T") || label.includes("trimestre") || code.startsWith("T")) {
    return "Moyenne du trimestre";
  }

  if (shortUp.startsWith("S") || label.includes("semestre") || code.startsWith("S")) {
    return "Moyenne du semestre";
  }

  return "Moyenne de la période";
}

function formatAvg20(n: any): string {
  return typeof n === "number" && Number.isFinite(n)
    ? `${Number(n).toFixed(2)} / 20`
    : "—";
}

function formatNum(n: any, digits = 2): string {
  return typeof n === "number" && Number.isFinite(n)
    ? Number(n).toFixed(digits)
    : "—";
}

function computeDisplayedGroupCoeff(group: any, subjects: any[]): number {
  const items = Array.isArray(group?.items) ? group.items : [];
  let sum = 0;

  for (const it of items) {
    const override = Number(it?.subject_coeff_override ?? NaN);
    if (Number.isFinite(override) && override > 0) {
      sum += override;
      continue;
    }

    const subj = subjects.find((s: any) => s.subject_id === it?.subject_id);
    const coeff = Number(subj?.coeff_bulletin ?? 0);
    if (Number.isFinite(coeff) && coeff > 0) sum += coeff;
  }

  return Number(sum.toFixed(2));
}

function computeDisplayedGroupTotal(groupAvg: any, groupCoeff: number): number | null {
  const avg = Number(groupAvg);
  if (!Number.isFinite(avg)) return null;
  if (!Number.isFinite(groupCoeff) || groupCoeff <= 0) return null;
  return Number((avg * groupCoeff).toFixed(2));
}

function subjectCountInGroup(group: any): number {
  return Array.isArray(group?.items) ? group.items.length : 0;
}

export default async function VerifyByCodePage(props: any) {
  const code = String(props?.params?.code ?? "").trim();
  const origin = await getOriginFromHeaders();

  const searchParams = (props as any)?.searchParams ?? {};
  const debugEnabled = ["1", "true", "yes"].includes(
    String(searchParams?.debug ?? "").toLowerCase()
  );

  let res: Response | null = null;
  let data: any = null;

  try {
    const url = new URL("/api/public/bulletins/verify", origin);
    url.searchParams.set("c", code);

    res = await fetch(url.toString(), { cache: "no-store" });
    data = await res.json().catch(() => null);
  } catch {
    res = null;
    data = null;
  }

  const ok = !!(res?.ok && data?.ok);

  const inst = data?.institution ?? null;
  const cls = data?.class ?? null;
  const stu = data?.student ?? null;
  const bulletin = data?.bulletin ?? null;

  const period = data?.period ?? null;
  const subjects: any[] = Array.isArray(data?.subjects) ? data.subjects : [];
  const subjectGroups: any[] = Array.isArray(data?.subject_groups)
    ? data.subject_groups
    : [];

  const perSubjectWithAvg =
    bulletin && Array.isArray(bulletin?.per_subject)
      ? bulletin.per_subject.filter(
          (ps: any) => typeof ps?.avg20 === "number" && Number.isFinite(ps.avg20)
        )
      : [];

  const perGroupWithAvg =
    bulletin && Array.isArray(bulletin?.per_group)
      ? bulletin.per_group.filter(
          (pg: any) =>
            typeof pg?.group_avg === "number" && Number.isFinite(pg.group_avg)
        )
      : [];

  const isAnnual = looksAnnualPeriod(period);
  const labelMain = mainAvgLabel(period);
  const showAnnualAvg =
    !isAnnual &&
    typeof bulletin?.annual_avg === "number" &&
    Number.isFinite(bulletin.annual_avg);

  const debugPayload = debugEnabled
    ? {
        code,
        origin,
        api: {
          ok: !!res?.ok,
          status: res?.status ?? null,
        },
        period,
        averages: {
          general_avg: bulletin?.general_avg ?? null,
          annual_avg: bulletin?.annual_avg ?? null,
          labelMain,
          isAnnual,
        },
        counts: {
          subjects: subjects.length,
          subject_groups: subjectGroups.length,
          per_subject: Array.isArray(bulletin?.per_subject)
            ? bulletin.per_subject.length
            : 0,
          per_group: Array.isArray(bulletin?.per_group)
            ? bulletin.per_group.length
            : 0,
          perSubjectWithAvg: perSubjectWithAvg.length,
          perGroupWithAvg: perGroupWithAvg.length,
        },
      }
    : null;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-100 via-slate-50 to-white px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_20px_60px_-20px_rgba(15,23,42,0.18)]">
          <div className="border-b border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-900 px-6 py-6 text-white sm:px-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200/90">
                  Vérification officielle
                </div>
                <h1 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
                  Bulletin scolaire
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-slate-200">
                  Cette page affiche les données officielles enregistrées dans Mon Cahier
                  pour contrôle d’authenticité.
                </p>
              </div>

              <div className="flex flex-col items-start gap-2 sm:items-end">
                <span
                  className={
                    "inline-flex items-center rounded-full px-4 py-1.5 text-sm font-bold shadow-sm " +
                    (ok
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-rose-100 text-rose-800")
                  }
                >
                  {ok ? "✓ Bulletin valide" : "✕ Bulletin invalide"}
                </span>
                <div className="text-xs text-slate-300">
                  Référence QR : <span className="font-semibold text-white">{code || "—"}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="px-6 py-6 sm:px-8">
            {!res ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                Impossible de joindre le serveur de vérification pour le moment.
              </div>
            ) : !ok ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-900">
                Ce QR code est invalide, expiré ou a été révoqué.
              </div>
            ) : (
              <>
                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Établissement
                    </div>
                    <div className="mt-2 text-lg font-bold text-slate-900">
                      {inst?.name ?? inst?.institution_name ?? "—"}
                    </div>
                    {inst?.code ? (
                      <div className="mt-1 text-sm text-slate-600">Code : {inst.code}</div>
                    ) : null}
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Élève
                    </div>
                    <div className="mt-2 text-lg font-bold text-slate-900">
                      {stu?.full_name ?? "—"}
                    </div>
                    {stu?.matricule ? (
                      <div className="mt-1 text-sm text-slate-600">
                        Matricule : {stu.matricule}
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Classe
                    </div>
                    <div className="mt-2 text-lg font-bold text-slate-900">
                      {cls?.label ?? cls?.name ?? "—"}
                    </div>
                    {(cls?.academic_year || period?.academic_year) && (
                      <div className="mt-1 text-sm text-slate-600">
                        Année : {cls?.academic_year ?? period?.academic_year}
                      </div>
                    )}
                  </div>
                </div>

                {bulletin && (
                  <div className="mt-6 space-y-6">
                    <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/70 shadow-sm">
                      <div className="border-b border-emerald-100 px-5 py-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                          Synthèse officielle
                        </div>
                        <h2 className="mt-1 text-lg font-bold text-slate-900">
                          Récapitulatif des moyennes
                        </h2>
                      </div>

                      <div className="grid gap-4 p-5 md:grid-cols-2">
                        <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
                          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                            {labelMain}
                          </div>
                          <div className="mt-2 text-3xl font-extrabold text-slate-900">
                            {formatAvg20(bulletin.general_avg)}
                          </div>
                          {period && (
                            <div className="mt-2 text-xs text-slate-500">
                              {period.short_label ?? period.label ?? "Période"}
                              {period.from && period.to
                                ? ` • ${period.from} → ${period.to}`
                                : ""}
                            </div>
                          )}
                        </div>

                        {showAnnualAvg ? (
                          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                              Moyenne annuelle
                            </div>
                            <div className="mt-2 text-3xl font-extrabold text-slate-900">
                              {formatAvg20(bulletin.annual_avg)}
                            </div>
                            <div className="mt-2 text-xs text-slate-500">
                              Visible car la période actuelle n’est pas annuelle.
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                              Statut
                            </div>
                            <div className="mt-2 text-base font-semibold text-slate-900">
                              {isAnnual ? "Période annuelle détectée" : "Calcul officiel confirmé"}
                            </div>
                            <div className="mt-2 text-xs text-slate-500">
                              Les valeurs affichées proviennent directement de la base Mon Cahier.
                            </div>
                          </div>
                        )}
                      </div>
                    </section>

                    {perGroupWithAvg.length > 0 && subjectGroups.length > 0 && (
                      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <div className="border-b border-slate-100 px-5 py-4">
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Bilans officiels
                          </div>
                          <h2 className="mt-1 text-lg font-bold text-slate-900">
                            Bilans par groupe de matières
                          </h2>
                        </div>

                        <div className="divide-y divide-slate-100">
                          {perGroupWithAvg.map((pg: any) => {
                            const group = subjectGroups.find((g: any) => g.id === pg.group_id);
                            if (!group) return null;

                            const coeff = computeDisplayedGroupCoeff(group, subjects);
                            const total = computeDisplayedGroupTotal(pg.group_avg, coeff);
                            const itemCount = subjectCountInGroup(group);

                            return (
                              <div
                                key={pg.group_id}
                                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-base font-bold text-slate-900">
                                      {group.label ?? group.code ?? "Bilan"}
                                    </span>
                                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                      {itemCount} matière{itemCount > 1 ? "s" : ""}
                                    </span>
                                  </div>

                                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                                    <span>Coeff. total : {formatNum(coeff)}</span>
                                    <span>Total pondéré : {total !== null ? formatNum(total) : "—"}</span>
                                  </div>
                                </div>

                                <div className="shrink-0 rounded-2xl bg-slate-50 px-4 py-3 text-right">
                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                    Moyenne du bilan
                                  </div>
                                  <div className="mt-1 text-xl font-extrabold text-slate-900">
                                    {formatAvg20(pg.group_avg)}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    )}

                    {perSubjectWithAvg.length > 0 && (
                      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <div className="border-b border-slate-100 px-5 py-4">
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Détail officiel
                          </div>
                          <h2 className="mt-1 text-lg font-bold text-slate-900">
                            Moyennes par matière
                          </h2>
                        </div>

                        <div className="divide-y divide-slate-100">
                          {perSubjectWithAvg.map((ps: any) => {
                            const subj = subjects.find(
                              (s: any) => s.subject_id === ps.subject_id
                            );
                            if (!subj) return null;

                            return (
                              <div
                                key={ps.subject_id}
                                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div className="min-w-0">
                                  <div className="text-base font-semibold text-slate-900">
                                    {subj.subject_name}
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                                    <span>Coeff. bulletin : {formatNum(subj.coeff_bulletin)}</span>
                                    <span>
                                      {subj.include_in_average === false
                                        ? "Hors moyenne générale"
                                        : "Pris en compte dans la moyenne générale"}
                                    </span>
                                  </div>
                                </div>

                                <div className="shrink-0 rounded-2xl bg-slate-50 px-4 py-3 text-right">
                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                    Moyenne
                                  </div>
                                  <div className="mt-1 text-xl font-extrabold text-slate-900">
                                    {formatAvg20(ps.avg20)}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    )}

                    <section className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600">
                      Les informations affichées sur cette page proviennent directement de la
                      base officielle Mon Cahier. En cas d’écart avec une version papier ou une
                      copie modifiée, ce récapitulatif fait foi pour la vérification.
                    </section>

                    {debugEnabled && (
                      <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Debug
                        </div>
                        <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-[11px] text-slate-700">
                          {JSON.stringify(debugPayload, null, 2)}
                        </pre>
                      </section>
                    )}
                  </div>
                )}

                <div className="mt-6 border-t border-slate-200 pt-4 text-xs text-slate-500">
                  Vérification d’authenticité du bulletin via code sécurisé.
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}