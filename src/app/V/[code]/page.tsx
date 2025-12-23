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

  // si host vient de VERCEL_URL il peut être déjà sans proto
  const normalizedHost =
    host.startsWith("http://") || host.startsWith("https://")
      ? host
      : `${proto}://${host}`;

  return normalizedHost;
}

function looksAnnualPeriod(period: any): boolean {
  if (!period) return false;

  const code = String(period?.code ?? "").trim().toLowerCase();
  const short = String(period?.short_label ?? "").trim().toLowerCase();
  const label = String(period?.label ?? "").trim().toLowerCase();
  const txt = `${code} ${short} ${label}`.toLowerCase();

  // Cas fréquents : "Annuel", "Année", "Annual", code "AN", etc.
  if (
    txt.includes("annuel") ||
    txt.includes("annuelle") ||
    txt.includes("année") ||
    txt.includes("annee") ||
    txt.includes("annual") ||
    txt.includes("year")
  ) {
    return true;
  }

  // Codes courts possibles
  if (["a", "an", "ann", "yr", "year"].includes(code)) return true;
  if (["a", "an", "ann", "yr", "year"].includes(short)) return true;

  // Si c’est clairement T1/T2/T3 ou S1/S2, ce n’est pas annuel
  const shortUp = String(period?.short_label ?? "").trim().toUpperCase();
  if (shortUp.startsWith("T") || shortUp.startsWith("S")) return false;

  return false;
}

function mainAvgLabel(period: any): string {
  if (!period) return "Moyenne de la période";

  const shortUp = String(period?.short_label ?? "").trim().toUpperCase();
  const label = String(period?.label ?? "").trim().toLowerCase();
  const code = String(period?.code ?? "").trim().toUpperCase();

  if (looksAnnualPeriod(period)) return "Moyenne annuelle";

  // Trimestre
  if (shortUp.startsWith("T") || label.includes("trimestre") || code.startsWith("T")) {
    return "Moyenne du trimestre";
  }

  // Semestre
  if (shortUp.startsWith("S") || label.includes("semestre") || code.startsWith("S")) {
    return "Moyenne du semestre";
  }

  return "Moyenne de la période";
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

  // Champs calculés au niveau racine par l’API
  const period = data?.period ?? null;
  const subjects: any[] = Array.isArray(data?.subjects) ? data.subjects : [];

  // ✅ Ne garder que les matières qui ont une moyenne (au moins avg20 numérique)
  const perSubjectWithAvg =
    bulletin && Array.isArray(bulletin.per_subject)
      ? bulletin.per_subject.filter(
          (ps: any) => typeof ps.avg20 === "number" && Number.isFinite(ps.avg20)
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
          per_subject: Array.isArray(bulletin?.per_subject)
            ? bulletin.per_subject.length
            : 0,
          perSubjectWithAvg: perSubjectWithAvg.length,
        },
      }
    : null;

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-xl rounded-2xl bg-white p-6 shadow border border-slate-200">
        {/* ───────── En-tête ───────── */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-extrabold text-slate-900">
            Vérification du bulletin
          </h1>
          <span
            className={
              "rounded-full px-3 py-1 text-sm font-semibold " +
              (ok
                ? "bg-emerald-100 text-emerald-800"
                : "bg-rose-100 text-rose-800")
            }
          >
            {ok ? "VALIDE" : "INVALIDE"}
          </span>
        </div>

        {!res ? (
          <p className="mt-4 text-slate-700">
            Impossible de joindre le serveur de vérification pour le moment.
          </p>
        ) : !ok ? (
          <p className="mt-4 text-slate-700">
            Ce QR code est invalide, expiré ou a été révoqué.
          </p>
        ) : (
          <>
            {/* ───────── Cartes infos de base ───────── */}
            <div className="mt-4 space-y-3 text-slate-800">
              {/* Établissement */}
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-sm text-slate-500">Établissement</div>
                <div className="font-semibold">
                  {inst?.name ?? inst?.institution_name ?? "—"}
                </div>
                {inst?.code ? (
                  <div className="text-sm text-slate-600">
                    Code : {inst.code}
                  </div>
                ) : null}
              </div>

              {/* Élève */}
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-sm text-slate-500">Élève</div>
                <div className="font-semibold">{stu?.full_name ?? "—"}</div>
                {stu?.matricule ? (
                  <div className="text-sm text-slate-600">
                    Matricule : {stu.matricule}
                  </div>
                ) : null}
              </div>

              {/* Classe */}
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-sm text-slate-500">Classe</div>
                <div className="font-semibold">{cls?.label ?? cls?.name ?? "—"}</div>
                {(cls?.academic_year || period?.academic_year) && (
                  <div className="text-sm text-slate-600">
                    Année : {cls?.academic_year ?? period?.academic_year}
                  </div>
                )}
              </div>
            </div>

            {/* ───────── Bloc bulletin officiel (encadré) ───────── */}
            {bulletin && (
              <div className="mt-6 space-y-3 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/60 p-4">
                <h2 className="text-sm font-semibold text-slate-700">
                  Récapitulatif officiel des notes
                  <span className="block text-xs font-normal text-slate-500">
                    Calculé directement depuis la base Mon Cahier
                  </span>
                </h2>

                {/* Moyennes générales */}
                <div className="rounded-lg bg-emerald-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    Moyennes générales officielles
                  </div>

                  <div className="mt-2 grid gap-3 md:grid-cols-2">
                    {/* Moyenne principale (trimestre/semestre/période/annuelle) */}
                    <div>
                      <div className="text-[11px] font-semibold text-emerald-800">
                        {labelMain}
                      </div>
                      <div className="mt-1 text-2xl font-extrabold text-emerald-900">
                        {typeof bulletin.general_avg === "number"
                          ? `${Number(bulletin.general_avg).toFixed(2)} / 20`
                          : "—"}
                      </div>
                    </div>

                    {/* Moyenne annuelle séparée, si dispo ET si la période n’est pas annuelle */}
                    {showAnnualAvg && (
                      <div>
                        <div className="text-[11px] font-semibold text-slate-700">
                          Moyenne annuelle
                        </div>
                        <div className="mt-1 text-2xl font-extrabold text-slate-900">
                          {`${Number(bulletin.annual_avg).toFixed(2)} / 20`}
                        </div>
                      </div>
                    )}
                  </div>

                  {period && (
                    <div className="mt-2 text-xs text-emerald-900">
                      Période {period.short_label ?? period.label ?? ""}
                      {period.from && period.to ? ` (${period.from} → ${period.to})` : ""}
                    </div>
                  )}
                </div>

                {/* Moyennes par matière – seulement celles avec une moyenne */}
                {perSubjectWithAvg.length > 0 && (
                  <div>
                    <div className="mb-2 text-xs font-semibold text-slate-500">
                      Moyennes par matière (officielles)
                    </div>
                    <div className="divide-y divide-slate-100 rounded-lg border border-slate-100 bg-white">
                      {perSubjectWithAvg.map((ps: any) => {
                        const subj = subjects.find(
                          (s: any) => s.subject_id === ps.subject_id
                        );
                        if (!subj) return null;

                        return (
                          <div
                            key={ps.subject_id}
                            className="flex items-center justify-between px-3 py-2 text-sm"
                          >
                            <div className="flex flex-col">
                              <span className="font-medium text-slate-800">
                                {subj.subject_name}
                              </span>
                              <span className="text-xs text-slate-500">
                                Coeff. bulletin : {subj.coeff_bulletin}
                                {subj.include_in_average === false
                                  ? " (hors moyenne générale)"
                                  : ""}
                              </span>
                            </div>
                            <span className="text-sm font-semibold text-slate-900">
                              {typeof ps.avg20 === "number"
                                ? `${Number(ps.avg20).toFixed(2)} / 20`
                                : "—"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <p className="mt-3 text-[11px] leading-snug text-slate-500">
                  Les informations ci-dessus sont calculées directement depuis la base
                  Mon Cahier. Si le bulletin papier présente des notes différentes,
                  c&apos;est ce récapitulatif qui fait foi.
                </p>

                {/* DEBUG (optionnel) */}
                {debugEnabled && (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                    <div className="text-xs font-semibold text-slate-700">
                      DEBUG (ajoute ?debug=1)
                    </div>
                    <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] text-slate-700">
                      {JSON.stringify(debugPayload, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* Note de bas de page existante */}
            <p className="mt-6 text-xs text-slate-500">
              Cette page confirme l’authenticité du bulletin et affiche les notes
              officielles enregistrées dans le système (anti-fraude).
            </p>
          </>
        )}
      </div>
    </main>
  );
}
