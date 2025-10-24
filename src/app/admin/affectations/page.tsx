"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ClassRow   = { id: string; name: string; level?: string };
type SubjectRow = { id: string; name: string };
type TeacherRow = { id: string; display_name: string | null; email: string | null; phone: string | null };

// Pour la vue de gestion
type CurrentItem = {
  teacher: { id: string; display_name: string | null; email: string | null; phone: string | null };
  subject: { id: string | null; label: string };
  classes: Array<{ id: string; name: string; level: string | null }>;
};

function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={"w-full rounded-lg border px-3 py-2 text-sm " + (p.className ?? "")} />;
}
function Button(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} className={"rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm font-medium shadow " + (p.disabled ? "opacity-60" : "hover:bg-emerald-700 transition")} />;
}
function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={"w-full rounded-lg border bg-white px-3 py-2 text-sm " + (p.className ?? "")} />;
}

export default function AffectationsPage() {
  const router = useRouter();

  async function fetchJSON<T = any>(url: string) {
    const r = await fetch(url, { cache: "no-store", credentials: "include" as RequestCredentials });
    if (r.status === 401) throw new Error("unauthorized");
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error || "Erreur");
    return j as T;
  }

  // Data (affecter)
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [classes,  setClasses]  = useState<ClassRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);

  // SÃ©lections (affecter)
  const [subjectId,  setSubjectId]  = useState<string>("");
  const [teacherId,  setTeacherId]  = useState<string>("");
  const [classIds,   setClassIds]   = useState<string[]>([]);
  const [levelsFilter, setLevelsFilter] = useState<string>("");

  // UI
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState<string | null>(null);
  const [authErr, setAuthErr] = useState(false);

  // Gestion (liste actuelle)
  const [q, setQ] = useState("");
  const [manageSubject, setManageSubject] = useState<string>("");
  const [current, setCurrent] = useState<CurrentItem[]>([]);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [manageBusy, setManageBusy] = useState(false);
  const [manageMsg, setManageMsg] = useState<string | null>(null);

  // Charger disciplines + classes
  useEffect(() => {
    (async () => {
      try {
        const [s, c] = await Promise.all([
          fetchJSON<{ items: SubjectRow[] }>("/api/admin/subjects"),
          fetchJSON<{ items: any[] }>("/api/admin/classes?limit=999"),
        ]);
        setSubjects(s.items || []);
        setClasses((c.items || []).map((x: any) => ({ id: x.id, name: x.name, level: x.level })));
      } catch (e: any) {
        if (e.message === "unauthorized") setAuthErr(true);
        else alert(e.message || "Erreur");
      }
    })();
  }, []);

  // Charger enseignants : SI discipline â†’ filtre, SINON â†’ tous
  useEffect(() => {
    (async () => {
      try {
        const url = subjectId
          ? `/api/admin/teachers/by-subject?subject_id=${encodeURIComponent(subjectId)}`
          : `/api/admin/teachers/by-subject`;
        const j = await fetchJSON<{ items: TeacherRow[] }>(url);
        setTeachers(j.items || []);
        setTeacherId(""); // reset
      } catch (e: any) {
        if (e.message === "unauthorized") setAuthErr(true);
        else alert(e.message || "Erreur");
      }
    })();
  }, [subjectId]);

  const levels = useMemo(
    () => Array.from(new Set(classes.map(c => c.level).filter(Boolean)))
      .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })),
    [classes]
  );

  const filteredClasses = useMemo(
    () => classes.filter(c => !levelsFilter || c.level === levelsFilter),
    [classes, levelsFilter]
  );

  function toggleClass(id: string) {
    setClassIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  }
  function toggleAllVisible() {
    const visibleIds = filteredClasses.map(c => c.id);
    const allSelected = visibleIds.every(id => classIds.includes(id));
    setClassIds(allSelected ? classIds.filter(id => !visibleIds.includes(id)) : Array.from(new Set([...classIds, ...visibleIds])));
  }

  async function save() {
    if (!teacherId || classIds.length === 0) return;
    setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/associations", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "teacher_classes",
          teacher_id: teacherId,
          subject_id: subjectId || null, // peut Ãªtre null au primaire
          class_ids: classIds,
        }),
      });
      const j = await r.json().catch(() => ({}));
      setSaving(false);
      if (r.status === 401) { setAuthErr(true); return; }
      if (!r.ok) { alert(j?.error || "Erreur"); return; }
      setMsg("Affectations enregistrÃ©es.");
      await loadCurrent();
    } catch (e: any) {
      setSaving(false);
      alert(e.message || "Erreur");
    }
  }

  const selectedTeacher = teachers.find(t => t.id === teacherId);

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Vue de gestion : liste actuelle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function loadCurrent() {
    setLoadingCurrent(true);
    try {
      const url = new URL(`${location.origin}/api/admin/affectations/current`);
      if (q.trim()) url.searchParams.set("q", q.trim());
      if (manageSubject) url.searchParams.set("subject_id", manageSubject);
      const j = await fetchJSON<{ items: CurrentItem[] }>(url.toString());
      setCurrent(j.items || []);
    } catch (e: any) {
      if (e.message === "unauthorized") setAuthErr(true);
      else alert(e.message || "Erreur");
    } finally {
      setLoadingCurrent(false);
    }
  }

  useEffect(() => { loadCurrent(); }, []);
  useEffect(() => { const t = setTimeout(loadCurrent, 300); return () => clearTimeout(t); }, [q, manageSubject]);

  async function removeOne(teacher_id: string, class_id: string, subject_id: string | null) {
    try {
      const r = await fetch("/api/admin/associations", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "teacher_class_remove",
          teacher_id,
          class_id,
          subject_id, // peut Ãªtre null
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j?.error || "Erreur retrait"); return; }
      await loadCurrent();
    } catch (e: any) {
      alert(e.message || "Erreur");
    }
  }

  async function clearAll(teacher_id: string, subject_id: string | null) {
    try {
      const r = await fetch("/api/admin/associations", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "teacher_classes_clear",
          teacher_id,
          subject_id, // si null â†’ toutes disciplines
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j?.error || "Erreur rÃ©initialisation"); return; }
      await loadCurrent();
    } catch (e: any) {
      alert(e.message || "Erreur");
    }
  }

  // ðŸ‘‡ NEW : reset global (tous les enseignants)
  async function clearAllInstitution(subject_id: string | null) {
    if (!confirm(`Confirmer la rÃ©initialisation pour TOUS les enseignants${subject_id ? " (discipline filtrÃ©e)" : ""} ?`)) return;
    setManageBusy(true); setManageMsg(null);
    try {
      const r = await fetch("/api/admin/associations", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "teacher_classes_clear_all",
          subject_id: subject_id || null, // optionnel
        }),
      });
      const j = await r.json().catch(() => ({}));
      setManageBusy(false);
      if (!r.ok) { alert(j?.error || "Erreur reset global"); return; }
      setManageMsg(`RÃ©initialisation effectuÃ©e : ${j.removed ?? 0} lignes supprimÃ©es.`);
      await loadCurrent();
    } catch (e: any) {
      setManageBusy(false);
      alert(e.message || "Erreur");
    }
  }

  if (authErr) {
    return (
      <div className="rounded-xl border bg-white p-5">
        <div className="text-sm text-slate-700">
          Votre session a expirÃ©.{" "}
          <button className="text-emerald-700 underline" onClick={() => router.replace("/login")}>
            Se reconnecter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Affectation des classes</h1>
        <p className="text-slate-600">
          (Filtre par discipline optionnel) â€” choisissez un enseignant, puis cochez les classes.
        </p>
      </div>

      {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€ Bloc "Affecter" (existant) â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="rounded-2xl border bg-white p-5 space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <div className="mb-1 text-xs text-slate-500">Discipline (facultatif)</div>
            <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">â€” Toutes les disciplines â€”</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>

          <div>
            <div className="mb-1 text-xs text-slate-500">Enseignant</div>
            <Select
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              disabled={teachers.length === 0}
            >
              <option value="">{teachers.length ? "â€” Choisir â€”" : "Aucun enseignant"}</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.display_name || "(Sans nom)"} {t.phone ? `â€” ${t.phone}` : t.email ? `â€” ${t.email}` : ""}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <div className="mb-1 text-xs text-slate-500">Filtrer par niveau (optionnel)</div>
            <Select value={levelsFilter} onChange={(e) => setLevelsFilter(e.target.value)}>
              <option value="">â€” Tous les niveaux â€”</option>
              {levels.map((l) => <option key={String(l)} value={String(l)}>{String(l)}</option>)}
            </Select>
          </div>
        </div>

        {selectedTeacher && (
          <div className="rounded-lg border bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <div className="font-medium">Enseignant sÃ©lectionnÃ©</div>
            <div>Nom : {selectedTeacher.display_name || "â€”"}</div>
            <div>TÃ©lÃ©phone : {selectedTeacher.phone || "â€”"}</div>
            <div>Email : {selectedTeacher.email || "â€”"}</div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Classes {levelsFilter ? `(niveau ${levelsFilter})` : ""}
          </div>
          <button type="button" onClick={toggleAllVisible} className="text-xs text-emerald-700 underline-offset-2 hover:underline">
            {filteredClasses.map(c => c.id).every(id => classIds.includes(id)) ? "Tout dÃ©sÃ©lectionner" : "Tout sÃ©lectionner"}
          </button>
        </div>

        {filteredClasses.length === 0 ? (
          <div className="text-sm text-slate-500">Aucune classe.</div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {filteredClasses.map((c) => (
              <label key={c.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <input type="checkbox" checked={classIds.includes(c.id)} onChange={() => toggleClass(c.id)} />
                <span className="font-medium">{c.name}</span>
                {c.level && <span className="text-xs text-slate-500">({c.level})</span>}
              </label>
            ))}
          </div>
        )}

        <div className="mt-4">
          <Button onClick={save} disabled={!teacherId || classIds.length === 0 || saving}>
            {saving ? "Enregistrementâ€¦" : "Enregistrer les affectations"}
          </Button>
          {msg && <span className="ml-3 text-sm text-slate-600">{msg}</span>}
        </div>
      </div>

      {/* â”€â”€â”€â”€â”€â”€â”€â”€â”€ Bloc "GÃ©rer les affectations actuelles" â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="rounded-2xl border bg-white p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            GÃ©rer les affectations actuelles
          </div>
          <div className="flex items-center gap-2">
            <div className="w-56">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Rechercher (enseignant, classe, discipline)â€¦"
              />
            </div>
            <Select value={manageSubject} onChange={(e) => setManageSubject(e.target.value)}>
              <option value="">Toutes disciplines</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
        </div>

        {loadingCurrent ? (
          <div className="text-sm text-slate-500">Chargementâ€¦</div>
        ) : current.length === 0 ? (
          <div className="text-sm text-slate-500">Aucune affectation active.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left w-72">Enseignant</th>
                  <th className="px-3 py-2 text-left w-48">Discipline</th>
                  <th className="px-3 py-2 text-left">Classes</th>
                  <th className="px-3 py-2 text-left w-48">Actions</th>
                </tr>
              </thead>
              <tbody>
                {current.map((g, idx) => (
                  <tr key={idx} className="border-t align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium">{g.teacher.display_name || "â€”"}</div>
                      <div className="text-xs text-slate-500">{g.teacher.phone || g.teacher.email || "â€”"}</div>
                    </td>
                    <td className="px-3 py-2">{g.subject.label || "â€”"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        {g.classes.map((c) => (
                          <span key={c.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5">
                            <span>{c.name}</span>
                            <button
                              className="text-xs text-rose-700 hover:underline"
                              title="Retirer cette classe"
                              onClick={() => removeOne(g.teacher.id, c.id, g.subject.id)}
                            >
                              Ã—
                            </button>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        className="rounded-lg border px-3 py-1.5 text-xs hover:bg-rose-50 text-rose-700"
                        onClick={() => clearAll(g.teacher.id, g.subject.id)}
                        title="Tout retirer pour cet enseignant (et cette discipline le cas Ã©chÃ©ant)"
                      >
                        Tout retirer{g.subject.id ? " (cette discipline)" : ""}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Danger zone : reset global */}
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-rose-800 text-sm">Zone de rÃ©initialisation</div>
              <div className="text-[12px] text-rose-700">
                Cette action supprime toutes les affectations actives de lâ€™Ã©tablissement
                {manageSubject ? " pour la discipline sÃ©lectionnÃ©e." : "."}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Select value={manageSubject} onChange={(e) => setManageSubject(e.target.value)}>
                <option value="">Toutes disciplines</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
              <button
                onClick={() => clearAllInstitution(manageSubject || null)}
                className="rounded-xl bg-rose-600 text-white px-4 py-2 text-sm font-medium shadow hover:bg-rose-700 disabled:opacity-60"
                disabled={manageBusy}
              >
                {manageBusy ? "RÃ©initialisationâ€¦" : "Tout retirer (global)"}
              </button>
            </div>
          </div>
          {manageMsg && <div className="mt-2 text-[12px] text-rose-900">{manageMsg}</div>}
        </div>
      </div>
    </div>
  );
}
