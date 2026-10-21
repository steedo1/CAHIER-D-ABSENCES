"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { ReportFormat, FrancoArabicReportsSettings } from "@/lib/franco-arabic-reporting";
import type { SchoolCycle, TeachingTrack } from "@/lib/school-cycles";

const DemoBulletinClient = dynamic(() => import("@/app/admin/bulletins/modeles/DemoBulletinClient"), {
  loading: () => <p>Chargement de l’aperçu A4…</p>,
});

type Configuration = {
  enabled: boolean;
  enabledCycles: SchoolCycle[];
  teachingTracksByCycle: Partial<Record<SchoolCycle, TeachingTrack[]>>;
};
type ApiResult = {
  ok?: boolean; error?: string; revision?: string;
  configuration?: Configuration;
  reporting?: FrancoArabicReportsSettings;
  institution?: { name?: string; code?: string };
  active?: boolean;
};
const cycles: Record<SchoolCycle, string> = {
  preschool: "Préscolaire", primary: "Primaire", secondary: "Secondaire",
};
const layouts: Array<{ id: ReportFormat; title: string; summary: string; symbol: string }> = [
  { id: "separate", title: "Bulletins séparés", summary: "Un bulletin français et un bulletin arabe distincts.", symbol: "▤  ▤" },
  { id: "combined", title: "Document regroupé", summary: "Un seul document, avec deux moyennes indépendantes.", symbol: "▥" },
  { id: "both", title: "Les deux présentations", summary: "Choix entre les documents séparés et regroupés à l'impression.", symbol: "▤  ▥" },
];

export default function SchoolBulletinModelPicker() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState("");
  const [config, setConfig] = useState<Configuration | null>(null);
  const [report, setReport] = useState<FrancoArabicReportsSettings | null>(null);
  const [cycle, setCycle] = useState<SchoolCycle>("primary");
  const [draftFormats, setDraftFormats] = useState<Partial<Record<SchoolCycle, ReportFormat>>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [schoolIdentity, setSchoolIdentity] = useState({ name: "Établissement", code: "" });

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    (async () => {
      try {
        const result = await fetch("/api/admin/bulletin-templates", {
          signal: controller.signal, cache: "no-store",
        });
        const body = await result.json() as ApiResult;
        if (!result.ok || !body.ok || !body.reporting || !body.configuration) {
          throw new Error(body.error || "Impossible de charger les modèles.");
        }
        if (!alive) return;
        setConfig(body.configuration);
        setReport(body.reporting);
        setRevision(body.revision || "");
        setSchoolIdentity({ name: body.institution?.name || "Établissement", code: body.institution?.code || "" });
        // Le secondaire garde sa présentation historique.
        const available = body.configuration.enabledCycles.filter(item =>
          item === "primary" || item === "preschool");
        setCycle(available.includes("primary") ? "primary" : available[0] || "primary");
        setDraftFormats(body.reporting.formatsByCycle || {});
      } catch (err) {
        if (alive && !controller.signal.aborted) setError(
          err instanceof Error ? err.message : "Chargement des bulletins impossible.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; controller.abort(); };
  }, []);

  const availableCycles = (config?.enabledCycles || []).filter(item =>
    item === "primary" || item === "preschool");
  const tracks = config?.teachingTracksByCycle[cycle] || [];
  const bilingual = tracks.includes("french") && tracks.includes("arabic");
  const onlyArabic = tracks.includes("arabic") && !tracks.includes("french");
  const hasArabicSchool = config?.enabledCycles.some(item => config.teachingTracksByCycle[item]?.includes("arabic"));
  const chosen = bilingual ? (draftFormats[cycle] || report?.format || "separate") : "separate";
  const saved = bilingual ? (report?.formatsByCycle?.[cycle] || report?.format || "separate") : "separate";
  const changed = chosen !== saved;
  const active = report?.enabled === true && report.engine === "specialized" &&
    cycle !== "preschool";
  const isPreschool = cycle === "preschool";
  const options = useMemo(() => bilingual ? layouts :
    [{ id: "separate" as ReportFormat,
      title: isPreschool ? "Livret de compétences" : onlyArabic ? "Bulletin arabe" : "Bulletin de notes",
      summary: isPreschool ? "Compétences et observations, sans notes ni classement." :
        onlyArabic ? "Le bulletin propre à l'enseignement arabe." :
          "La présentation ordinaire du cycle, sans division français/arabe.", symbol: "▤" }],
    [bilingual, isPreschool, onlyArabic]);

  async function save() {
    if (!report || !config || !revision || !changed || saving) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/bulletin-model-selection", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycle, format: chosen, revision }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.ok || !result.reporting) {
        throw new Error(result.error === "settings_changed_reload_required"
          ? "Les paramètres ont changé. Rechargez la page pour ne pas écraser une modification récente."
          : result.error || "Impossible d'enregistrer le modèle.");
      }
      setReport(result.reporting);
      setRevision(result.revision || "");
      setDraftFormats(result.reporting.formatsByCycle || {});
      setNotice(cycle === "preschool"
        ? "Préférence enregistrée pour le livret préscolaire. L'impression officielle attend la disponibilité du moteur de compétences."
        : result.active
          ? "Le modèle est enregistré et sera utilisé pour les bulletins spécialisés de ce cycle."
          : "Présentation enregistrée. L'édition des bulletins spécialisés doit être activée dans les paramètres pédagogiques.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <section className="rounded-2xl border bg-white p-6">
    <p className="text-slate-600">Chargement des modèles de bulletins…</p>
  </section>;
  if (!config || !report) return <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">
    {error || "Les modèles ne sont pas disponibles pour cet établissement."}
  </p>;

  if (availableCycles.length === 0) return <section className="rounded-2xl border bg-white p-6">
    <h2 className="text-xl font-bold text-slate-900">Bulletins de notes</h2>
    <p className="mt-2 text-sm text-slate-700">
      Aucun modèle primaire ou préscolaire à configurer pour cet établissement.
      Le secondaire conserve le bulletin historique et ses calculs.
    </p>
    <a href="/admin/bulletins" className="mt-4 inline-flex rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white">
      Correspondant Fichier → Bulletins
    </a>
  </section>;

  return <section className="space-y-6">
    <div className="rounded-2xl border bg-white p-5">
      <h2 className="text-xl font-bold text-slate-900">Choisir le modèle de bulletin</h2>
      <p className="mt-2 text-sm text-slate-600">
        Choisissez la présentation du primaire ou du préscolaire, puis enregistrez-la.
        Les véritables notes et les calculs se consultent dans Correspondant Fichier → Bulletins.
        {hasArabicSchool && " L’aperçu A4 ci-dessous présente le modèle avec des données de démonstration clairement identifiées."}
      </p>
      <label className="mt-4 block text-sm font-semibold text-slate-800">
        Cycle scolaire
        <select value={cycle} disabled={saving}
          onChange={event => { setCycle(event.target.value as SchoolCycle); setError(""); setNotice(""); }}
          aria-label="Cycle du bulletin"
          className="mt-2 block w-full max-w-sm rounded-lg border bg-white px-3 py-2">
          {availableCycles.map(item =>
            <option key={item} value={item}>{cycles[item]}</option>)}
        </select>
      </label>
      <p className="mt-3 text-sm text-slate-700">
        <strong>Présentation enregistrée :</strong> {
          isPreschool ? "Livret de compétences" :
          options.find(item => item.id === saved)?.title || "Bulletin ordinaire"
        }
      </p>
    </div>

    <div className="grid gap-3 md:grid-cols-3">
      {options.map(option => (
        <button key={option.id} type="button" disabled={saving || !bilingual}
          aria-pressed={chosen === option.id}
          onClick={() => { setDraftFormats(old => ({ ...old, [cycle]: option.id })); setError(""); setNotice(""); }}
          className={`rounded-2xl border-2 bg-white p-5 text-left transition hover:shadow-sm disabled:cursor-default ${chosen === option.id
            ? "border-emerald-700 ring-1 ring-emerald-700" : "border-slate-200"}`}>
          <span aria-hidden="true" className="block rounded-lg bg-slate-50 py-8 text-center text-3xl text-slate-700">
            {option.symbol}
          </span>
          <strong className="mt-3 block text-base text-slate-900">{option.title}</strong>
          <span className="mt-2 block text-sm text-slate-600">{option.summary}</span>
          <span className="mt-3 block text-xs font-semibold text-emerald-800">
            {chosen === option.id ? "✓ Sélectionné" : "Choisir ce modèle"}
          </span>
        </button>
      ))}
    </div>

    {config.enabled && hasArabicSchool &&
      <DemoBulletinClient key={cycle + ":" + chosen} embedded previewCycle={cycle} previewFormat={chosen}
        hasArabic schoolName={schoolIdentity.name} schoolCode={schoolIdentity.code}
        enabledCycles={availableCycles} tracksByCycle={config.teachingTracksByCycle} />}

    <div className="rounded-2xl border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-900">Modèle à utiliser — {cycles[cycle]}</h3>
          <p className="text-sm text-slate-600">
            {isPreschool
              ? "Le livret de compétences est distinct des bulletins chiffrés. Sa génération officielle reste à vérifier dans le module préscolaire."
              : active
                ? "Les bulletins de ce cycle utilisent la présentation enregistrée."
                : "Le choix est mémorisé. Le moteur de bulletins spécialisés n'est pas encore actif."}
          </p>
        </div>
        <button type="button" onClick={() => void save()}
          disabled={!changed || saving}
          className="rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white disabled:opacity-40">
          {saving ? "Enregistrement…" : changed ? "Enregistrer ce modèle" : "Modèle enregistré"}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {!active && !isPreschool && <p className="mt-3 text-sm text-amber-900">
        Pour utiliser ce modèle dans les bulletins réels, activez les règles de calcul spécialisées
        dans l’onglet <a className="font-semibold underline"
          href="/admin/parametres?tab=coefficients">Coefficients & sous-matières</a>.
        Cette opération est séparée du choix de présentation pour protéger les notes existantes.
      </p>}
    </div>

    <div className="rounded-2xl border bg-white p-5">
      <h3 className="font-bold text-slate-900">Vérifier les vrais bulletins et leurs calculs</h3>
      <p className="mt-2 text-sm text-slate-700">
        Ouvrez Correspondant Fichier → Bulletins, sélectionnez l’année scolaire,
        la période et la classe. Les matières, les notes, les moyennes et les rangs
        proviennent des données officielles de l’établissement, jamais d’une maquette.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <a href="/admin/bulletins"
          className="inline-flex rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white">
          Correspondant Fichier → Bulletins
        </a>
        {config.enabledCycles.includes("preschool") && <a href="/preschool/booklets"
          className="inline-flex rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-800">
          Livrets de compétences préscolaires
        </a>}
      </div>
      {config.enabledCycles.includes("secondary") && <p className="mt-3 text-sm text-slate-600">
        Secondaire : bulletin historique conservé, sans choix de modèle dans cette page.
      </p>}
    </div>
  </section>;
}
