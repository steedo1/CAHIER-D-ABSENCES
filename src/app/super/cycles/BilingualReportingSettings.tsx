"use client";

import { useEffect, useMemo, useState } from "react";
import {
  convertScoreScale,
  defaultFrancoArabicReportsSettings,
  getConfiguredScoringScale,
  type FrancoArabicReportsSettings,
  type LevelScoringScale,
  type ReportFormat,
} from "@/lib/franco-arabic-reporting";
import {
  SCHOOL_CYCLE_OPTIONS,
  TEACHING_TRACK_OPTIONS,
  type SchoolCycle,
  type TeachingTrack,
} from "@/lib/school-cycles";

type ReportResponse = {
  ok?: boolean;
  reporting?: FrancoArabicReportsSettings;
  error?: string;
};
type CycleResponse = {
  ok?: boolean;
  configuration?: {
    enabled: boolean;
    enabledCycles: SchoolCycle[];
    teachingTracksByCycle: Partial<Record<SchoolCycle, TeachingTrack[]>>;
  };
  error?: string;
};
type AllowedProgram = { cycle: SchoolCycle; track: TeachingTrack };

export default function BilingualReportingSettings({ schoolId }: { schoolId: string }) {
  const [settings, setSettings] = useState<FrancoArabicReportsSettings>(
    defaultFrancoArabicReportsSettings,
  );
  const [programs, setPrograms] = useState<AllowedProgram[]>([]);
  const [multicycleReady, setMulticycleReady] = useState(false);
  const [loadedFor, setLoadedFor] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!schoolId) return;
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadedFor("");
    setSettings(defaultFrancoArabicReportsSettings());
    setPrograms([]);
    setError("");
    setNotice("");
    (async () => {
      try {
        const prefix = `/api/super/institutions/${encodeURIComponent(schoolId)}`;
        const [a, b] = await Promise.all([
          fetch(`${prefix}/franco-arabic-reports`, { cache: "no-store", signal: controller.signal }),
          fetch(`${prefix}/school-cycles`, { cache: "no-store", signal: controller.signal }),
        ]);
        const reports = await a.json() as ReportResponse;
        const cycles = await b.json() as CycleResponse;
        if (!a.ok || !b.ok || !reports.ok || !reports.reporting || !cycles.ok ||
            !cycles.configuration) {
          throw new Error(reports.error || cycles.error || "Chargement impossible.");
        }
        if (!active) return;
        setSettings(reports.reporting);
        const config = cycles.configuration;
        setMulticycleReady(config.enabled);
        setPrograms(config.enabledCycles.flatMap((cycle) =>
          (config.teachingTracksByCycle[cycle] || [])
            .map((track) => ({ cycle, track }))));
        setLoadedFor(schoolId);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Chargement impossible.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [schoolId]);

  const allowedKeys = useMemo(() =>
    new Set(programs.map(({ cycle, track }) => `${cycle}|${track}`)), [programs]);
  const firstProgram = programs[0];
  const blocked = loading || saving || loadedFor !== schoolId || !multicycleReady;

  function updateScale(index: number, update: Partial<LevelScoringScale>) {
    setNotice("");
    setSettings((old) => ({
      ...old,
      scales: old.scales.map((entry, i) => i === index ? { ...entry, ...update } : entry),
    }));
  }

  function appendScale() {
    if (!firstProgram || settings.scales.length >= 120) return;
    setSettings((old) => ({
      ...old,
      scales: [...old.scales, {
        cycle: firstProgram.cycle,
        track: firstProgram.track,
        level: "",
        maxScore: 0,
      }],
    }));
  }

  async function save() {
    if (blocked) return;
    const seen = new Set<string>();
    for (const item of settings.scales) {
      const level = item.level.trim();
      const key = `${item.cycle}|${item.track}|${level.toLocaleLowerCase("fr")}`;
      if (!level || seen.has(key) || !Number.isInteger(item.maxScore) ||
        item.maxScore < 1 || item.maxScore > 100 ||
        !allowedKeys.has(`${item.cycle}|${item.track}`)) {
        setError("Vérifiez les niveaux, les barèmes et les doublons avant d'enregistrer.");
        return;
      }
      seen.add(key);
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/super/institutions/${encodeURIComponent(schoolId)}/franco-arabic-reports`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settings),
        },
      );
      const data = await response.json() as ReportResponse;
      if (!response.ok || !data.ok || !data.reporting) {
        throw new Error(data.error || "Enregistrement impossible.");
      }
      setSettings(data.reporting);
      setNotice("Paramètres de préparation des bulletins enregistrés pour cette école.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  if (!schoolId) return null;
  return (
    <section className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Bulletins français et arabe</h2>
        <p className="mt-1 text-sm text-slate-600">
          Préparer le modèle de bulletin et les barèmes par niveau. Ces réglages
          ne changent pas encore les notes ni les bulletins existants.
        </p>
      </div>
      {loading ? <p className="text-sm text-slate-600">Chargement des paramètres…</p> : (
        <>
          {!multicycleReady && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              Enregistrez d'abord l'activation des cycles et des enseignements dans la section précédente.
            </p>
          )}
          <label className="flex items-center gap-3 text-sm font-semibold">
            <input type="checkbox" checked={settings.enabled}
              disabled={blocked} className="h-5 w-5"
              onChange={(event) => setSettings((old) => ({ ...old, enabled: event.target.checked }))} />
            Préparer des bulletins propres à cet établissement
          </label>
          {settings.enabled && (
            <div className="space-y-4">
              <div>
                <label htmlFor="report-format" className="mb-1 block text-sm font-medium">
                  Présentation souhaitée des bulletins
                </label>
                <select id="report-format" value={settings.format} disabled={blocked}
                  onChange={(event) => setSettings((old) => ({
                    ...old, format: event.target.value as ReportFormat,
                  }))} className="min-h-11 w-full rounded-xl border px-3 py-2">
                  <option value="separate">Deux bulletins distincts : français / arabe</option>
                  <option value="combined">Un bulletin bilingue regroupé</option>
                  <option value="both">Les deux présentations disponibles</option>
                </select>
              </div>
              <div className="border-t pt-4">
                <h3 className="font-semibold text-slate-900">Barèmes par niveau et enseignement</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Laissez vide tant que l'établissement n'a pas confirmé ses barèmes.
                  Un CP1 peut utiliser /10 et un CM1 /20 : rien n'est imposé automatiquement.
                </p>
                <div className="mt-3 space-y-3">
                  {settings.scales.map((scale, index) => {
                    const availableTracks = programs.filter((p) => p.cycle === scale.cycle);
                    return (
                      <div key={index} className="grid gap-2 rounded-xl border bg-slate-50 p-3 sm:grid-cols-5">
                        <select aria-label={`Cycle ${index + 1}`} value={scale.cycle}
                          disabled={blocked} className="min-h-10 rounded-lg border px-2"
                          onChange={(event) => {
                            const cycle = event.target.value as SchoolCycle;
                            const track = programs.find((p) => p.cycle === cycle)?.track || "french";
                            updateScale(index, { cycle, track });
                          }}>
                          {SCHOOL_CYCLE_OPTIONS.filter((c) =>
                            programs.some((p) => p.cycle === c.id))
                            .map((c) => <option value={c.id} key={c.id}>{c.label}</option>)}
                        </select>
                        <select aria-label={`Enseignement ${index + 1}`} value={scale.track}
                          disabled={blocked} className="min-h-10 rounded-lg border px-2"
                          onChange={(event) => updateScale(index, {
                            track: event.target.value as TeachingTrack,
                          })}>
                          {availableTracks.map((p) =>
                            <option key={p.track} value={p.track}>
                              {TEACHING_TRACK_OPTIONS.find((t) => t.id === p.track)?.label || p.track}
                            </option>)}
                        </select>
                        <input aria-label={`Niveau ${index + 1}`} value={scale.level}
                          disabled={blocked} placeholder="CP1, CE1, CM1…"
                          className="min-h-10 rounded-lg border px-2"
                          onChange={(event) => updateScale(index, { level: event.target.value })} />
                        <input aria-label={`Barème ${index + 1}`} type="number"
                          min={1} max={100} step={1} value={scale.maxScore || ""}
                          disabled={blocked} className="min-h-10 rounded-lg border px-2"
                          onChange={(event) => updateScale(index, {
                            maxScore: Number(event.target.value),
                          })} />
                        <button type="button" disabled={blocked}
                          className="rounded-lg border px-3 py-2 text-sm font-medium text-red-700"
                          onClick={() => setSettings((old) => ({
                            ...old, scales: old.scales.filter((_, i) => i !== index),
                          }))}>Retirer</button>
                      </div>
                    );
                  })}
                </div>
                <button type="button" onClick={appendScale}
                  disabled={blocked || !firstProgram || settings.scales.length >= 120}
                  className="mt-3 min-h-10 rounded-xl border px-4 py-2 text-sm font-semibold">
                  + Ajouter un barème
                </button>
              </div>
              {settings.scales.length > 0 && (() => {
                const first = settings.scales[0];
                const scale = getConfiguredScoringScale(settings,
                  first.cycle, first.level, first.track);
                const example = scale && convertScoreScale(scale / 2, scale, 20);
                return example === null || example === undefined ? null : (
                  <p className="rounded-lg bg-sky-50 p-3 text-xs text-sky-900">
                    Vérification mathématique : {scale! / 2}/{scale} correspond à
                    {" "}{example}/20. C'est un exemple de conversion, pas une moyenne générale calculée.
                  </p>
                );
              })()}
            </div>
          )}
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
          <button type="button" onClick={() => void save()} disabled={blocked}
            className="min-h-11 rounded-xl bg-violet-700 px-5 py-3 font-semibold text-white disabled:opacity-50">
            {saving ? "Enregistrement…" : "Enregistrer les paramètres de bulletins"}
          </button>
        </>
      )}
    </section>
  );
}
