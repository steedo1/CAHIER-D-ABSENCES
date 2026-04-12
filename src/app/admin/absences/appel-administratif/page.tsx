"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Users,
  Clock,
  Save,
  Play,
  Square,
  RefreshCw,
  ShieldAlert,
  ClipboardList,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

type MetaClass = {
  id: string;
  label: string;
  level: string | null;
};

type Period = {
  id: string;
  weekday: number;
  label: string;
  start_time: string;
  end_time: string;
};

type PreviewInfo = {
  teacher_name?: string | null;
  subject_name?: string | null;
  absence_request_status?: "pending" | "approved" | "rejected" | "cancelled" | null;
  absence_reason_label?: string | null;
  absence_admin_comment?: string | null;
};

type OpenSession = {
  id: string;
  class_id: string;
  class_label: string;
  period_id: string;
  period_label: string | null;
  call_date: string;
  started_at: string;
  actual_call_at?: string | null;
};

type RosterItem = {
  id: string;
  full_name: string;
  matricule: string | null;
};

type Row = {
  absent?: boolean;
  late?: boolean;
  reason?: string;
};

type MetaResponse = {
  ok: true;
  institution_name?: string | null;
  academic_year_label?: string | null;
  levels: string[];
  classes: MetaClass[];
  periods: Period[];
  open_session?: OpenSession | null;
  previews?: Record<string, PreviewInfo>;
};

function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm",
        "shadow-sm outline-none transition",
        "placeholder:text-slate-400",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        p.className ?? "",
      ].join(" ")}
    />
  );
}

function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...p}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm",
        "shadow-sm outline-none transition",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        p.className ?? "",
      ].join(" ")}
    />
  );
}

function Button(
  p: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "emerald" | "slate" | "red" }
) {
  const tone = p.tone ?? "emerald";
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium shadow transition focus:outline-none focus:ring-4 disabled:opacity-60 disabled:cursor-not-allowed";
  const tones = {
    emerald: "bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500/30",
    slate: "bg-slate-900 text-white hover:bg-slate-800 focus:ring-slate-600/30",
    red: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500/30",
  } as const;

  const { tone: _tone, ...rest } = p;
  return <button {...rest} className={[base, tones[tone], p.className ?? ""].join(" ")} />;
}

function Chip({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "emerald" | "amber" | "blue" | "red";
}) {
  const tones = {
    slate: "bg-slate-50 text-slate-700 ring-slate-200",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
    red: "bg-red-50 text-red-700 ring-red-200",
  } as const;

  return (
    <span className={["inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1", tones[tone]].join(" ")}>
      {children}
    </span>
  );
}

const LEVEL_ORDER = ["6e", "5e", "4e", "3e", "seconde", "première", "terminale"];

function compareLevels(a: string, b: string) {
  const ia = LEVEL_ORDER.indexOf(a);
  const ib = LEVEL_ORDER.indexOf(b);
  if (ia === -1 && ib === -1) return a.localeCompare(b, "fr");
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
}

function levelLabel(v: string) {
  if (v === "seconde") return "Seconde";
  if (v === "première") return "Première";
  if (v === "terminale") return "Terminale";
  return v.toUpperCase();
}

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nowHm() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export default function AppelAdministratifPage() {
  const [institutionName, setInstitutionName] = useState<string>("Votre établissement");
  const [academicYear, setAcademicYear] = useState<string | null>(null);

  const [levels, setLevels] = useState<string[]>([]);
  const [classes, setClasses] = useState<MetaClass[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [previews, setPreviews] = useState<Record<string, PreviewInfo>>({});

  const [selectedLevel, setSelectedLevel] = useState<string>("all");
  const [classId, setClassId] = useState<string>("");
  const [periodId, setPeriodId] = useState<string>("");

  const [open, setOpen] = useState<OpenSession | null>(null);
  const [roster, setRoster] = useState<RosterItem[]>([]);
  const [rows, setRows] = useState<Record<string, Row>>({});

  const [loadingMeta, setLoadingMeta] = useState<boolean>(true);
  const [loadingRoster, setLoadingRoster] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);

  const filteredClasses = useMemo(() => {
    if (selectedLevel === "all") return classes;
    return classes.filter((c) => c.level === selectedLevel);
  }, [classes, selectedLevel]);

  const selectedClass = useMemo(
    () => classes.find((c) => c.id === classId) || null,
    [classes, classId]
  );

  const selectedPeriod = useMemo(
    () => periods.find((p) => p.id === periodId) || null,
    [periods, periodId]
  );

  const previewKey = `${classId}|${periodId}`;
  const preview = previews[previewKey] || null;

  const changedCount = useMemo(
    () => Object.values(rows).filter((r) => r.absent || r.late).length,
    [rows]
  );

  async function loadMeta() {
    setLoadingMeta(true);
    setMsg(null);

    try {
      const res = await fetch("/api/admin/attendance/admin-calls/meta", {
        cache: "no-store",
      });

      const json = (await res.json().catch(() => null)) as MetaResponse | null;

      if (!res.ok || !json?.ok) {
        throw new Error("Impossible de charger les données d’appel administratif.");
      }

      const nextLevels = Array.isArray(json.levels)
        ? [...json.levels].sort(compareLevels)
        : [];
      const nextClasses = Array.isArray(json.classes) ? json.classes : [];
      const nextPeriods = Array.isArray(json.periods) ? json.periods : [];

      setInstitutionName(String(json.institution_name || "").trim() || "Votre établissement");
      setAcademicYear(
        typeof json.academic_year_label === "string" && json.academic_year_label.trim()
          ? json.academic_year_label.trim()
          : null
      );
      setLevels(nextLevels);
      setClasses(nextClasses);
      setPeriods(nextPeriods);
      setPreviews(json.previews || {});
      setOpen(json.open_session || null);

      if (json.open_session) {
        setClassId(json.open_session.class_id);
        setPeriodId(json.open_session.period_id);
      } else {
        setClassId((prev) => {
          if (prev && nextClasses.some((c) => c.id === prev)) return prev;
          return nextClasses[0]?.id || "";
        });

        setPeriodId((prev) => {
          if (prev && nextPeriods.some((p) => p.id === prev)) return prev;

          const now = nowHm();
          const live = nextPeriods.find((p) => p.start_time <= now && now < p.end_time);
          if (live) return live.id;

          const upcoming = nextPeriods.find((p) => now <= p.start_time);
          return upcoming?.id || nextPeriods[0]?.id || "";
        });
      }
    } catch (e: any) {
      setMsg(e?.message || "Erreur de chargement.");
    } finally {
      setLoadingMeta(false);
    }
  }

  async function loadRoster(targetClassId: string) {
    if (!targetClassId) {
      setRoster([]);
      setRows({});
      setRosterError(null);
      return;
    }

    setLoadingRoster(true);
    setRosterError(null);

    try {
      const res = await fetch(
        `/api/admin/attendance/admin-calls/roster?class_id=${encodeURIComponent(targetClassId)}`,
        { cache: "no-store" }
      );

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        const apiError = String(json?.error || "").trim();
        const apiMessage = String(json?.message || "").trim();

        if (apiError === "roster_unavailable") {
          setRoster([]);
          setRows({});
          setRosterError(
            apiMessage ||
              "Le roster n’est pas encore branché sur ce module. Reliez /api/admin/students ou adaptez la route roster à votre source élève."
          );
          return;
        }

        if (apiError === "roster_empty") {
          setRoster([]);
          setRows({});
          setRosterError(
            apiMessage ||
              "Aucun élève trouvé pour cette classe. Vérifiez l’affectation des élèves."
          );
          return;
        }

        throw new Error(apiMessage || "Impossible de charger la liste des élèves.");
      }

      const items = Array.isArray(json?.items) ? (json.items as RosterItem[]) : [];
      setRoster(items);
      setRows({});
      setRosterError(null);
    } catch (e: any) {
      setRoster([]);
      setRows({});
      setRosterError(e?.message || "Erreur chargement liste des élèves.");
    } finally {
      setLoadingRoster(false);
    }
  }

  useEffect(() => {
    void loadMeta();
  }, []);

  useEffect(() => {
    if (open?.class_id) {
      void loadRoster(open.class_id);
    } else {
      setRoster([]);
      setRows({});
      setRosterError(null);
    }
  }, [open?.class_id]);

  useEffect(() => {
    if (!selectedClass) return;
    if (selectedLevel === "all") return;
    if (selectedClass.level === selectedLevel) return;

    const first = filteredClasses[0];
    if (first) setClassId(first.id);
  }, [filteredClasses, selectedClass, selectedLevel]);

  function toggleAbsent(id: string, value: boolean) {
    setRows((prev) => {
      const cur = prev[id] || {};
      const next: Row = { ...cur, absent: value };
      if (value) next.late = false;
      return { ...prev, [id]: next };
    });
  }

  function toggleLate(id: string, value: boolean) {
    setRows((prev) => {
      const cur = prev[id] || {};
      const next: Row = { ...cur, late: value };
      if (value) next.absent = false;
      return { ...prev, [id]: next };
    });
  }

  function setReason(id: string, reason: string) {
    setRows((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), reason },
    }));
  }

  async function startSession() {
    if (!classId || !periodId) {
      setMsg("Sélectionnez une classe et un créneau.");
      return;
    }

    setBusy(true);
    setMsg(null);

    try {
      const res = await fetch("/api/admin/attendance/admin-calls/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_id: classId,
          period_id: periodId,
          call_date: todayYmd(),
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Impossible de démarrer l’appel administratif.");
      }

      setOpen(json.item as OpenSession);
      setMsg("Appel administratif démarré.");
    } catch (e: any) {
      setMsg(e?.message || "Échec démarrage appel.");
    } finally {
      setBusy(false);
    }
  }

  async function saveMarks() {
    if (!open) return;

    setBusy(true);
    setMsg(null);

    try {
      const marks = roster.map((st) => {
        const row = rows[st.id] || {};
        if (row.absent) {
          return {
            student_id: st.id,
            status: "absent" as const,
            reason: row.reason?.trim() || null,
          };
        }
        if (row.late) {
          return {
            student_id: st.id,
            status: "late" as const,
            reason: row.reason?.trim() || null,
          };
        }
        return {
          student_id: st.id,
          status: "present" as const,
          reason: null,
        };
      });

      const res = await fetch("/api/admin/attendance/admin-calls/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: open.id,
          marks,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Impossible d’enregistrer l’appel.");
      }

      setMsg(`Enregistré ✅ : ${json.upserted ?? 0} ligne(s) mises à jour.`);
    } catch (e: any) {
      setMsg(e?.message || "Échec enregistrement.");
    } finally {
      setBusy(false);
    }
  }

  async function endSession() {
    if (!open) return;

    setBusy(true);
    setMsg(null);

    try {
      const res = await fetch("/api/admin/attendance/admin-calls/end", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: open.id,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Impossible de terminer l’appel administratif.");
      }

      setOpen(null);
      setRoster([]);
      setRows({});
      setRosterError(null);
      setMsg("Appel administratif terminé.");
      await loadMeta();
    } catch (e: any) {
      setMsg(e?.message || "Échec fin d’appel.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <header className="overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-950 via-indigo-900 to-slate-950 px-4 py-4 sm:px-6 sm:py-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-200/80">
              {institutionName}
            </p>
            {academicYear && (
              <p className="text-[11px] font-medium text-indigo-100/80">
                Année scolaire {academicYear}
              </p>
            )}
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
              Appel administratif des élèves
            </h1>
            <p className="mt-1 max-w-2xl text-xs sm:text-sm text-indigo-100/85">
              Ce module permet à l’administration ou à l’éducateur de pointer les élèves
              sans choisir de matière et sans modifier les statistiques de l’enseignant absent.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Chip tone={open ? "emerald" : "amber"}>
              {open ? "Appel en cours" : "Aucun appel en cours"}
            </Chip>
            <Button tone="slate" onClick={loadMeta} disabled={loadingMeta || busy}>
              <RefreshCw className={`h-4 w-4 ${loadingMeta ? "animate-spin" : ""}`} />
              Actualiser
            </Button>
          </div>
        </div>
      </header>

      {msg && (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
          {msg}
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <ClipboardList className="h-4 w-4 text-slate-500" />
            <span>Préparation de l’appel</span>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Niveau</label>
              <Select
                value={selectedLevel}
                onChange={(e) => setSelectedLevel(e.target.value)}
                disabled={!!open}
              >
                <option value="all">Tous les niveaux</option>
                {levels.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {levelLabel(lvl)}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Classe</label>
              <Select
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                disabled={!!open || loadingMeta}
              >
                <option value="">Sélectionner</option>
                {filteredClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Créneau</label>
              <Select
                value={periodId}
                onChange={(e) => setPeriodId(e.target.value)}
                disabled={!!open || loadingMeta}
              >
                <option value="">Sélectionner</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label || "Séance"} • {p.start_time} → {p.end_time}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {!open ? (
              <Button onClick={startSession} disabled={busy || !classId || !periodId || loadingMeta}>
                <Play className="h-4 w-4" />
                Démarrer l’appel
              </Button>
            ) : (
              <>
                <Button
                  onClick={saveMarks}
                  disabled={busy || loadingRoster || roster.length === 0 || !!rosterError}
                >
                  <Save className="h-4 w-4" />
                  Enregistrer l’appel
                </Button>
                <Button tone="red" onClick={endSession} disabled={busy}>
                  <Square className="h-4 w-4" />
                  Terminer
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <ShieldAlert className="h-4 w-4 text-slate-500" />
            <span>Contexte du créneau</span>
          </div>

          {!classId || !periodId ? (
            <p className="text-sm text-slate-500">
              Sélectionnez une classe et un créneau pour afficher le contexte prévu.
            </p>
          ) : (
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Classe</div>
                <div className="font-medium text-slate-900">{selectedClass?.label || "—"}</div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Créneau</div>
                <div className="font-medium text-slate-900">
                  {selectedPeriod ? `${selectedPeriod.label} • ${selectedPeriod.start_time} → ${selectedPeriod.end_time}` : "—"}
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Enseignant prévu</div>
                <div className="font-medium text-slate-900">
                  {preview?.teacher_name || "Non renseigné"}
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Discipline prévue</div>
                <div className="font-medium text-slate-900">
                  {preview?.subject_name || "Non renseignée"}
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Statut absence</div>
                <div>
                  {preview?.absence_request_status === "approved" ? (
                    <Chip tone="blue">Absence justifiée</Chip>
                  ) : preview?.absence_request_status === "pending" ? (
                    <Chip tone="amber">En attente de validation</Chip>
                  ) : preview?.absence_request_status === "rejected" ? (
                    <Chip tone="red">Refusée</Chip>
                  ) : (
                    <Chip tone="slate">Aucun signalement</Chip>
                  )}
                </div>
              </div>

              {preview?.absence_reason_label && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Motif</div>
                  <div className="text-slate-700">{preview.absence_reason_label}</div>
                </div>
              )}

              {preview?.absence_admin_comment && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Commentaire admin</div>
                  <div className="text-slate-700">{preview.absence_admin_comment}</div>
                </div>
              )}

              <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                Ces informations sont affichées à titre informatif seulement.
                Elles ne servent pas à valider l’appel enseignant.
              </div>
            </div>
          )}
        </div>
      </section>

      {rosterError && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-4 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div className="space-y-1">
              <div className="text-sm font-semibold text-amber-900">
                Roster non disponible pour ce module
              </div>
              <div className="text-sm text-amber-900/90">{rosterError}</div>
              <div className="text-xs text-amber-800/90">
                Ce blocage n’empêche pas le reste du module d’exister.
                Il signifie simplement que la source élève centrale doit encore être branchée ici.
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Liste des élèves</div>
            <div className="text-xs text-slate-500">
              Présents implicites — cochez seulement les absents et retards.
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Chip tone="slate">
              <Users className="mr-1 h-3.5 w-3.5" />
              {roster.length} élève(s)
            </Chip>
            <Chip tone="emerald">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              {changedCount} marqué(s)
            </Chip>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr className="text-left text-slate-600">
                <th className="px-4 py-3 w-14">N°</th>
                <th className="px-4 py-3 w-40">Matricule</th>
                <th className="px-4 py-3">Nom et prénoms</th>
                <th className="px-4 py-3 w-28">Absent</th>
                <th className="px-4 py-3 w-28">Retard</th>
                <th className="px-4 py-3 min-w-[240px]">Motif</th>
              </tr>
            </thead>

            <tbody className="divide-y">
              {loadingRoster ? (
                <tr>
                  <td className="px-4 py-5 text-slate-500" colSpan={6}>
                    Chargement de la liste…
                  </td>
                </tr>
              ) : !open ? (
                <tr>
                  <td className="px-4 py-5 text-slate-500" colSpan={6}>
                    Démarrez d’abord un appel administratif.
                  </td>
                </tr>
              ) : rosterError ? (
                <tr>
                  <td className="px-4 py-5 text-amber-700" colSpan={6}>
                    Le roster n’est pas encore exploitable pour cette classe.
                  </td>
                </tr>
              ) : roster.length === 0 ? (
                <tr>
                  <td className="px-4 py-5 text-slate-500" colSpan={6}>
                    Aucun élève trouvé dans cette classe.
                  </td>
                </tr>
              ) : (
                roster.map((st, idx) => {
                  const row = rows[st.id] || {};
                  return (
                    <tr key={st.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">{idx + 1}</td>
                      <td className="px-4 py-3">{st.matricule || "—"}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">{st.full_name}</td>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={!!row.absent}
                          onChange={(e) => toggleAbsent(st.id, e.target.checked)}
                          disabled={busy}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={!!row.late}
                          onChange={(e) => toggleLate(st.id, e.target.checked)}
                          disabled={busy}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Input
                          placeholder="Motif facultatif"
                          value={row.reason || ""}
                          onChange={(e) => setReason(st.id, e.target.value)}
                          disabled={busy || (!row.absent && !row.late)}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {open && (
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-4">
            <div className="text-xs text-slate-500">
              Créneau en cours :{" "}
              <span className="font-medium text-slate-700">
                {open.period_label || selectedPeriod?.label || "Séance"}
              </span>
              {selectedPeriod && (
                <>
                  {" "}
                  • {selectedPeriod.start_time} → {selectedPeriod.end_time}
                </>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                onClick={saveMarks}
                disabled={busy || loadingRoster || roster.length === 0 || !!rosterError}
              >
                <Save className="h-4 w-4" />
                Enregistrer
              </Button>
              <Button tone="red" onClick={endSession} disabled={busy}>
                <Square className="h-4 w-4" />
                Terminer
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900 shadow-sm">
        <div className="flex items-start gap-2">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            Cet appel est un <span className="font-semibold">appel administratif élève</span>.
            Il sert à informer les parents et à suivre la présence des élèves, mais il ne doit
            jamais être interprété comme un appel effectué par l’enseignant.
          </div>
        </div>
      </section>
    </div>
  );
}