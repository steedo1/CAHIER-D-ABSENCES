// src/app/v/[code]/page.tsx
import { Fragment } from "react";
import { headers } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function formatNumber(n: number | null | undefined, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return Number(n).toFixed(digits);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function formatDateFR(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("fr-FR");
}

function normalizeGroupKey(value?: string | null) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function isAutresGroup(group: any) {
  const a = normalizeGroupKey(group?.label);
  const b = normalizeGroupKey(group?.code);
  return (
    a.includes("AUTRES") ||
    a.includes("DIVERS") ||
    a.includes("CONDUITE") ||
    b.includes("AUTRES") ||
    b.includes("DIVERS") ||
    b.includes("CONDUITE")
  );
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
    ? data.subject_groups.filter((g: any) => g?.is_active !== false)
    : [];
  const subjectComponents: any[] = Array.isArray(data?.subject_components)
    ? data.subject_components
    : [];

  const perSubjectWithAvg =
    bulletin && Array.isArray(bulletin.per_subject)
      ? bulletin.per_subject.filter(
          (ps: any) => typeof ps.avg20 === "number" && Number.isFinite(ps.avg20)
        )
      : [];

  const perSubjectMap = new Map<string, any>(
    perSubjectWithAvg.map((ps: any) => [String(ps.subject_id), ps])
  );

  const perSubjectComponentMap = new Map<string, any>(
    Array.isArray(bulletin?.per_subject_components)
      ? bulletin.per_subject_components
          .filter((psc: any) => typeof psc?.avg20 === "number" && Number.isFinite(psc.avg20))
          .map((psc: any) => [`${psc.subject_id}__${psc.component_id}`, psc])
      : []
  );

  const subjectComponentsBySubject = new Map<string, any[]>();
  for (const comp of subjectComponents) {
    const sid = String(comp?.subject_id ?? "");
    if (!sid) continue;
    const arr = subjectComponentsBySubject.get(sid) || [];
    arr.push(comp);
    subjectComponentsBySubject.set(sid, arr);
  }
  for (const arr of subjectComponentsBySubject.values()) {
    arr.sort((a, b) => Number(a?.order_index ?? 0) - Number(b?.order_index ?? 0));
  }

  const subjectsWithAvg = subjects.filter((s: any) => perSubjectMap.has(String(s.subject_id)));
  const subjectById = new Map<string, any>(
    subjectsWithAvg.map((s: any) => [String(s.subject_id), s])
  );

  const effectiveCoeffBySubjectId = new Map<string, number>();
  for (const g of subjectGroups) {
    for (const item of Array.isArray(g?.items) ? g.items : []) {
      const sid = String(item?.subject_id ?? "");
      const subj = subjectById.get(sid);
      if (!sid || !subj || effectiveCoeffBySubjectId.has(sid)) continue;

      const override = Number(item?.subject_coeff_override ?? NaN);
      const coeff =
        Number.isFinite(override) && override > 0
          ? override
          : Number(subj?.coeff_bulletin ?? 0);

      if (Number.isFinite(coeff) && coeff > 0) {
        effectiveCoeffBySubjectId.set(sid, coeff);
      }
    }
  }

  for (const subj of subjectsWithAvg) {
    const sid = String(subj.subject_id);
    if (effectiveCoeffBySubjectId.has(sid)) continue;
    const coeff = Number(subj?.coeff_bulletin ?? 0);
    if (Number.isFinite(coeff) && coeff > 0) effectiveCoeffBySubjectId.set(sid, coeff);
  }

  const coeffTotal = Array.from(effectiveCoeffBySubjectId.values()).reduce(
    (acc, coeff) => acc + coeff,
    0
  );

  function computeDisplayedGroupStats(groupSubjects: any[]) {
    let sum = 0;
    let sumCoeff = 0;

    for (const subj of groupSubjects) {
      const sid = String(subj?.subject_id ?? "");
      const ps = perSubjectMap.get(sid);
      const avg = ps?.avg20;
      if (typeof avg !== "number" || !Number.isFinite(avg)) continue;

      const coeff = effectiveCoeffBySubjectId.get(sid) ?? Number(subj?.coeff_bulletin ?? 0);
      if (!Number.isFinite(coeff) || coeff <= 0) continue;

      sum += avg * coeff;
      sumCoeff += coeff;
    }

    return {
      groupAvg: sumCoeff > 0 ? round2(sum / sumCoeff) : null,
      groupCoeff: sumCoeff,
      groupTotal: sumCoeff > 0 ? round2(sum) : null,
    };
  }

  const groupedSubjectIds = new Set<string>();
  const renderedGroups = subjectGroups
    .map((g: any) => {
      const rows: any[] = [];
      const groupSubjects: any[] = [];

      for (const item of Array.isArray(g?.items) ? g.items : []) {
        const sid = String(item?.subject_id ?? "");
        const subj = subjectById.get(sid);
        if (!subj) continue;
        groupedSubjectIds.add(sid);
        groupSubjects.push(subj);
      }

      if (!groupSubjects.length) return null;

      const stats = computeDisplayedGroupStats(groupSubjects);
      return {
        group: g,
        subjects: groupSubjects,
        stats,
      };
    })
    .filter(Boolean) as any[];

  const ungroupedSubjects = subjectsWithAvg.filter(
    (s: any) => !groupedSubjectIds.has(String(s.subject_id))
  );

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
        class_level: cls?.bulletin_level ?? cls?.level ?? null,
        period,
        averages: {
          general_avg: bulletin?.general_avg ?? null,
          annual_avg: bulletin?.annual_avg ?? null,
          labelMain,
          isAnnual,
        },
        counts: {
          subjects: subjects.length,
          subjectsWithAvg: subjectsWithAvg.length,
          subject_groups: subjectGroups.length,
          subject_components: subjectComponents.length,
        },
        coeffs: subjectsWithAvg.map((s: any) => ({
          subject_id: s.subject_id,
          subject_name: s.subject_name,
          coeff_bulletin: s.coeff_bulletin,
          effective_coeff: effectiveCoeffBySubjectId.get(String(s.subject_id)) ?? null,
        })),
      }
    : null;

  const renderSubjectRow = (subj: any) => {
    const sid = String(subj?.subject_id ?? "");
    const ps = perSubjectMap.get(sid);
    const avg = typeof ps?.avg20 === "number" ? Number(ps.avg20) : null;
    const coeff = effectiveCoeffBySubjectId.get(sid) ?? Number(subj?.coeff_bulletin ?? 0);
    const total = avg !== null && Number.isFinite(coeff) ? round2(avg * coeff) : null;
    const comps = subjectComponentsBySubject.get(sid) || [];

    return (
      <Fragment key={`frag-${sid}`}>
        <tr className="border-t border-slate-200">
          <td className="px-3 py-2 font-medium text-slate-900">{subj.subject_name}</td>
          <td className="px-3 py-2 text-center">{formatNumber(avg)}</td>
          <td className="px-3 py-2 text-center">{formatNumber(coeff, 0)}</td>
          <td className="px-3 py-2 text-center">{formatNumber(total)}</td>
        </tr>
        {comps.map((comp: any) => {
          const key = `${sid}__${comp.id}`;
          const c = perSubjectComponentMap.get(key);
          const cAvg = typeof c?.avg20 === "number" ? Number(c.avg20) : null;
          const cCoeff = Number(comp?.coeff_in_subject ?? 0);
          const cTotal = cAvg !== null && Number.isFinite(cCoeff) ? round2(cAvg * cCoeff) : null;

          return (
            <tr key={`comp-${key}`} className="border-t border-slate-100 bg-slate-50/70 text-[12px] text-slate-600">
              <td className="px-3 py-1 pl-8">{comp.short_label || comp.label}</td>
              <td className="px-3 py-1 text-center">{formatNumber(cAvg)}</td>
              <td className="px-3 py-1 text-center">{formatNumber(cCoeff, 0)}</td>
              <td className="px-3 py-1 text-center">{formatNumber(cTotal)}</td>
            </tr>
          );
        })}
      </Fragment>
    );
  };

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-white p-4 shadow sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">Vérification du bulletin</h1>
            <p className="mt-1 text-sm text-slate-500">
              Contrôle public d’authenticité et affichage des notes officielles.
            </p>
          </div>
          <span
            className={
              "inline-flex w-fit rounded-full px-3 py-1 text-sm font-semibold " +
              (ok ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800")
            }
          >
            {ok ? "VALIDE" : "INVALIDE"}
          </span>
        </div>

        {!res ? (
          <p className="mt-6 text-slate-700">
            Impossible de joindre le serveur de vérification pour le moment.
          </p>
        ) : !ok ? (
          <p className="mt-6 text-slate-700">
            Ce QR code est invalide, expiré ou a été révoqué.
          </p>
        ) : (
          <>
            <div className="mt-6 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Établissement</div>
                <div className="mt-1 font-semibold text-slate-900">
                  {inst?.name ?? inst?.institution_name ?? "—"}
                </div>
                {inst?.code ? <div className="mt-1 text-sm text-slate-600">Code : {inst.code}</div> : null}
              </div>

              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Élève</div>
                <div className="mt-1 font-semibold text-slate-900">{stu?.full_name ?? "—"}</div>
                {stu?.matricule ? (
                  <div className="mt-1 text-sm text-slate-600">Matricule : {stu.matricule}</div>
                ) : null}
              </div>

              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Classe</div>
                <div className="mt-1 font-semibold text-slate-900">{cls?.label ?? cls?.name ?? "—"}</div>
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

            {bulletin && (
              <div className="mt-6 rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/50 p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-700">Récapitulatif officiel des notes</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Calculé directement depuis la base Mon Cahier.
                    </p>
                  </div>
                  {(period?.from || period?.to) && (
                    <div className="text-xs text-slate-600">
                      {formatDateFR(period?.from)} → {formatDateFR(period?.to)}
                    </div>
                  )}
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-emerald-100">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                      {labelMain}
                    </div>
                    <div className="mt-2 text-2xl font-extrabold text-emerald-900">
                      {typeof bulletin.general_avg === "number"
                        ? `${Number(bulletin.general_avg).toFixed(2)} / 20`
                        : "—"}
                    </div>
                  </div>

                  <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                      {showAnnualAvg ? "Moyenne annuelle" : "Statut"}
                    </div>
                    <div className="mt-2 text-2xl font-extrabold text-slate-900">
                      {showAnnualAvg
                        ? `${Number(bulletin.annual_avg).toFixed(2)} / 20`
                        : "Bulletin authentique"}
                    </div>
                  </div>
                </div>

                {subjectsWithAvg.length > 0 && (
                  <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-sm font-semibold text-slate-800">
                        Notes par matière
                      </div>
                      <div className="text-xs text-slate-500">
                        Coefficients officiels utilisés pour le calcul du bulletin.
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="bg-slate-50 text-slate-600">
                          <tr>
                            <th className="px-3 py-2 text-left">Discipline</th>
                            <th className="px-3 py-2 text-center">Moy.</th>
                            <th className="px-3 py-2 text-center">Coef.</th>
                            <th className="px-3 py-2 text-center">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {renderedGroups.map((entry: any) => (
                            <Fragment key={`group-${String(entry.group?.id ?? entry.group?.code ?? entry.group?.label ?? "x")}`}>
                              {entry.subjects.map((subj: any) => renderSubjectRow(subj))}
                              <tr className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-800">
                                <td className="px-3 py-2">{String(entry.group?.label ?? entry.group?.code ?? "BILAN")}</td>
                                <td className="px-3 py-2 text-center">{formatNumber(entry.stats.groupAvg)}</td>
                                <td className="px-3 py-2 text-center">{formatNumber(entry.stats.groupCoeff, 0)}</td>
                                <td className="px-3 py-2 text-center">{formatNumber(entry.stats.groupTotal)}</td>
                              </tr>
                            </Fragment>
                          ))}

                          {ungroupedSubjects.map((subj: any) => renderSubjectRow(subj))}

                          <tr className="border-t border-slate-300 bg-slate-100 font-bold text-slate-900">
                            <td className="px-3 py-2 text-right">TOTAUX :</td>
                            <td className="px-3 py-2" />
                            <td className="px-3 py-2 text-center">{formatNumber(coeffTotal, 0)}</td>
                            <td className="px-3 py-2" />
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <p className="mt-4 text-[11px] leading-snug text-slate-500">
                  Les informations affichées ici proviennent directement de la base Mon Cahier.
                  En cas d’écart avec un document papier, cette page de vérification fait foi.
                </p>

                {debugEnabled && (
                  <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
                    <div className="text-xs font-semibold text-slate-700">DEBUG</div>
                    <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] text-slate-700">
                      {JSON.stringify(debugPayload, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            <p className="mt-6 text-xs text-slate-500">
              Cette page confirme l’authenticité du bulletin et affiche les notes officielles enregistrées dans le système.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
