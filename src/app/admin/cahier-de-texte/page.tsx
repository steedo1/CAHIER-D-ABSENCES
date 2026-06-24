"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Upload,
} from "lucide-react";

type SubjectItem = { id: string; name: string; inst_subject_id?: string | null };
type ClassItem = { id: string; label?: string; name?: string; level?: string | null; academic_year?: string | null };
type Progression = {
  id: string;
  title: string;
  academic_year: string;
  subject_id?: string | null;
  institution_subject_id?: string | null;
  subject_name?: string | null;
  level?: string | null;
  series?: string | null;
  description?: string | null;
  document?: { original_name?: string | null; signed_url?: string | null } | null;
  items?: Array<{ id: string }>;
  assignments?: Array<{ id: string; class_id: string; is_active: boolean }>;
};

type ProgressionItem = {
  id: string;
  item_type: string;
  title: string;
  rubric?: string | null;
  theme?: string | null;
  trimester?: string | null;
  week_label?: string | null;
  planned_duration_minutes?: number | null;
  sort_order?: number | null;
  indent_level?: number | null;
};

type Assignment = {
  id: string;
  class_id: string;
  is_active: boolean;
  classes?: { id: string; label?: string | null; level?: string | null } | null;
};

type StatsItem = {
  assignment_id: string;
  progression_title: string;
  class_label: string;
  level: string | null;
  subject_name: string;
  teacher_name: string;
  expected_items: number;
  completed_items: number;
  completion_rate: number;
  sessions_count: number;
  realized_hours: number;
};

const emptyCreate = {
  title: "",
  academic_year: "",
  level: "",
  series: "",
  subject_id: "",
  description: "",
};

function classNames(...arr: Array<string | false | null | undefined>) {
  return arr.filter(Boolean).join(" ");
}

function labelClass(c: ClassItem | Assignment["classes"]) {
  return String(c?.label || (c as any)?.name || "Classe");
}

function parseImportLines(text: string) {
  return text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const cells = line.split(";").map((cell) => cell.trim());
      if (index === 0 && /type|titre|le[cç]on|rubrique/i.test(line) && cells.length > 3) {
        return null;
      }

      const [order, type, rubric, theme, title, duration, trimester, week] = cells;
      const finalTitle = title || theme || rubric || line;
      const minutes = Number(String(duration || "").replace(/[^0-9]/g, ""));

      return {
        sort_order: Number(order) || index + 1,
        item_type: type || "lesson",
        rubric: rubric || null,
        theme: theme || null,
        title: finalTitle,
        planned_duration_minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
        trimester: trimester || null,
        week_label: week || null,
        indent_level: type && ["section", "theme", "rubric", "competency"].includes(type.toLowerCase()) ? 0 : 1,
      };
    })
    .filter(Boolean);
}

export default function AdminTextbookPage() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [progressions, setProgressions] = useState<Progression[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [items, setItems] = useState<ProgressionItem[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [stats, setStats] = useState<StatsItem[]>([]);

  const [createForm, setCreateForm] = useState(emptyCreate);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [importText, setImportText] = useState(
    "Ordre;Type;Rubrique;Thème;Titre;Durée minutes;Trimestre;Semaine\n1;theme;Activités numériques;Nombres;Nombres entiers naturels;120;T1;Semaine 1"
  );
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);

  const selected = useMemo(
    () => progressions.find((p) => p.id === selectedId) || null,
    [progressions, selectedId]
  );

  async function fetchJson(url: string, init?: RequestInit) {
    const res = await fetch(url, { cache: "no-store", credentials: "include", ...init });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.ok === false) {
      throw new Error(json?.error || json?.details || `Erreur HTTP ${res.status}`);
    }
    return json;
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [subjectJson, classJson, progressionJson, statsJson] = await Promise.all([
        fetchJson("/api/admin/subjects"),
        fetchJson("/api/admin/classes?limit=999"),
        fetchJson("/api/admin/textbook/progressions"),
        fetchJson("/api/admin/textbook/stats"),
      ]);

      setSubjects(subjectJson.items || []);
      setClasses(classJson.items || []);
      setProgressions(progressionJson.items || []);
      setStats(statsJson.items || []);

      const firstId = progressionJson.items?.[0]?.id || "";
      setSelectedId((current) => current || firstId);
    } catch (e: any) {
      setError(e?.message || "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }

  async function loadSelected(id: string) {
    if (!id) return;
    try {
      const [itemsJson, assignmentsJson] = await Promise.all([
        fetchJson(`/api/admin/textbook/progressions/${id}/items`),
        fetchJson(`/api/admin/textbook/progressions/${id}/assignments`),
      ]);
      setItems(itemsJson.items || []);
      setAssignments(assignmentsJson.items || []);
    } catch (e: any) {
      setError(e?.message || "Détails indisponibles");
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    setItems([]);
    setAssignments([]);
    setSelectedClassIds([]);
    if (selectedId) loadSelected(selectedId);
  }, [selectedId]);

  async function createProgression(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const subject = subjects.find((s) => s.id === createForm.subject_id);
      const form = new FormData();
      form.set("title", createForm.title);
      form.set("academic_year", createForm.academic_year);
      form.set("level", createForm.level);
      form.set("series", createForm.series);
      form.set("subject_id", subject?.id || "");
      form.set("institution_subject_id", subject?.inst_subject_id || "");
      form.set("subject_name", subject?.name || "");
      form.set("description", createForm.description);
      if (documentFile) form.set("document_file", documentFile);

      const json = await fetchJson("/api/admin/textbook/progressions", {
        method: "POST",
        body: form,
      });

      setMessage("Progression créée. Vous pouvez maintenant importer les leçons et affecter les classes.");
      setCreateForm(emptyCreate);
      setDocumentFile(null);
      await loadAll();
      setSelectedId(json.item?.id || "");
    } catch (e: any) {
      setError(e?.message || "Création impossible");
    } finally {
      setBusy(false);
    }
  }

  async function importItems() {
    if (!selected) return;
    const parsed = parseImportLines(importText);
    if (!parsed.length) {
      setError("Aucune ligne exploitable dans l'import.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fetchJson(`/api/admin/textbook/progressions/${selected.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: parsed, replace: items.length === 0 }),
      });
      setMessage(`${parsed.length} ligne(s) importée(s) dans la progression.`);
      await loadSelected(selected.id);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Import impossible");
    } finally {
      setBusy(false);
    }
  }

  async function assignClasses() {
    if (!selected || !selectedClassIds.length) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fetchJson(`/api/admin/textbook/progressions/${selected.id}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_ids: selectedClassIds }),
      });
      setMessage("Progression affectée aux classes sélectionnées.");
      await loadSelected(selected.id);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Affectation impossible");
    } finally {
      setBusy(false);
    }
  }

  const compatibleClasses = useMemo(() => {
    if (!selected?.level) return classes;
    const level = selected.level.toLowerCase();
    return classes.filter((c) => String(c.level || "").toLowerCase() === level || labelClass(c).toLowerCase().includes(level));
  }, [classes, selected?.level]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 md:px-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="overflow-hidden rounded-[30px] border border-emerald-100 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-emerald-700 via-emerald-600 to-sky-600 px-6 py-7 text-white">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] ring-1 ring-white/20">
                  <BookOpen className="h-4 w-4" /> Module pédagogique
                </div>
                <h1 className="mt-4 text-3xl font-black tracking-tight md:text-4xl">Cahier de texte</h1>
                <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-emerald-50">
                  Progressions officielles, séances réalisées par les enseignants, leçons terminées et statistiques de suivi par classe, matière et professeur.
                </p>
              </div>
              <button
                onClick={loadAll}
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-black text-emerald-700 shadow-sm"
              >
                <RefreshCw className="h-4 w-4" /> Actualiser
              </button>
            </div>
          </div>
        </header>

        {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{message}</div> : null}
        {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}

        {loading ? (
          <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white p-6 text-sm font-bold text-slate-600 shadow-sm">
            <Loader2 className="h-5 w-5 animate-spin" /> Chargement du cahier de texte…
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
            <section className="space-y-6">
              <form onSubmit={createProgression} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                    <Plus className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black">Créer une progression</h2>
                    <p className="text-xs font-medium text-slate-500">Une progression = une discipline + un niveau/classe + une année.</p>
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  <input
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                    placeholder="Titre : Progression Mathématiques 4e"
                    value={createForm.title}
                    onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
                    required
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                      placeholder="Année 2026-2027"
                      value={createForm.academic_year}
                      onChange={(e) => setCreateForm((f) => ({ ...f, academic_year: e.target.value }))}
                    />
                    <input
                      className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                      placeholder="Niveau : 4e"
                      value={createForm.level}
                      onChange={(e) => setCreateForm((f) => ({ ...f, level: e.target.value }))}
                      required
                    />
                  </div>
                  <select
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                    value={createForm.subject_id}
                    onChange={(e) => setCreateForm((f) => ({ ...f, subject_id: e.target.value }))}
                    required
                  >
                    <option value="">Choisir la discipline</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <input
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                    placeholder="Série / option si nécessaire : 2nde C, Tle A2…"
                    value={createForm.series}
                    onChange={(e) => setCreateForm((f) => ({ ...f, series: e.target.value }))}
                  />
                  <textarea
                    className="min-h-20 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-400"
                    placeholder="Observation ou précision sur le modèle de progression"
                    value={createForm.description}
                    onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                  />
                  <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
                    <Upload className="h-4 w-4" />
                    <span>{documentFile ? documentFile.name : "Joindre le fichier officiel PDF/Word/Excel"}</span>
                    <input className="hidden" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv" onChange={(e) => setDocumentFile(e.target.files?.[0] || null)} />
                  </label>
                  <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Enregistrer la progression
                  </button>
                </div>
              </form>

              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-black">Progressions disponibles</h2>
                <div className="mt-4 space-y-2">
                  {progressions.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedId(p.id)}
                      className={classNames(
                        "w-full rounded-2xl border px-4 py-3 text-left transition",
                        selectedId === p.id ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50"
                      )}
                    >
                      <div className="text-sm font-black text-slate-900">{p.title}</div>
                      <div className="mt-1 text-xs font-bold text-slate-500">{p.subject_name || "Matière"} · {p.level || "Niveau"} · {p.academic_year}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-black">
                        <span className="rounded-full bg-white px-2 py-1 text-slate-600 ring-1 ring-slate-200">{p.items?.length || 0} lignes</span>
                        <span className="rounded-full bg-white px-2 py-1 text-slate-600 ring-1 ring-slate-200">{p.assignments?.length || 0} classes</span>
                      </div>
                    </button>
                  ))}
                  {!progressions.length ? <div className="rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-500">Aucune progression créée pour le moment.</div> : null}
                </div>
              </section>
            </section>

            <section className="space-y-6">
              {!selected ? (
                <div className="rounded-[28px] border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-500 shadow-sm">Sélectionnez une progression pour continuer.</div>
              ) : (
                <>
                  <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Progression sélectionnée</div>
                        <h2 className="mt-1 text-2xl font-black">{selected.title}</h2>
                        <p className="mt-1 text-sm font-bold text-slate-500">{selected.subject_name || "Matière"} · {selected.level || "Niveau"} · {selected.academic_year}</p>
                      </div>
                      {selected.document?.signed_url ? (
                        <a href={selected.document.signed_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-black text-slate-700">
                          <FileText className="h-4 w-4" /> Ouvrir le fichier officiel
                        </a>
                      ) : null}
                    </div>
                  </section>

                  <div className="grid gap-6 lg:grid-cols-2">
                    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                      <h3 className="text-lg font-black">Importer les lignes cliquables</h3>
                      <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
                        Format simple : Ordre;Type;Rubrique;Thème;Titre;Durée minutes;Trimestre;Semaine. Chaque matière peut garder sa structure.
                      </p>
                      <textarea
                        className="mt-4 h-52 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs outline-none focus:border-emerald-400"
                        value={importText}
                        onChange={(e) => setImportText(e.target.value)}
                      />
                      <button onClick={importItems} disabled={busy} className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white disabled:opacity-60">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        Importer dans cette progression
                      </button>
                    </section>

                    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                      <h3 className="text-lg font-black">Affecter aux classes</h3>
                      <p className="mt-1 text-xs font-medium leading-5 text-slate-500">La progression devient visible dans le cahier de texte des enseignants affectés à la classe et à la discipline.</p>
                      <div className="mt-4 max-h-64 space-y-2 overflow-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        {compatibleClasses.map((c) => {
                          const checked = selectedClassIds.includes(c.id);
                          const already = assignments.some((a) => a.class_id === c.id && a.is_active);
                          return (
                            <label key={c.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-sm font-bold ring-1 ring-slate-200">
                              <span>{labelClass(c)} <span className="text-xs text-slate-400">{c.level || ""}</span></span>
                              <span className="flex items-center gap-2">
                                {already ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">Déjà liée</span> : null}
                                <input type="checkbox" checked={checked} onChange={(e) => setSelectedClassIds((prev) => e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id))} />
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      <button onClick={assignClasses} disabled={busy || !selectedClassIds.length} className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white disabled:opacity-60">
                        <CheckCircle2 className="h-4 w-4" /> Affecter les classes sélectionnées
                      </button>
                    </section>
                  </div>

                  <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="text-lg font-black">Lignes de progression</h3>
                    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                          <tr><th className="px-3 py-3">Ordre</th><th className="px-3 py-3">Type</th><th className="px-3 py-3">Titre</th><th className="px-3 py-3">Durée</th><th className="px-3 py-3">Période</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {items.map((item) => (
                            <tr key={item.id}>
                              <td className="px-3 py-3 font-bold text-slate-500">{item.sort_order || "—"}</td>
                              <td className="px-3 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">{item.item_type}</span></td>
                              <td className="px-3 py-3 font-bold" style={{ paddingLeft: `${12 + (item.indent_level || 0) * 18}px` }}>{item.title}</td>
                              <td className="px-3 py-3 text-slate-600">{item.planned_duration_minutes ? `${item.planned_duration_minutes} min` : "—"}</td>
                              <td className="px-3 py-3 text-slate-600">{item.trimester || item.week_label || "—"}</td>
                            </tr>
                          ))}
                          {!items.length ? <tr><td colSpan={5} className="px-3 py-8 text-center font-bold text-slate-400">Aucune ligne importée.</td></tr> : null}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="text-lg font-black">Statistiques d’exécution</h3>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl bg-slate-50 p-4"><div className="text-xs font-black uppercase text-slate-500">Classes suivies</div><div className="mt-1 text-2xl font-black">{stats.length}</div></div>
                      <div className="rounded-2xl bg-emerald-50 p-4"><div className="text-xs font-black uppercase text-emerald-700">Séances saisies</div><div className="mt-1 text-2xl font-black text-emerald-800">{stats.reduce((s, i) => s + i.sessions_count, 0)}</div></div>
                      <div className="rounded-2xl bg-sky-50 p-4"><div className="text-xs font-black uppercase text-sky-700">Heures réalisées</div><div className="mt-1 text-2xl font-black text-sky-800">{Math.round(stats.reduce((s, i) => s + i.realized_hours, 0) * 10) / 10}</div></div>
                    </div>
                    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                          <tr><th className="px-3 py-3">Classe</th><th className="px-3 py-3">Matière</th><th className="px-3 py-3">Prof</th><th className="px-3 py-3">Progression</th><th className="px-3 py-3">Séances</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {stats.slice(0, 12).map((row) => (
                            <tr key={row.assignment_id}>
                              <td className="px-3 py-3 font-black">{row.class_label}</td>
                              <td className="px-3 py-3">{row.subject_name}</td>
                              <td className="px-3 py-3 text-slate-600">{row.teacher_name}</td>
                              <td className="px-3 py-3"><span className="font-black text-emerald-700">{row.completion_rate}%</span> <span className="text-xs text-slate-500">({row.completed_items}/{row.expected_items})</span></td>
                              <td className="px-3 py-3">{row.sessions_count}</td>
                            </tr>
                          ))}
                          {!stats.length ? <tr><td colSpan={5} className="px-3 py-8 text-center font-bold text-slate-400">Aucune statistique disponible.</td></tr> : null}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
