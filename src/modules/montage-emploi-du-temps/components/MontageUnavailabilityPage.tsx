"use client";

import React from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Filter,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import MontageSectionShell from "./MontageSectionShell";

type Subject = { id: string; label: string };
type Teacher = { id: string; name: string; email?: string | null; subject_ids: string[]; subject_labels: string[] };
type Period = {
  id: string;
  weekday: number;
  period_no: number;
  label: string;
  start_time?: string | null;
  end_time?: string | null;
  duration_min?: number | null;
};
type UnavailabilityItem = {
  id: string;
  teacher_id: string;
  teacher_name?: string;
  subject_labels?: string[];
  weekday: number;
  period_id?: string | null;
  period_no?: number | null;
  period_label?: string | null;
  half_day?: "morning" | "afternoon" | null;
  constraint_type: "strict" | "preference";
  reason?: string | null;
  is_active: boolean;
};

type ApiResponse =
  | {
      ok: true;
      subjects: Subject[];
      teachers: Teacher[];
      periods: Period[];
      items: UnavailabilityItem[];
      warnings?: string[];
      totals?: { teachers: number; subjects: number; periods: number; items: number };
      message?: string;
    }
  | { ok: false; error: string; message?: string };

const WEEKDAYS = [
  { value: 1, label: "Lundi", short: "Lun" },
  { value: 2, label: "Mardi", short: "Mar" },
  { value: 3, label: "Mercredi", short: "Mer" },
  { value: 4, label: "Jeudi", short: "Jeu" },
  { value: 5, label: "Vendredi", short: "Ven" },
  { value: 6, label: "Samedi", short: "Sam" },
];

function dayLabel(value: number) {
  return WEEKDAYS.find((day) => day.value === Number(value))?.label || `Jour ${value}`;
}

function halfDayLabel(value?: string | null) {
  if (value === "morning") return "Matin";
  if (value === "afternoon") return "Après-midi";
  return "Journée entière";
}

function periodHours(period?: Period | null) {
  if (!period?.start_time || !period?.end_time) return "";
  return `${period.start_time} - ${period.end_time}`;
}

function itemTargetLabel(item: UnavailabilityItem) {
  if (item.period_label) return item.period_label;
  return halfDayLabel(item.half_day);
}

function toggleValue(values: number[], value: number) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value].sort((a, b) => a - b);
}

export default function MontageUnavailabilityPage() {
  const [subjects, setSubjects] = React.useState<Subject[]>([]);
  const [teachers, setTeachers] = React.useState<Teacher[]>([]);
  const [periods, setPeriods] = React.useState<Period[]>([]);
  const [items, setItems] = React.useState<UnavailabilityItem[]>([]);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const [subjectId, setSubjectId] = React.useState("all");
  const [teacherId, setTeacherId] = React.useState("");
  const [selectedDays, setSelectedDays] = React.useState<number[]>([1]);
  const [moment, setMoment] = React.useState<"day" | "morning" | "afternoon" | "period">("day");
  const [periodId, setPeriodId] = React.useState("");
  const [constraintType, setConstraintType] = React.useState<"strict" | "preference">("strict");
  const [reason, setReason] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/admin/montage-emploi-du-temps/indisponibilites", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!json) {
        setError("Réponse serveur invalide.");
        return;
      }
      if (!json.ok) {
        setError(json.message || json.error);
        return;
      }

      setSubjects(json.subjects || []);
      setTeachers(json.teachers || []);
      setPeriods(json.periods || []);
      setItems(json.items || []);
      setWarnings(json.warnings || []);
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

  const filteredTeachers = React.useMemo(() => {
    if (subjectId === "all") return teachers;
    return teachers.filter((teacher) => teacher.subject_ids.includes(subjectId));
  }, [subjectId, teachers]);

  React.useEffect(() => {
    if (filteredTeachers.length === 0) {
      setTeacherId("");
      return;
    }
    if (!teacherId || !filteredTeachers.some((teacher) => teacher.id === teacherId)) {
      setTeacherId(filteredTeachers[0].id);
    }
  }, [filteredTeachers, teacherId]);

  const selectedDay = selectedDays.length === 1 ? selectedDays[0] : null;
  const periodsForSelectedDay = React.useMemo(() => {
    if (!selectedDay) return [];
    return periods.filter((period) => period.weekday === selectedDay);
  }, [periods, selectedDay]);

  React.useEffect(() => {
    if (moment !== "period") {
      setPeriodId("");
      return;
    }
    if (selectedDays.length !== 1) setPeriodId("");
  }, [moment, selectedDays.length]);

  const groupedItems = React.useMemo(() => {
    const map = new Map<string, { teacher_id: string; teacher_name: string; subject_labels: string[]; items: UnavailabilityItem[] }>();
    for (const item of items) {
      const key = item.teacher_id;
      if (!map.has(key)) {
        map.set(key, {
          teacher_id: item.teacher_id,
          teacher_name: item.teacher_name || "Enseignant",
          subject_labels: item.subject_labels || [],
          items: [],
        });
      }
      map.get(key)!.items.push(item);
    }
    return Array.from(map.values()).sort((a, b) => a.teacher_name.localeCompare(b.teacher_name));
  }, [items]);

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      if (!teacherId) {
        setError("Choisis un professeur.");
        return;
      }
      if (selectedDays.length === 0 && moment !== "period") {
        setError("Choisis au moins un jour.");
        return;
      }
      if (moment === "period" && (!periodId || selectedDays.length !== 1)) {
        setError("Pour un créneau précis, choisis un seul jour puis un créneau officiel.");
        return;
      }

      const selectedPeriod = periods.find((period) => period.id === periodId);
      const res = await fetch("/api/admin/montage-emploi-du-temps/indisponibilites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacher_id: teacherId,
          weekdays: moment === "period" && selectedPeriod ? [selectedPeriod.weekday] : selectedDays,
          period_id: moment === "period" ? periodId : null,
          period_no: moment === "period" ? selectedPeriod?.period_no ?? null : null,
          half_day: moment === "morning" || moment === "afternoon" ? moment : null,
          constraint_type: constraintType,
          reason,
          is_active: true,
        }),
      });

      const json = (await res.json().catch(() => null)) as
        | { ok: true; message?: string; inserted_count?: number; skipped_count?: number }
        | { ok: false; error: string; message?: string }
        | null;
      if (!json) {
        setError("Réponse serveur invalide pendant la sauvegarde.");
        return;
      }
      if (!json.ok) {
        setError(json.message || json.error);
        return;
      }

      setSuccess(json.message || "Indisponibilité sauvegardée.");
      setReason("");
      setPeriodId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de sauvegarder l’indisponibilité.");
    } finally {
      setSaving(false);
    }
  }

  async function removeOne(id: string) {
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/admin/montage-emploi-du-temps/indisponibilites?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { ok: true; message?: string } | { ok: false; error: string; message?: string } | null;
      if (!json) {
        setError("Réponse serveur invalide pendant la suppression.");
        return;
      }
      if (!json.ok) {
        setError(json.message || json.error);
        return;
      }
      setSuccess(json.message || "Indisponibilité supprimée.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de supprimer l’indisponibilité.");
    }
  }

  async function removeAllForTeacher(id: string) {
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/admin/montage-emploi-du-temps/indisponibilites?teacher_id=${encodeURIComponent(id)}&all=1`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { ok: true; message?: string } | { ok: false; error: string; message?: string } | null;
      if (!json) {
        setError("Réponse serveur invalide pendant la suppression.");
        return;
      }
      if (!json.ok) {
        setError(json.message || json.error);
        return;
      }
      setSuccess(json.message || "Indisponibilités supprimées.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de supprimer les indisponibilités du professeur.");
    }
  }

  return (
    <MontageSectionShell
      title="Indisponibilités"
      description="Déclarer les moments où un professeur ne doit pas être placé. Les professeurs viennent des affectations Mon Cahier et les créneaux viennent des créneaux officiels."
      status="Lecture Mon Cahier"
      note="La matière sert uniquement à filtrer les professeurs. La contrainte finale s’applique au professeur sélectionné."
      cards={[
        { title: "Professeurs existants", description: "Aucune création d’enseignant dans ce module : on lit les affectations déjà présentes dans Mon Cahier." },
        { title: "Journée / demi-journée", description: "On peut bloquer une journée complète, le matin ou l’après-midi pour un ou plusieurs jours." },
        { title: "Créneau précis", description: "Si besoin, on bloque un créneau officiel institution_periods, sans créer de créneau parallèle." },
      ]}
    >
      <div className="space-y-5">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-950">Ajouter une indisponibilité</h2>
              <p className="mt-1 text-sm text-slate-500">Choisis d’abord une matière pour retrouver rapidement les professeurs concernés.</p>
            </div>
            <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-60">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Recharger
            </button>
          </div>

          {warnings.length > 0 && (
            <div className="mt-5 space-y-2">
              {warnings.map((warning) => (
                <div key={warning} className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 grid gap-4 xl:grid-cols-[0.9fr_1fr_1.1fr_0.9fr]">
            <label className="space-y-1 text-sm font-bold text-slate-700">
              Matière
              <select value={subjectId} onChange={(event) => setSubjectId(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100">
                <option value="all">Toutes les matières</option>
                {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.label}</option>)}
              </select>
            </label>

            <label className="space-y-1 text-sm font-bold text-slate-700">
              Professeur
              <select value={teacherId} onChange={(event) => setTeacherId(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100">
                {filteredTeachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
              </select>
            </label>

            <label className="space-y-1 text-sm font-bold text-slate-700">
              Moment
              <select value={moment} onChange={(event) => setMoment(event.target.value as typeof moment)} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100">
                <option value="day">Toute la journée</option>
                <option value="morning">Matin seulement</option>
                <option value="afternoon">Après-midi seulement</option>
                <option value="period">Créneau précis</option>
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

          <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2 text-sm font-black text-slate-800">
                <CalendarDays className="h-4 w-4" />
                Jours concernés
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSelectedDays(WEEKDAYS.map((day) => day.value))} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">Tous les jours</button>
                <button type="button" onClick={() => { setSelectedDays([]); setPeriodId(""); }} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">Aucun</button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {WEEKDAYS.map((day) => {
                const active = selectedDays.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => { setSelectedDays((current) => toggleValue(current, day.value)); setPeriodId(""); }}
                    className={active ? "rounded-2xl bg-slate-950 px-4 py-2 text-sm font-black text-white shadow-sm" : "rounded-2xl bg-white px-4 py-2 text-sm font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"}
                  >
                    {day.short}
                  </button>
                );
              })}
            </div>
            {moment === "period" && selectedDays.length !== 1 && (
              <p className="mt-3 text-xs font-semibold text-amber-700">Pour un créneau précis, sélectionne un seul jour.</p>
            )}
          </div>

          {moment === "period" && selectedDays.length === 1 && (
            <label className="mt-5 block space-y-1 text-sm font-bold text-slate-700">
              Créneau officiel du {dayLabel(selectedDays[0])}
              <select value={periodId} onChange={(event) => setPeriodId(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100">
                <option value="">Choisir un créneau officiel</option>
                {periodsForSelectedDay.map((period) => <option key={period.id} value={period.id}>{period.label} {periodHours(period) ? `(${periodHours(period)})` : ""}</option>)}
              </select>
            </label>
          )}

          <label className="mt-5 block space-y-1 text-sm font-bold text-slate-700">
            Motif / note optionnelle
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="Ex. Indisponible le mercredi matin pour raison administrative." className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
          </label>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-500">
              {filteredTeachers.length === 0 ? "Aucun professeur trouvé pour cette matière." : `${filteredTeachers.length} professeur(s) disponible(s) pour ce filtre.`}
            </div>
            <button type="button" onClick={() => void save()} disabled={saving || !teacherId || filteredTeachers.length === 0} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Ajouter l’indisponibilité
            </button>
          </div>
        </div>

        {loading && <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-700 shadow-sm"><Loader2 className="h-5 w-5 animate-spin" /> Chargement des indisponibilités...</div>}
        {success && <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950 shadow-sm"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-black">Action réussie</p><p className="mt-1 text-sm">{success}</p></div></div></div>}
        {error && <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-950 shadow-sm"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-black">Erreur</p><p className="mt-1 text-sm">{error}</p></div></div></div>}

        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-950">Indisponibilités enregistrées</h2>
              <p className="mt-1 text-sm text-slate-500">Liste groupée par professeur. Le moteur HoraClasse utilisera ces contraintes au moment de générer.</p>
            </div>
            <Link href="/admin/montage-emploi-du-temps/creneaux" className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-800 shadow-sm hover:bg-slate-50">
              <Clock3 className="h-4 w-4" />
              Voir les créneaux officiels
            </Link>
          </div>

          <div className="mt-6 space-y-4">
            {groupedItems.map((group) => (
              <div key={group.teacher_id} className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
                <div className="flex flex-col gap-3 border-b border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                      <UserRound className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-black text-slate-950">{group.teacher_name}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">{group.subject_labels.length ? group.subject_labels.join(" · ") : "Matières déjà affectées dans Mon Cahier"}</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => void removeAllForTeacher(group.teacher_id)} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-red-50 px-4 py-2 text-xs font-black text-red-700 ring-1 ring-red-100 hover:bg-red-100">
                    <Trash2 className="h-4 w-4" />
                    Tout retirer
                  </button>
                </div>

                <div className="divide-y divide-slate-200">
                  {group.items.map((item) => (
                    <div key={item.id} className="grid gap-3 p-4 text-sm md:grid-cols-[0.9fr_1fr_0.8fr_1fr_auto] md:items-center">
                      <div className="font-black text-slate-900">{dayLabel(item.weekday)}</div>
                      <div className="font-semibold text-slate-700">{itemTargetLabel(item)}</div>
                      <div>
                        <span className={item.constraint_type === "strict" ? "rounded-full bg-red-50 px-3 py-1 text-xs font-black text-red-700 ring-1 ring-red-100" : "rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700 ring-1 ring-amber-100"}>
                          {item.constraint_type === "strict" ? "Stricte" : "Préférence"}
                        </span>
                      </div>
                      <div className="text-slate-500">{item.reason || "Aucun motif"}</div>
                      <button type="button" onClick={() => void removeOne(item.id)} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-3 py-2 text-xs font-black text-red-700 ring-1 ring-red-100 hover:bg-red-50">
                        <Trash2 className="h-4 w-4" />
                        Retirer
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {!loading && groupedItems.length === 0 && (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <Filter className="mx-auto h-8 w-8 text-slate-400" />
                <p className="mt-3 font-black text-slate-800">Aucune indisponibilité enregistrée</p>
                <p className="mt-1 text-sm text-slate-500">Ajoute les contraintes importantes avant de générer l’emploi du temps.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </MontageSectionShell>
  );
}
