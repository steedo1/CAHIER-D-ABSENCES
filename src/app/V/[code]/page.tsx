// src/app/v/[code]/page.tsx
import { headers } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Récupère l’origin public (https://mon-cahier.com) à partir des headers */
async function getOriginFromHeaders() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "";
  return `${proto}://${host}`;
}

export default async function VerifyByCodePage(props: any) {
  const code = String(props?.params?.code ?? "").trim();
  const origin = await getOriginFromHeaders();

  const res = await fetch(
    `${origin}/api/public/bulletins/verify?c=${encodeURIComponent(code)}`,
    { cache: "no-store" }
  );

  const data: any = await res.json().catch(() => null);
  const ok = res.ok && data?.ok;

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
          (ps: any) =>
            typeof ps.avg20 === "number" && Number.isFinite(ps.avg20)
        )
      : [];

  // ✅ Sécurisation : on accepte ancien ET nouveau format de l’API
  // - period_general_avg (nouveau) ou general_avg (ancien) = moyenne du trimestre / période
  // - annual_general_avg (nouveau) ou annual_avg (ancien) = moyenne annuelle
  const periodAvg: number | null =
    typeof bulletin?.period_general_avg === "number" &&
    Number.isFinite(bulletin.period_general_avg)
      ? bulletin.period_general_avg
      : typeof bulletin?.general_avg === "number" &&
        Number.isFinite(bulletin.general_avg)
      ? bulletin.general_avg
      : null;

  const annualAvg: number | null =
    typeof bulletin?.annual_general_avg === "number" &&
    Number.isFinite(bulletin.annual_general_avg)
      ? bulletin.annual_general_avg
      : typeof bulletin?.annual_avg === "number" &&
        Number.isFinite(bulletin.annual_avg)
      ? bulletin.annual_avg
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

        {!ok ? (
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
                <div className="font-semibold">
                  {stu?.full_name ?? "—"}
                </div>
                {stu?.matricule ? (
                  <div className="text-sm text-slate-600">
                    Matricule : {stu.matricule}
                  </div>
                ) : null}
              </div>

              {/* Classe */}
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-sm text-slate-500">Classe</div>
                <div className="font-semibold">
                  {cls?.label ?? cls?.name ?? "—"}
                </div>
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
                    {/* Moyenne du trimestre / période */}
                    <div>
                      <div className="text-[11px] font-semibold text-emerald-800">
                        Moyenne du trimestre
                      </div>
                      <div className="mt-1 text-2xl font-extrabold text-emerald-900">
                        {typeof periodAvg === "number"
                          ? `${Number(periodAvg).toFixed(2)} / 20`
                          : "—"}
                      </div>
                    </div>

                    {/* Moyenne annuelle, si disponible */}
                    {typeof annualAvg === "number" && (
                      <div>
                        <div className="text-[11px] font-semibold text-slate-700">
                          Moyenne annuelle
                        </div>
                        <div className="mt-1 text-2xl font-extrabold text-slate-900">
                          {`${Number(annualAvg).toFixed(2)} / 20`}
                        </div>
                      </div>
                    )}
                  </div>

                  {period && (
                    <div className="mt-2 text-xs text-emerald-900">
                      Période{" "}
                      {period.short_label ?? period.label ?? ""}
                      {period.from && period.to
                        ? ` (${period.from} → ${period.to})`
                        : ""}
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
                  Les informations ci-dessus sont calculées directement depuis la
                  base Mon Cahier. Si le bulletin papier présente des notes
                  différentes, c&apos;est ce récapitulatif qui fait foi.
                </p>
              </div>
            )}

            {/* Note de bas de page existante */}
            <p className="mt-6 text-xs text-slate-500">
              Cette page confirme l’authenticité du bulletin et affiche les
              notes officielles enregistrées dans le système (anti-fraude).
            </p>
          </>
        )}
      </div>
    </main>
  );
}
