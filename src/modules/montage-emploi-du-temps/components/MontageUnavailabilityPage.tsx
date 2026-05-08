"use client";

import React from "react";
import { AlertTriangle, CheckCircle2, Loader2, PlusCircle, RefreshCw, Save, Trash2 } from "lucide-react";
import MontageSectionShell from "./MontageSectionShell";

type Teacher = { id: string; name: string };
type Period = { id: string; weekday: number; period_no: number; label: string; start_time?: string | null; end_time?: string | null };
type UnavailabilityItem = {
  id: string;
  teacher_id: string;
  teacher_name?: string;
  weekday: number;
  period_id?: string | null;
  period_no?: number | null;
  period_label?: string | null;
  half_day?: "morning" | "afternoon" | "evening" | null;
  constraint_type: "strict" | "preference";
  reason?: string | null;
  is_active: boolean;
};

type ApiResponse =
  | { ok: true; teachers: Teacher[]; periods: Period[]; items: UnavailabilityItem[]; message?: string }
  | { ok: false; error: string; message?: string };

const WEEKDAYS = [
  { value: 1, label: "Lundi" },
  { value: 2, label: "Mardi" },
  { value: 3, label: "Mercredi" },
  { value: 4, label: "Jeudi" },
  { value: 5, label: "Vendredi" },
  { value: 6, label: "Samedi" },
  { value: 7, label: "Dimanche" },
];

function dayLabel(value: number) {
  return WEEKDAYS.find((day) => day.value === Number(value))?.label || `Jour ${value}`;
}

function periodLabel(period: Period) {
  const hour = period.start_time && period.end_time ? ` · ${period.start_time} - ${period.end_time}` : "";
  return `${dayLabel(period.weekday)} · ${period.label}${hour}`;
}

export default function MontageUnavailabilityPage() {
  const [teachers, setTeachers] = React.useState<Teacher[]>([]);
  const [periods, setPeriods] = React.useState<Period[]>([]);
  const [items, setItems] = React.useState<UnavailabilityItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const [teacherId, setTeacherId] = React.useState("");
  const [weekday, setWeekday] = React.useState("1");
  const [periodId, setPeriodId] = React.useState("");
  const [halfDay, setHalfDay] = React.useState("");
  const [constraintType, setConstraintType] = React.useState<"strict" | "preference">("strict");
  const [reason, setReason] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/admin/montage-emploi-du-temps/indisponibilites", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!json) return setError("Réponse serveur invalide.");
      if (!json.ok) return setError(json.message || json.error);
      setTeachers(json.teachers || []);
      setPeriods(json.periods || []);
      setItems(json.items || []);
      setTeacherId((current) => current || json.teachers?.[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger les indisponibilités.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const periodsForDay = React.useMemo(() => {
    return periods.filter((period) => period.weekday === Number(weekday));
  }, [periods, weekday]);

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const selectedPeriod = periods.find((period) => period.id === periodId);
      const res = await fetch("/api/admin/montage-emploi-du-temps/indisponibilites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacher_id: teacherId,
          weekday: Number(weekday),
          period_id: periodId || null,
          period_no: selectedPeriod?.period_no ?? null,
          half_day: halfDay || null,
          constraint_type: constraintType,
          reason,
          is_active: true,
        }),
      });

      const json = (await res.json().catch(() => null)) as { ok: true; message?: string } | { ok: false; error: string; message?: string } | null;
      if (!json) return setError("Réponse serveur invalide pendant la sauvegarde.");
      if (!json.ok) return setError(json.message || json.error);
      setSuccess(json.message || "Indisponibilité sauvegardée.");
      setReason("");
      setPeriodId("");
      setHalfDay("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de sauvegarder l’indisponibilité.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/admin/montage-emploi-du-temps/indisponibilites?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { ok: true; message?: string } | { ok: false; error: string; message?: string } | null;
      if (!json) return setError("Réponse serveur invalide pendant la suppression.");
      if (!json.ok) return setError(json.message || json.error);
      setSuccess(json.message || "Indisponibilité supprimée.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de supprimer l’indisponibilité.");
    }
  }

  return (
    <MontageSectionShell
      title="Indisponibilités"
      description="Configurer les indisponibilités enseignants utilisées par HoraClasse : contrainte stricte ou préférence."
      status="TeacherUnavailability"
      note="Une contrainte stricte bloque le placement ; une préférence oriente le score. Cette page alimente teacherUnavailability dans SchedulerContext."
      cards={[
        { title: "Contraintes strictes", description: "Le professeur ne peut jamais être placé sur ce jour, demi-journée ou créneau." },
        { title: "Préférences", description: "Le moteur peut éviter ces périodes sans bloquer totalement la génération." },
        { title: "Données moteur", description: "teacherId, dayIndex, periodIndex ou halfDay, constraintType et reason." },
      ]}
    >
      <div className="space-y-5">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="grid flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <label className="space-y-1 text-sm font-bold text-slate-700">
                Enseignant
                <select value={teacherId} onChange={(event) => setTeacherId(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100">
                  {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
                </select>
              </label>

              <label className="space-y-1 text-sm font-bold text-slate-700">
                Jour
                <select value={weekday} onChange={(event) => { setWeekday(event.target.value); setPeriodId(""); }} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100">
                  {WEEKDAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
                </select>
              </label>

              <label className="space-y-1 text-sm font-bold text-slate-700">
                Créneau précis
                <select value={periodId} onChange={(event) => setPeriodId(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100">
                  <option value="">Toute la journée / demi-journée</option>
                  {periodsForDay.map((period) => <option key={period.id} value={period.id}>{period.label} {period.start_time && period.end_time ? `(${period.start_time}-${period.end_time})` : ""}</option>)}
                </select>
              </label>

              <label className="space-y-1 text-sm font-bold text-slate-700">
                Demi-journée
                <select value={halfDay} onChange={(event) => setHalfDay(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100">
                  <option value="">Aucune</option>
                  <option value="morning">Matin</option>
                  <option value="afternoon">Après-midi</option>
                  <option value="evening">Soir</option>
                </select>
              </label>

              <label className="space-y-1 text-sm font-bold text-slate-700">
                Type
                <select value={constraintType} onChange={(event) => setConstraintType(event.target.value === "preference" ? "preference" : "strict")} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100">
                  <option value="strict">Contrainte stricte</option>
                  <option value="preference">Préférence</option>
                </select>
              </label>
            </div>

            <button type="button" onClick={() => void save()} disabled={saving || !teacherId} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-700 disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Ajouter
            </button>
          </div>

          <label className="mt-4 block space-y-1 text-sm font-bold text-slate-700">
            Motif / note
            <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex : indisponible le matin, vacation externe, préférence personnelle..." className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
          </label>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xl font-black text-slate-950">Indisponibilités enregistrées</h2>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Recharger
          </button>
        </div>

        {error && <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-950"><div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5" /><div><p className="font-black">Erreur</p><p className="text-sm">{error}</p></div></div></div>}
        {success && <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"><div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5" /><div><p className="font-black">Action réussie</p><p className="text-sm">{success}</p></div></div></div>}

        <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="flex items-center gap-3 p-6 text-sm font-semibold text-slate-600"><Loader2 className="h-5 w-5 animate-spin" /> Chargement...</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-sm font-semibold text-slate-500">Aucune indisponibilité enregistrée.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {items.map((item) => (
                <div key={item.id} className="grid gap-3 p-4 sm:grid-cols-[1.2fr_1fr_1fr_1fr_auto] sm:items-center">
                  <div><p className="font-black text-slate-950">{item.teacher_name || "Enseignant"}</p><p className="text-xs font-semibold text-slate-500">{item.reason || "Sans motif"}</p></div>
                  <div className="font-bold text-slate-700">{dayLabel(item.weekday)}</div>
                  <div className="text-sm text-slate-600">{item.period_label || item.half_day || "Journée complète"}</div>
                  <div><span className={item.constraint_type === "strict" ? "rounded-full bg-red-50 px-3 py-1 text-xs font-black text-red-700" : "rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700"}>{item.constraint_type === "strict" ? "Stricte" : "Préférence"}</span></div>
                  <button type="button" onClick={() => void remove(item.id)} className="inline-flex items-center justify-center rounded-xl border border-red-100 bg-red-50 p-3 text-red-700 hover:bg-red-100"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </MontageSectionShell>
  );
}
