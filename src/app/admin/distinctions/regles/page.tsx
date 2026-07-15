"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  FlaskConical,
  GraduationCap,
  Loader2,
  RefreshCcw,
  Save,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  DISTINCTION_TIER_LABELS,
  normalizeDistinctionSettings,
  validateDistinctionSettings,
  type DistinctionSettings,
  type DistinctionTier,
} from "@/lib/distinctions";

type Subject = { id: string; name: string };

const TIERS: DistinctionTier[] = ["encouragement", "felicitations", "excellence"];

function NumberField({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-bold text-slate-950 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
    />
  );
}

function Toggle({ checked, onChange, label, help }: { checked: boolean; onChange: (value: boolean) => void; label: string; help: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4">
      <span>
        <span className="block font-black text-slate-950">{label}</span>
        <span className="mt-1 block text-xs leading-relaxed text-slate-500">{help}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-5 w-5 accent-amber-600" />
    </label>
  );
}

export default function DistinctionRulesPage() {
  const [settings, setSettings] = useState<DistinctionSettings>(() => normalizeDistinctionSettings(null));
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [sourceLabel, setSourceLabel] = useState("Règles générales Mon Cahier");
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [settingsResponse, subjectsResponse] = await Promise.all([
        fetch("/api/admin/distinctions/settings", { cache: "no-store" }),
        fetch("/api/admin/subjects", { cache: "no-store" }),
      ]);
      const settingsJson = await settingsResponse.json().catch(() => ({}));
      const subjectsJson = await subjectsResponse.json().catch(() => ({}));
      if (!settingsResponse.ok) throw new Error(String(settingsJson?.error || "Règles indisponibles"));
      setSettings(normalizeDistinctionSettings(settingsJson.settings));
      setSourceLabel(String(settingsJson.source_label || (settingsJson.source === "institution" ? "Règles propres à l’établissement" : "Règles générales prédéfinies")));
      setCanWrite(Boolean(settingsJson.can_write));
      setSubjects(Array.isArray(subjectsJson.items) ? subjectsJson.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const validationErrors = useMemo(() => validateDistinctionSettings(settings), [settings]);

  function updateTier(tier: DistinctionTier, field: "average_min" | "conduct_min", value: number) {
    setSettings((current) => ({
      ...current,
      students: {
        ...current.students,
        tiers: {
          ...current.students.tiers,
          [tier]: {
            ...current.students.tiers[tier],
            [field]: value,
          },
        },
      },
    }));
  }

  function toggleSubject(family: "science" | "literature", subjectId: string) {
    setSettings((current) => {
      const key = family === "science" ? "science_subject_ids" : "literature_subject_ids";
      const values = current.students[key];
      const alreadySelected = values.includes(subjectId);
      const next = alreadySelected ? values.filter((id) => id !== subjectId) : [...values, subjectId];
      const otherKey = family === "science" ? "literature_subject_ids" : "science_subject_ids";
      const otherValues = alreadySelected
        ? current.students[otherKey]
        : current.students[otherKey].filter((id) => id !== subjectId);
      return {
        ...current,
        students: { ...current.students, [key]: next, [otherKey]: otherValues },
      };
    });
  }

  async function resetToDefaults() {
    setResetting(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/distinctions/settings", { method: "DELETE" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(json?.error || "Réinitialisation impossible"));
      setSettings(normalizeDistinctionSettings(json.settings));
      setSourceLabel(String(json.source_label || "Règles générales Mon Cahier"));
      setNotice("Les règles personnalisées ont été supprimées. Le profil prédéfini applicable est de nouveau actif.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Réinitialisation impossible");
    } finally {
      setResetting(false);
    }
  }

  async function save() {
    if (validationErrors.length > 0) {
      setError(validationErrors.join(" "));
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/distinctions/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const details = Array.isArray(json?.validation_errors) ? json.validation_errors.join(" ") : "";
        throw new Error(details || String(json?.error || "Enregistrement impossible"));
      }
      setSettings(normalizeDistinctionSettings(json.settings));
      setSourceLabel("Règles propres à l’établissement");
      setNotice("Les règles de distinction de l’établissement ont été enregistrées.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-[65vh] place-items-center">
        <div className="text-center"><Loader2 className="mx-auto h-10 w-10 animate-spin text-amber-600" /><p className="mt-3 font-semibold text-slate-600">Chargement des règles…</p></div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <section className="rounded-[32px] bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 px-6 py-7 text-white shadow-xl lg:px-9">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-amber-400/15 px-3 py-1 text-xs font-black uppercase tracking-[0.2em] text-amber-300 ring-1 ring-amber-300/20"><Settings2 className="h-4 w-4" /> Règles d’éligibilité</div>
              <h1 className="mt-4 text-3xl font-black tracking-tight">Paramétrage des distinctions</h1>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">Sans configuration particulière, toutes les écoles utilisent les règles générales Mon Cahier. Une personnalisation enregistrée devient prioritaire uniquement pour cet établissement.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-sm"><div className="text-xs font-black uppercase tracking-wide text-slate-400">Source actuelle</div><div className="mt-1 font-bold">{sourceLabel}</div></div>
          </div>
        </section>

        {error ? <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 font-semibold text-rose-800">{error}</div> : null}
        {notice ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-semibold text-emerald-800">{notice}</div> : null}

        <section className="mt-6 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm lg:p-7">
          <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-100 text-amber-800"><GraduationCap className="h-6 w-6" /></span><div><h2 className="text-xl font-black text-slate-950">Élèves · Seuils académiques et conduite</h2><p className="text-sm text-slate-500">Le système attribue la distinction la plus élevée dont les deux seuils sont simultanément atteints.</p></div></div>

          <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left text-xs font-black uppercase tracking-wide text-slate-600"><tr><th className="px-4 py-3">Distinction</th><th className="px-4 py-3">Moyenne générale minimale /20</th><th className="px-4 py-3">Conduite minimale /20</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {TIERS.map((tier) => (
                  <tr key={tier}><td className="px-4 py-4 font-black text-slate-950">{DISTINCTION_TIER_LABELS[tier]}</td><td className="px-4 py-4"><NumberField value={settings.students.tiers[tier].average_min} min={0} max={20} step={0.25} onChange={(value) => updateTier(tier, "average_min", value)} /></td><td className="px-4 py-4"><NumberField value={settings.students.tiers[tier].conduct_min} min={0} max={20} step={0.25} onChange={(value) => updateTier(tier, "conduct_min", value)} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Toggle checked={settings.students.require_complete_grades} onChange={(value) => setSettings((current) => ({ ...current, students: { ...current.students, require_complete_grades: value } }))} label="Exiger des notes complètes" help="Un élève avec des matières manquantes est placé dans la catégorie « À vérifier » avant impression." />
            <Toggle checked={settings.students.independent_absence_limit_enabled} onChange={(value) => setSettings((current) => ({ ...current, students: { ...current.students, independent_absence_limit_enabled: value } }))} label="Appliquer une limite d’absences séparée" help="Désactivée par défaut, car l’assiduité influence déjà la moyenne officielle de conduite." />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {settings.students.independent_absence_limit_enabled ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><label className="text-xs font-black uppercase tracking-wide text-amber-900">Nombre maximal d’absences</label><div className="mt-2"><NumberField value={settings.students.max_absence_count} min={0} max={500} onChange={(value) => setSettings((current) => ({ ...current, students: { ...current.students, max_absence_count: value } }))} /></div></div> : <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-500">La limite d’absences séparée est désactivée. L’assiduité reste prise en compte par la conduite.</div>}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><label className="text-xs font-black uppercase tracking-wide text-slate-600">Matières minimales pour un palmarès scientifique ou littéraire</label><div className="mt-2"><NumberField value={settings.students.min_family_subjects} min={1} max={20} onChange={(value) => setSettings((current) => ({ ...current, students: { ...current.students, min_family_subjects: value } }))} /></div></div>
          </div>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-2">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
            <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-100 text-cyan-800"><FlaskConical className="h-6 w-6" /></span><div><h2 className="text-lg font-black text-slate-950">Matières scientifiques</h2><p className="text-xs text-slate-500">Laisse la sélection vide pour utiliser la reconnaissance automatique par nom.</p></div></div>
            <div className="mt-4 flex flex-wrap gap-2">
              {subjects.map((subject) => {
                const selected = settings.students.science_subject_ids.includes(subject.id);
                return <button key={subject.id} type="button" onClick={() => toggleSubject("science", subject.id)} className={`rounded-full border px-3 py-2 text-xs font-bold transition ${selected ? "border-cyan-600 bg-cyan-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>{subject.name}</button>;
              })}
            </div>
            <button type="button" onClick={() => setSettings((current) => ({ ...current, students: { ...current.students, science_subject_ids: [] } }))} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"><RefreshCcw className="h-4 w-4" /> Revenir à la détection automatique</button>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
            <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-100 text-violet-800"><BookOpen className="h-6 w-6" /></span><div><h2 className="text-lg font-black text-slate-950">Matières littéraires</h2><p className="text-xs text-slate-500">La sélection explicite remplace les mots-clés généraux pour cet établissement.</p></div></div>
            <div className="mt-4 flex flex-wrap gap-2">
              {subjects.map((subject) => {
                const selected = settings.students.literature_subject_ids.includes(subject.id);
                return <button key={subject.id} type="button" onClick={() => toggleSubject("literature", subject.id)} className={`rounded-full border px-3 py-2 text-xs font-bold transition ${selected ? "border-violet-600 bg-violet-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>{subject.name}</button>;
              })}
            </div>
            <button type="button" onClick={() => setSettings((current) => ({ ...current, students: { ...current.students, literature_subject_ids: [] } }))} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"><RefreshCcw className="h-4 w-4" /> Revenir à la détection automatique</button>
          </div>
        </section>

        <section className="mt-6 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm lg:p-7">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-100 text-blue-800"><Users className="h-6 w-6" /></span>
            <div>
              <h2 className="text-xl font-black text-slate-950">Enseignants · Barème strict et non renormalisable</h2>
              <p className="text-sm text-slate-500">Les poids et les seuils essentiels sont verrouillés pour garantir le même niveau d’exigence dans tous les établissements. Une donnée absente ne transfère jamais ses points aux autres critères.</p>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed text-blue-950">
            <div className="font-black">Publication obligatoire des évaluations</div>
            <p className="mt-1">Une évaluation en brouillon, soumise, refusée ou en attente est totalement exclue. Elle doit être marquée <strong>publiée</strong>, disposer de notes officielles publiées et couvrir au moins <strong>{settings.teachers.minimum_evaluation_note_coverage_rate} %</strong> des élèves actifs de la classe.</p>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {[
              ["Évaluations", "25 pts", "15 pts de régularité + 10 pts de couverture des notes"],
              ["Résultats", "25 pts", "10 pts de moyenne pédagogique + 15 pts de taux de réussite"],
              ["Enseignant", "20 pts", "12 pts d’assiduité + 8 pts de ponctualité"],
              ["Cahier", "20 pts", "12 pts de tenue du cahier + 8 pts de progression"],
              ["Présence élèves", "10 pts", "Taux de présence constaté pendant les cours du professeur"],
            ].map(([label, points, help]) => (
              <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</div>
                <div className="mt-2 text-2xl font-black text-slate-950">{points}</div>
                <div className="mt-2 text-xs leading-relaxed text-slate-500">{help}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs font-black uppercase tracking-wide text-slate-500">Objectif évaluations/classe</div><div className="mt-2 text-2xl font-black text-slate-950">{settings.teachers.evaluations_target_per_class}</div><p className="mt-1 text-xs text-slate-500">Le maximum du critère est atteint à cinq évaluations publiées valides par classe.</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs font-black uppercase tracking-wide text-slate-500">Minimum par classe</div><div className="mt-2 text-2xl font-black text-slate-950">{settings.teachers.minimum_published_evaluations_per_class}</div><p className="mt-1 text-xs text-slate-500">Au moins {settings.teachers.minimum_class_evaluation_compliance_rate} % des classes doivent atteindre ce minimum.</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs font-black uppercase tracking-wide text-slate-500">Présence enseignant</div><div className="mt-2 text-2xl font-black text-slate-950">{settings.teachers.minimum_teacher_attendance_observations} séances</div><p className="mt-1 text-xs text-slate-500">Et au moins {settings.teachers.minimum_teacher_attendance_coverage_rate} % des créneaux prévus contrôlés.</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs font-black uppercase tracking-wide text-slate-500">Cahier de texte</div><div className="mt-2 text-2xl font-black text-slate-950">{settings.teachers.minimum_textbook_session_coverage_rate} %</div><p className="mt-1 text-xs text-slate-500">Couverture minimale des séances, avec une progression attribuée et exploitable.</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs font-black uppercase tracking-wide text-slate-500">Appels élèves</div><div className="mt-2 text-2xl font-black text-slate-950">{settings.teachers.minimum_student_attendance_sessions}</div><p className="mt-1 text-xs text-slate-500">Minimum d’appels, couvrant au moins {settings.teachers.minimum_student_attendance_coverage_rate} % des séances prévues.</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs font-black uppercase tracking-wide text-slate-500">Tolérance ponctualité</div><div className="mt-2 text-2xl font-black text-slate-950">{settings.teachers.punctuality_tolerance_minutes} min</div><p className="mt-1 text-xs text-slate-500">Au-delà, la séance n’est pas considérée comme ponctuelle.</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs font-black uppercase tracking-wide text-slate-500">Score minimal</div><div className="mt-2 text-2xl font-black text-slate-950">{settings.teachers.minimum_score}/100</div><p className="mt-1 text-xs text-slate-500">Toutes les familles doivent d’abord être calculables et tous les minima respectés.</p></div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><div className="text-xs font-black uppercase tracking-wide text-amber-800">Critères exclus</div><div className="mt-2 font-black text-amber-950">Types et permissions</div><p className="mt-1 text-xs text-amber-900">La diversité des types d’évaluations ne donne aucun point. Une permission approuvée n’est ni un bonus ni un malus.</p></div>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold leading-relaxed text-slate-700">
            <strong>Moyenne pédagogique</strong> : niveau moyen des élèves, calculé équitablement par classe-matière. <strong>Taux de réussite</strong> : proportion d’élèves dont la moyenne atteint au moins 10/20. Les deux indicateurs sont complémentaires et ne doivent jamais être confondus.
          </div>
        </section>

        {validationErrors.length > 0 ? (
          <section className="mt-6 rounded-[28px] border border-rose-200 bg-rose-50 p-5 text-rose-900">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" />
              <div><h2 className="font-black">Configuration à corriger</h2><p className="mt-1 text-sm font-semibold">{validationErrors.join(" ")}</p></div>
            </div>
          </section>
        ) : null}

        <section className="mt-6 rounded-[28px] border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-amber-800" /><div><h2 className="font-black text-amber-950">Principe de justice</h2><p className="mt-1 text-sm leading-relaxed text-amber-900">Le rang académique d’un élève n’est jamais falsifié. La plateforme distingue le classement scolaire officiel de l’éligibilité honorifique. Pour les enseignants, une activité insuffisamment observable déclenche une vérification plutôt qu’une mauvaise note automatique.</p></div></div>
        </section>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 font-bold text-slate-700"><RefreshCcw className="h-4 w-4" /> Recharger</button>
          <button type="button" onClick={resetToDefaults} disabled={!canWrite || resetting || saving} className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 font-bold text-amber-900 disabled:opacity-50">{resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />} Rétablir les règles prédéfinies</button>
          <button type="button" onClick={save} disabled={!canWrite || saving || resetting || validationErrors.length > 0} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 font-black text-white shadow-lg hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">{saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />} Enregistrer les règles</button>
        </div>
        {!canWrite ? <div className="mt-3 flex items-center justify-end gap-2 text-sm font-semibold text-amber-800"><AlertTriangle className="h-4 w-4" /> Seuls les administrateurs peuvent modifier ces règles.</div> : null}
      </div>
    </main>
  );
}
