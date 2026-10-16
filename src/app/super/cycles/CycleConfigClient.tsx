"use client";

import { useEffect, useState } from "react";
import {
  SCHOOL_CYCLE_OPTIONS,
  TEACHING_TRACK_OPTIONS,
  getDefaultSchoolCyclesSettings,
  type SchoolCycle,
  type SchoolCyclesSettings,
  type TeachingTrack,
} from "@/lib/school-cycles";

type Institution = { id: string; name: string; code_unique: string };
type ListResponse = { items?: Institution[]; error?: string };
type DetailsResponse = {
  ok?: boolean;
  configuration?: SchoolCyclesSettings;
  institution?: Institution;
  error?: string;
};

export default function CycleConfigClient() {
  const [schools, setSchools] = useState<Institution[]>([]);
  const [schoolId, setSchoolId] = useState("");
  const [settings, setSettings] = useState<SchoolCyclesSettings>(getDefaultSchoolCyclesSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch("/api/super/institutions?limit=200", { cache: "no-store" });
        const data = (await response.json()) as ListResponse;
        if (!response.ok) throw new Error(data.error || "Impossible de charger les établissements.");
        if (!alive) return;
        const rows = data.items || [];
        setSchools(rows);
        if (rows.length) setSchoolId(rows[0].id);
        else setLoading(false);
      } catch (err) {
        if (alive) {
          setLoading(false);
          setError(err instanceof Error ? err.message : "Chargement impossible.");
        }
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!schoolId) return;
    let alive = true;
    setLoading(true);
    setError("");
    setNotice("");
    (async () => {
      try {
        const response = await fetch(
          `/api/super/institutions/${encodeURIComponent(schoolId)}/school-cycles`,
          { cache: "no-store" },
        );
        const data = (await response.json()) as DetailsResponse;
        if (!response.ok || !data.ok || !data.configuration) {
          throw new Error(data.error || "Impossible de charger cette configuration.");
        }
        if (alive) setSettings(data.configuration);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Chargement impossible.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [schoolId]);

  function setEnabled(enabled: boolean) {
    setNotice("");
    setSettings((current) => ({
      ...current,
      enabled,
      enabledCycles: enabled && current.enabledCycles.length === 0
        ? ["secondary"]
        : current.enabledCycles,
    }));
  }

  function toggleCycle(cycle: SchoolCycle) {
    setNotice("");
    setSettings((current) => {
      const enabledCycles = current.enabledCycles.includes(cycle)
        ? current.enabledCycles.filter((c) => c !== cycle)
        : [...current.enabledCycles, cycle];
      if (current.enabled && !enabledCycles.length) return current;
      const nextTracks = { ...current.teachingTracksByCycle };
      if (enabledCycles.includes(cycle) && !nextTracks[cycle]) nextTracks[cycle] = ["french"];
      if (!enabledCycles.includes(cycle)) delete nextTracks[cycle];
      return {
        ...current,
        enabledCycles,
        teachingTracksByCycle: nextTracks,
        defaultView: current.defaultView !== "all" &&
          !enabledCycles.includes(current.defaultView) ? "all" : current.defaultView,
      };
    });
  }

  function toggleTeachingTrack(cycle: SchoolCycle, track: TeachingTrack) {
    setNotice("");
    setSettings((current) => {
      const old = current.teachingTracksByCycle[cycle] || ["french"];
      const next = old.includes(track)
        ? old.filter((item) => item !== track)
        : [...old, track];
      if (!next.length) return current;
      return {
        ...current,
        teachingTracksByCycle: {
          ...current.teachingTracksByCycle,
          [cycle]: next,
        },
      };
    });
  }

  async function save() {
    if (!schoolId || loading || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const nextTracks = Object.fromEntries(settings.enabledCycles.map((cycle) => [
        cycle,
        settings.teachingTracksByCycle[cycle]?.length
          ? settings.teachingTracksByCycle[cycle]
          : ["french"],
      ]));
      const response = await fetch(
        `/api/super/institutions/${encodeURIComponent(schoolId)}/school-cycles`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled: settings.enabled,
            enabledCycles: settings.enabledCycles,
            teachingTracksByCycle: nextTracks,
            defaultView: settings.defaultView,
            preferredLanguage: settings.preferredLanguage,
          }),
        },
      );
      const data = (await response.json()) as DetailsResponse;
      if (!response.ok || !data.ok || !data.configuration) {
        throw new Error(data.error || "Enregistrement impossible.");
      }
      setSettings(data.configuration);
      setNotice("Configuration enregistrée pour cet établissement uniquement.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <label htmlFor="school-select" className="mb-2 block text-sm font-bold text-slate-800">
          Établissement à configurer
        </label>
        <select
          id="school-select"
          value={schoolId}
          onChange={(event) => setSchoolId(event.target.value)}
          className="min-h-11 w-full rounded-lg border px-3 py-2"
          disabled={!schools.length || saving}
        >
          {!schools.length && <option value="">Aucun établissement</option>}
          {schools.map((school) => (
            <option key={school.id} value={school.id}>
              {school.name} — {school.code_unique}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-slate-500">
          La configuration est propre à l'établissement choisi, jamais globale.
        </p>
      </section>

      {loading ? (
        <div className="rounded-2xl border bg-white p-6 text-sm text-slate-600">
          Chargement de la configuration…
        </div>
      ) : schoolId && (
        <>
          <section className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-slate-900">Activer plusieurs cycles</h2>
                <p className="text-sm text-slate-600">
                  Laissez désactivé pour préserver l'interface habituelle.
                </p>
              </div>
              <input
                type="checkbox"
                className="h-6 w-6 accent-violet-600"
                aria-label="Activer le mode multicyle pour cet établissement"
                checked={settings.enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
            </div>

            {settings.enabled && (
              <div className="space-y-4 border-t pt-4">
                <h3 className="text-sm font-semibold">Cycles autorisés</h3>
                {SCHOOL_CYCLE_OPTIONS.map((cycle) => {
                  const enabled = settings.enabledCycles.includes(cycle.id);
                  return (
                    <div key={cycle.id} className="rounded-xl border bg-slate-50 p-4">
                      <label className="flex cursor-pointer items-center gap-3 font-semibold">
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-violet-600"
                          checked={enabled}
                          onChange={() => toggleCycle(cycle.id)}
                        />
                        {cycle.label}
                      </label>
                      {enabled && (
                        <div className="ml-8 mt-3 flex flex-wrap gap-4">
                          {TEACHING_TRACK_OPTIONS.map((track) => (
                            <label key={track.id} className="flex items-center gap-2 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-violet-600"
                                checked={(settings.teachingTracksByCycle[cycle.id] || ["french"])
                                  .includes(track.id)}
                                onChange={() => toggleTeachingTrack(cycle.id, track.id)}
                              />
                              {track.label}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div>
                  <label className="mb-1 block text-sm font-semibold" htmlFor="default-cycle">
                    Vue d'accueil du directeur
                  </label>
                  <select
                    id="default-cycle"
                    value={settings.defaultView}
                    onChange={(event) => setSettings((current) => ({
                      ...current,
                      defaultView: event.target.value as SchoolCyclesSettings["defaultView"],
                    }))}
                    className="min-h-11 w-full rounded-lg border px-3 py-2"
                  >
                    <option value="all">Direction générale — toute l'école</option>
                    {SCHOOL_CYCLE_OPTIONS.filter((cycle) => settings.enabledCycles.includes(cycle.id))
                      .map((cycle) => (
                        <option key={cycle.id} value={cycle.id}>{cycle.label}</option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold" htmlFor="ui-language">
                    Langue préférée pour l'interface (préparation)
                  </label>
                  <select
                    id="ui-language"
                    value={settings.preferredLanguage}
                    onChange={(event) => setSettings((current) => ({
                      ...current,
                      preferredLanguage: event.target.value === "ar" ? "ar" : "fr",
                    }))}
                    className="min-h-11 w-full rounded-lg border px-3 py-2"
                  >
                    <option value="fr">Français</option>
                    <option value="ar">Arabe (traduction et RTL à développer)</option>
                  </select>
                </div>
              </div>
            )}
          </section>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            Cette configuration prépare la navigation. Elle ne crée aucun élève,
            enseignant, compte directeur ni classe. Les accès séparés des directeurs
            français et arabe nécessitent des autorisations serveur spécifiques avant activation.
          </div>

          {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}
          {notice && <div role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}
          <button
            type="button"
            onClick={() => void save()}
            disabled={loading || saving || !settings.enabledCycles.length}
            className="min-h-11 rounded-xl bg-violet-700 px-6 py-3 font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Enregistrement…" : "Enregistrer la configuration"}
          </button>
        </>
      )}
    </div>
  );
}
