"use client";

import React, { useEffect, useMemo, useState } from "react";

type LatenessMode = "ignore" | "as_hours" | "direct_points";

type ConductSettings = {
  institution_id: string;
  assiduite_max: number;
  tenue_max: number;
  moralite_max: number;
  discipline_max: number;
  points_per_absent_hour: number;
  absent_hours_zero_threshold: number;
  absent_hours_note_after_threshold: number;
  lateness_mode: LatenessMode;
  lateness_minutes_per_absent_hour: number;
  lateness_points_per_late: number;
};

function Input(
  p: React.InputHTMLAttributes<HTMLInputElement> & { label?: string; help?: string }
) {
  const { label, help, ...rest } = p;
  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-xs font-medium text-slate-600">
          {label}
        </label>
      )}
      <input
        {...rest}
        className={[
          "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm",
          "shadow-sm outline-none transition",
          "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
          "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
          rest.className ?? "",
        ].join(" ")}
      />
      {help && <p className="text-[11px] text-slate-500">{help}</p>}
    </div>
  );
}

function Select(
  p: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string; help?: string }
) {
  const { label, help, ...rest } = p;
  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-xs font-medium text-slate-600">
          {label}
        </label>
      )}
      <select
        {...rest}
        className={[
          "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm",
          "shadow-sm outline-none transition",
          "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
          "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
          rest.className ?? "",
        ].join(" ")}
      />
      {help && <p className="text-[11px] text-slate-500">{help}</p>}
    </div>
  );
}

function Button(
  p: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "emerald" | "slate" }
) {
  const { tone = "emerald", ...rest } = p;
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium shadow transition focus:outline-none focus:ring-4 disabled:opacity-60 disabled:cursor-not-allowed";
  const tones: Record<"emerald" | "slate", string> = {
    emerald:
      "bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500/30",
    slate:
      "bg-slate-900 text-white hover:bg-slate-800 focus:ring-slate-600/30",
  };
  return (
    <button
      {...rest}
      className={[base, tones[tone], rest.className ?? ""].join(" ")}
    />
  );
}

export default function ConductSettingsPage() {
  const [settings, setSettings] = useState<ConductSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/conduct/settings", {
          cache: "no-store",
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || "Erreur de chargement");
        setSettings(j as ConductSettings);
      } catch (e: any) {
        setError(e?.message || "Impossible de charger les réglages.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totalMax = useMemo(() => {
    if (!settings) return 0;
    return (
      (settings.assiduite_max || 0) +
      (settings.tenue_max || 0) +
      (settings.moralite_max || 0) +
      (settings.discipline_max || 0)
    );
  }, [settings]);

  function update<K extends keyof ConductSettings>(
    key: K,
    value: ConductSettings[K]
  ) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setMsg(null);
    setError(null);
    try {
      const payload = {
        assiduite_max: settings.assiduite_max,
        tenue_max: settings.tenue_max,
        moralite_max: settings.moralite_max,
        discipline_max: settings.discipline_max,
        points_per_absent_hour: settings.points_per_absent_hour,
        absent_hours_zero_threshold: settings.absent_hours_zero_threshold,
        absent_hours_note_after_threshold:
          settings.absent_hours_note_after_threshold,
        lateness_mode: settings.lateness_mode,
        lateness_minutes_per_absent_hour:
          settings.lateness_minutes_per_absent_hour,
        lateness_points_per_late: settings.lateness_points_per_late,
      };

      const res = await fetch("/api/admin/conduct/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Erreur d’enregistrement");
      setSettings(j as ConductSettings);
      setMsg("Réglages de conduite enregistrés ✅");
    } catch (e: any) {
      setError(e?.message || "Erreur d’enregistrement des réglages.");
    } finally {
      setSaving(false);
    }
  }

  const latenessMode = settings?.lateness_mode ?? "as_hours";

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Règles de conduite
        </h1>
        <p className="text-sm text-slate-600">
          Définissez ici le barème de la moyenne de conduite et la façon dont
          les absences / retards impactent l&apos;assiduité.
        </p>
        <p className="text-[11px] text-slate-500">
          <b>Note :</b> la note globale de conduite est la somme des 4
          rubriques. Vous pouvez, par exemple, mettre{" "}
          <b>Assiduité sur 16 et les autres sur 0</b> pour que la conduite soit
          notée sur 16.
        </p>
      </header>

      {loading && (
        <div className="rounded-2xl border bg-white p-4 text-sm text-slate-600 shadow-sm">
          Chargement des réglages…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-sm">
          {error}
        </div>
      )}

      {!loading && settings && (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Card 1 : Barème par rubrique */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">
                  Barème par rubrique
                </h2>
                <p className="text-xs text-slate-500">
                  Chaque rubrique est notée entre 0 et son maximum. Des
                  sanctions retirent des points sans jamais descendre sous 0.
                </p>
              </div>
              <div className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-100">
                Total actuel :{" "}
                <b>
                  {Number.isFinite(totalMax) ? totalMax.toFixed(2) : "0.00"}{" "}
                  points
                </b>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Input
                label="Assiduité — maximum"
                type="number"
                min={0}
                step={0.5}
                value={settings.assiduite_max}
                onChange={(e) =>
                  update("assiduite_max", Number(e.target.value || 0))
                }
                help="Absences & retards font baisser cette note."
              />
              <Input
                label="Tenue — maximum"
                type="number"
                min={0}
                step={0.5}
                value={settings.tenue_max}
                onChange={(e) =>
                  update("tenue_max", Number(e.target.value || 0))
                }
                help="Retrait par sanctions (tenue)."
              />
              <Input
                label="Moralité — maximum"
                type="number"
                min={0}
                step={0.5}
                value={settings.moralite_max}
                onChange={(e) =>
                  update("moralite_max", Number(e.target.value || 0))
                }
                help="Retrait par sanctions (moralité)."
              />
              <Input
                label="Discipline — maximum"
                type="number"
                min={0}
                step={0.5}
                value={settings.discipline_max}
                onChange={(e) =>
                  update("discipline_max", Number(e.target.value || 0))
                }
                help="Retrait par sanctions (discipline)."
              />
            </div>

            <p className="text-[11px] text-slate-500">
              Vous pouvez mettre certaines rubriques à <b>0</b> si vous ne
              souhaitez pas les utiliser. La note de conduite sera alors
              calculée sur la somme des rubriques actives.
            </p>
          </section>

          {/* Card 2 : Absences & Retards */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-800">
                Assiduité : absences & retards
              </h2>
              <p className="text-xs text-slate-500">
                L&apos;assiduité part de son maximum, puis diminue en fonction
                des heures d&apos;absence injustifiées et, selon votre choix,
                des retards. Vous pouvez également fixer une note automatique
                au-delà d&apos;un certain volume d&apos;absence.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="Points retirés par heure d’absence injustifiée"
                type="number"
                min={0}
                step={0.1}
                value={settings.points_per_absent_hour}
                onChange={(e) =>
                  update(
                    "points_per_absent_hour",
                    Number(e.target.value || 0)
                  )
                }
                help="Ex : 0,5 → une heure d’absence injustifiée retire 0,5 point d’assiduité."
              />
              <Input
                label="Heures d’absence pour appliquer la sanction automatique"
                type="number"
                min={0}
                step={0.5}
                value={settings.absent_hours_zero_threshold}
                onChange={(e) =>
                  update(
                    "absent_hours_zero_threshold",
                    Number(e.target.value || 0)
                  )
                }
                help="Au-delà de ce seuil, la note d’assiduité est ramenée à la valeur définie ci-dessous."
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="Note d’assiduité au-delà du seuil (0, 5, etc.)"
                type="number"
                min={0}
                step={0.5}
                value={settings.absent_hours_note_after_threshold}
                onChange={(e) =>
                  update(
                    "absent_hours_note_after_threshold",
                    Number(e.target.value || 0)
                  )
                }
                help="Ex : 0 → au-delà du seuil, l’élève a 0 en assiduité. 5 → la note est fixée à 5, même s’il dépasse largement le seuil."
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Select
                label="Prise en compte des retards"
                value={latenessMode}
                onChange={(e) =>
                  update("lateness_mode", e.target.value as LatenessMode)
                }
                help="Choisissez comment les retards influencent l’assiduité."
              >
                <option value="ignore">Ignorer les retards</option>
                <option value="as_hours">
                  Compter les retards comme des heures d’absence
                </option>
                <option value="direct_points">
                  Retirer des points directement par retard
                </option>
              </Select>

              {latenessMode === "as_hours" && (
                <Input
                  label="Minutes de retard = 1 heure d’absence"
                  type="number"
                  min={1}
                  step={1}
                  value={settings.lateness_minutes_per_absent_hour}
                  onChange={(e) =>
                    update(
                      "lateness_minutes_per_absent_hour",
                      Number(e.target.value || 0)
                    )
                  }
                  help="Ex : 60 → 60 minutes de retard = 1 heure dans le calcul d’absence."
                />
              )}

              {latenessMode === "direct_points" && (
                <Input
                  label="Points retirés par retard"
                  type="number"
                  min={0}
                  step={0.1}
                  value={settings.lateness_points_per_late}
                  onChange={(e) =>
                    update(
                      "lateness_points_per_late",
                      Number(e.target.value || 0)
                    )
                  }
                  help="Ex : 0,25 → chaque retard retire 0,25 point d’assiduité."
                />
              )}

              {latenessMode === "ignore" && (
                <p className="text-[11px] text-slate-500 md:pt-6">
                  Les retards ne modifient pas la note d&apos;assiduité. Seules
                  les absences injustifiées sont prises en compte.
                </p>
              )}
            </div>
          </section>

          {/* Footer actions */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              Ces réglages s&apos;appliquent à{" "}
              <b>tout l&apos;établissement</b> et seront utilisés dans la
              moyenne de conduite (y compris sur le bulletin).
            </div>
            <div className="flex items-center gap-2">
              {msg && (
                <span className="text-xs text-emerald-700">{msg}</span>
              )}
              {error && (
                <span className="text-xs text-red-600">{error}</span>
              )}
              <Button type="submit" disabled={saving}>
                {saving ? "Enregistrement…" : "Enregistrer les réglages"}
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
