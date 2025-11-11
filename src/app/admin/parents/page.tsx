// src/app/admin/students-by-class/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/* ───────── UI helpers ───────── */
function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15",
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
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15",
        p.className ?? "",
      ].join(" ")}
    />
  );
}
function Button(
  p: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "emerald" | "white" | "slate" | "danger" }
) {
  const tone = p.tone ?? "emerald";
  const map: Record<NonNullable<typeof p.tone>, string> = {
    emerald: "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800",
    white: "bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-white/90 active:bg-slate-50",
    slate: "bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-900",
    danger: "bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800",
  };
  const { tone: _t, className, ...rest } = p;
  return (
    <button
      {...rest}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium shadow-sm transition",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        map[tone],
        className ?? "",
      ].join(" ")}
    />
  );
}
function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
      {children}
    </span>
  );
}
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-slate-200/70 ${className}`} />;
}

/* ───────── Types ───────── */
type ClassRow = { id: string; name: string; level: string; label?: string | null };
type StudentRow = {
  id: string;
  full_name: string;
  class_id: string | null;
  class_label: string | null;
  matricule?: string | null;
  level?: string | null;
};

/** Transforme "Prénoms Nom" → "Nom Prénoms" */
function nomAvantPrenoms(full: string): string {
  const t = (full || "").trim().replace(/\s+/g, " ");
  if (!t) return "—";
  const parts = t.split(" ");
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  const firsts = parts.slice(0, -1).join(" ");
  return `${last} ${firsts}`;
}
function norm(s: string) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export default function AdminStudentsByClassPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);

  const [level, setLevel] = useState<string>("");
  const [classId, setClassId] = useState<string>("");
  const [q, setQ] = useState("");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [loading, setLoading] = useState(true);
  const [authErr, setAuthErr] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [editing, setEditing] = useState<null | {
    id: string;
    first_name: string;
    last_name: string;
    matricule: string;
  }>(null);
  const [saving, setSaving] = useState(false);

  const [removingId, setRemovingId] = useState<string | null>(null);

  // ➕ Ajout / Transfert
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignMode, setAssignMode] = useState<"new" | "transfer">("new");
  const [assigning, setAssigning] = useState(false);
  const [form, setForm] = useState({
    new_last_name: "",
    new_first_name: "",
    new_matricule: "",
    transfer_matricule: "",
  });

  // 🔎 Autocomplete global (transfert par NOM)
  const [searchQ, setSearchQ] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchItems, setSearchItems] = useState<
    Array<{ id: string; first_name: string | null; last_name: string | null; matricule: string | null; class_id: string | null; class_label: string | null }>
  >([]);
  const [selectedStu, setSelectedStu] = useState<null | { id: string; first_name: string | null; last_name: string | null; matricule: string | null }>(null);
  const searchAbort = useRef<AbortController | null>(null);

  function resetAssign() {
    setAssignMode("new");
    setForm({ new_last_name: "", new_first_name: "", new_matricule: "", transfer_matricule: "" });
    setSearchQ("");
    setSearchItems([]);
    setSelectedStu(null);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);
      try {
        const rc = await fetch("/api/admin/classes?limit=999", { cache: "no-store" });
        const rs = await fetch("/api/admin/students", { cache: "no-store" });
        if (rc.status === 401 || rs.status === 401) {
          setAuthErr(true);
          setLoading(false);
          return;
        }
        const [cj, sj] = await Promise.all([rc.json().catch(() => ({})), rs.json().catch(() => ({}))]);
        if (!rc.ok || !rs.ok) throw new Error(cj?.error || sj?.error || "HTTP_ERROR");
        setClasses((cj.items || []) as ClassRow[]);
        setStudents((sj.items || []) as StudentRow[]);
      } catch (e: any) {
        setMsg(e?.message || "Erreur de chargement");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const classLevelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of classes) m.set(c.id, c.level);
    return m;
  }, [classes]);

  const levels = useMemo(
    () =>
      Array.from(new Set(classes.map((c) => c.level).filter(Boolean))).sort((a, b) =>
        String(a).localeCompare(String(b), undefined, { numeric: true })
      ),
    [classes]
  );

  const classesOfLevel = useMemo(() => classes.filter((c) => !level || c.level === level), [classes, level]);

  const studentsFiltered = useMemo(() => {
    let list = students;
    if (level) list = list.filter((s) => (s.level ?? classLevelById.get(s.class_id || "") ?? "") === level);
    if (classId) list = list.filter((s) => s.class_id === classId);

    if (q.trim()) {
      const k = norm(q.trim());
      list = list.filter((s) => {
        const full = s.full_name || "";
        const display = nomAvantPrenoms(full);
        return norm(full).includes(k) || norm(display).includes(k) || norm(s.matricule ?? "").includes(k);
      });
    }

    return [...list].sort((a, b) =>
      nomAvantPrenoms(a.full_name).localeCompare(nomAvantPrenoms(b.full_name), undefined, { sensitivity: "base" })
    );
  }, [students, classId, level, q, classLevelById]);

  const total = studentsFiltered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageSafe = Math.min(Math.max(1, page), totalPages);
  const startIdx = (pageSafe - 1) * pageSize;
  const endIdx = startIdx + pageSize;
  const pageItems = studentsFiltered.slice(startIdx, endIdx);

  useEffect(() => {
    setPage(1);
  }, [level, classId, q, pageSize]);

  function openEdit(s: StudentRow) {
    const parts = (s.full_name || "").trim().split(/\s+/);
    const first_name = parts[0] ?? "";
    const last_name = parts.slice(1).join(" ");
    setEditing({
      id: s.id,
      first_name,
      last_name,
      matricule: s.matricule || "",
    });
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/students/${encodeURIComponent(editing.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: editing.first_name || null,
          last_name: editing.last_name || null,
          matricule: editing.matricule || null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setAuthErr(true);
        return;
      }
      if (!res.ok) throw new Error(j?.error || "SAVE_FAILED");

      setStudents((prev) =>
        prev.map((s) =>
          s.id === editing.id
            ? {
                ...s,
                full_name: [editing.first_name, editing.last_name].filter(Boolean).join(" ") || s.full_name,
                matricule: editing.matricule || null,
              }
            : s
        )
      );
      setEditing(null);
      setMsg("Élève mis à jour ✓");
    } catch (e: any) {
      setMsg(e?.message || "Erreur de sauvegarde");
    } finally {
      setSaving(false);
    }
  }

  async function removeFromClass(s: StudentRow) {
    if (!s.class_id) return;
    if (!confirm(`Retirer ${nomAvantPrenoms(s.full_name)} de la classe ${s.class_label ?? ""} ?`)) return;
    setRemovingId(s.id);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/enrollments/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_id: s.class_id, student_id: s.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setAuthErr(true);
        return;
      }
      if (!res.ok) throw new Error(j?.error || "REMOVE_FAILED");

      setStudents((prev) => prev.map((x) => (x.id === s.id ? { ...x, class_id: null, class_label: null } : x)));
      setMsg("Élève retiré de la classe ✓");
    } catch (e: any) {
      setMsg(e?.message || "Erreur lors du retrait");
    } finally {
      setRemovingId(null);
    }
  }

  const asExcelText = (val: string) => `="${val.replace(/"/g, '""')}"`;
  function toCsvCell(v: string, sep: string) {
    if (v.includes('"') || v.includes("\n") || v.includes(sep)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  }
  function exportCsv(currentPageOnly: boolean) {
    const sep = ",";
    const EOL = "\r\n";
    const rows = currentPageOnly ? pageItems : studentsFiltered;
    const baseIndex = currentPageOnly ? startIdx : 0;

    const header = ["N°", "Nom complet", "Matricule", "Classe"];
    const lines: string[] = [];
    lines.push(`sep=${sep}`);
    lines.push(header.join(sep));

    rows.forEach((r, i) => {
      const numero = String(baseIndex + i + 1);
      const nomComplet = nomAvantPrenoms(r.full_name || "");
      const matricule = r.matricule ? asExcelText(r.matricule) : "";
      const classe = r.class_label ? asExcelText(r.class_label) : "";

      lines.push([toCsvCell(numero, sep), toCsvCell(nomComplet, sep), matricule, classe].join(sep));
    });

    const csv = "\uFEFF" + lines.join(EOL);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const cls = classes.find((c) => c.id === classId);
    const filename =
      (cls ? `eleves_${(cls.name || cls.label || "classe").replace(/\s+/g, "_")}` : "eleves") +
      (q.trim() ? `_filtre` : "") +
      ".csv";
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // 🔎 Debounce + fetch autocomplete (transfert par NOM)
  useEffect(() => {
    if (assignMode !== "transfer") return;
    const k = searchQ.trim();
    if (k.length < 2) {
      setSearchItems([]);
      setSelectedStu(null);
      return;
    }
    setSearchBusy(true);
    searchAbort.current?.abort();
    const ctrl = new AbortController();
    searchAbort.current = ctrl;

    const tid = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/students/search?q=${encodeURIComponent(k)}`, { signal: ctrl.signal });
        const j = await res.json().catch(() => ({}));
        if (res.ok) setSearchItems(Array.isArray(j?.items) ? j.items : []);
        else setSearchItems([]);
      } catch (e: any) {
        if (e?.name !== "AbortError") setSearchItems([]);
      } finally {
        setSearchBusy(false);
      }
    }, 250);

    return () => {
      clearTimeout(tid);
      ctrl.abort();
    };
  }, [assignMode, searchQ]);

  function chooseStudent(it: { id: string; first_name: string | null; last_name: string | null; matricule: string | null }) {
    setSelectedStu(it);
    setForm((f) => ({ ...f, transfer_matricule: it.matricule || "" }));
  }

  async function submitAssign() {
    if (!classId) {
      setMsg("Choisissez d’abord une classe.");
      return;
    }
    setAssigning(true);
    setMsg(null);

    try {
      let body: any;
      if (assignMode === "new") {
        const first_name = form.new_first_name.trim();
        const last_name = form.new_last_name.trim();
        const matricule = form.new_matricule.trim();
        if (!first_name && !last_name) throw new Error("Renseignez au moins le nom ou les prénoms.");
        body = {
          action: "create_and_assign",
          class_id: classId,
          first_name: first_name || null,
          last_name: last_name || null,
          matricule: matricule || null,
        };
      } else {
        // Transfert : on privilégie l'ID si choisi via l'autocomplete, sinon le matricule saisi
        if (selectedStu?.id && !form.transfer_matricule.trim()) {
          body = { action: "assign", class_id: classId, student_id: selectedStu.id };
        } else {
          const matr = form.transfer_matricule.trim();
          if (!matr) throw new Error("Renseignez un matricule ou sélectionnez un élève dans la recherche.");
          body = { action: "assign", class_id: classId, matricule: matr };
        }
      }

      const res = await fetch("/api/admin/enrollments/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setAuthErr(true);
        return;
      }
      if (!res.ok) throw new Error(j?.error || "ASSIGN_FAILED");

      const stu = j?.student as { id: string; first_name: string | null; last_name: string | null; matricule: string | null };
      if (!stu?.id) throw new Error("Réponse incomplète (student manquant).");

      const cls = classes.find((c) => c.id === classId);
      const full = [stu.first_name || "", stu.last_name || ""].filter(Boolean).join(" ").trim() || "—";

      setStudents((prev) => {
        const existing = prev.find((x) => x.id === stu.id);
        const class_label = cls?.name || cls?.label || null;
        const levelOfClass = cls?.level || null;
        if (existing) {
          return prev.map((x) =>
            x.id === stu.id
              ? { ...x, full_name: full, class_id: classId, class_label, matricule: stu.matricule, level: levelOfClass }
              : x
          );
        }
        return [
          ...prev,
          { id: stu.id, full_name: full, class_id: classId, class_label, matricule: stu.matricule, level: levelOfClass },
        ];
      });

      setAssignOpen(false);
      resetAssign();
      setMsg(assignMode === "new" ? "Élève ajouté et inscrit ✓" : "Élève transféré ✓");
    } catch (e: any) {
      setMsg(e?.message || "Erreur lors de l’opération");
    } finally {
      setAssigning(false);
    }
  }

  if (authErr) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="text-sm text-slate-700">
            Votre session a expiré.{" "}
            <a className="text-emerald-700 underline" href="/login">
              Se reconnecter
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-6 space-y-6">
      {/* Header */}
      <header className="relative overflow-hidden rounded-3xl border border-slate-800/20 bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-5 py-5 md:px-7 md:py-6 text-white shadow-sm">
        <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(60%_50%_at_100%_0%,white,transparent_70%)]" />
        <div className="relative z-10 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Liste des élèves par classe</h1>
            <p className="mt-1 text-white/80 text-sm">
              Sélectionnez un <b>niveau</b>, choisissez la <b>classe</b>, recherchez et modifiez un élève.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button tone="white" onClick={() => exportCsv(true)} disabled={loading || (!classId && !studentsFiltered.length)}>
              Exporter CSV (page)
            </Button>
            <Button onClick={() => exportCsv(false)} disabled={loading || (!classId && !studentsFiltered.length)}>
              Exporter CSV (tous)
            </Button>
          </div>
        </div>
      </header>

      {/* Filtres */}
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <div className="mb-1 text-xs text-slate-600">Niveau</div>
            <Select
              value={level}
              onChange={(e) => {
                setLevel(e.target.value);
                setClassId("");
              }}
            >
              <option value="">— Tous —</option>
              {levels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-600">Classe</div>
            <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">— Choisir —</option>
              {classesOfLevel.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.label || c.id}
                </option>
              ))}
            </Select>
          </div>
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-600">Recherche (nom ou matricule)</div>
            <Input placeholder="Ex : KOUASSI / 20166309J" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </section>

      {/* Tableau + pagination */}
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Élèves {classId ? <span className="ml-2"><Badge>{total}</Badge></span> : null}
          </div>

          <div className="flex items-center gap-2">
            <Button
              tone="slate"
              onClick={() => { setAssignOpen(true); }}
              disabled={!classId || loading}
              title={classId ? "Ajouter / Transférer un élève dans cette classe" : "Choisissez une classe d’abord"}
            >
              Ajouter / Transférer
            </Button>

            <span className="text-xs text-slate-600">Par page :</span>
            <Select value={String(pageSize)} onChange={(e) => setPageSize(Number(e.target.value))} className="w-24">
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
            <div className="text-xs text-slate-600">Page {pageSafe} / {totalPages}</div>
            <Button tone="white" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageSafe <= 1}>← Préc.</Button>
            <Button tone="white" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={pageSafe >= totalPages}>Suiv. →</Button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !classId ? (
          <div className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-700">Choisissez d’abord une <b>classe</b>.</div>
        ) : pageItems.length === 0 ? (
          <div className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-700">Aucun élève pour cette page / ce filtre.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-3 py-2 text-left w-14">N°</th>
                  <th className="px-3 py-2 text-left">Nom & Prénoms</th>
                  <th className="px-3 py-2 text-left">Matricule</th>
                  <th className="px-3 py-2 text-left">Classe</th>
                  <th className="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((s, i) => {
                  const numero = startIdx + i + 1;
                  const zebra = i % 2 === 0 ? "bg-white" : "bg-slate-50";
                  return (
                    <tr key={s.id} className={`border-t ${zebra} hover:bg-slate-100`}>
                      <td className="px-3 py-2 tabular-nums">{numero}</td>
                      <td className="px-3 py-2">{nomAvantPrenoms(s.full_name)}</td>
                      <td className="px-3 py-2">{s.matricule || "—"}</td>
                      <td className="px-3 py-2">{s.class_label || "—"}</td>
                      <td className="px-3 py-2 flex gap-2">
                        <Button tone="white" onClick={() => openEdit(s)}>Modifier</Button>
                        <Button
                          tone="danger"
                          onClick={() => removeFromClass(s)}
                          disabled={!s.class_id || removingId === s.id}
                          title="Retirer l’élève de cette classe"
                        >
                          {removingId === s.id ? "Retrait…" : "Retirer"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {msg && (
          <div className="mt-3 text-sm text-slate-700" aria-live="polite">
            {msg}
          </div>
        )}
      </section>

      {/* Modal Modifier */}
      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold">Modifier l’élève</h3>
              <button onClick={() => setEditing(null)} className="text-slate-500 hover:text-slate-700">✕</button>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-slate-600">Prénom(s)</div>
                <Input value={editing.first_name} onChange={(e) => setEditing({ ...editing, first_name: e.target.value })} placeholder="Ex : ANGE" />
              </div>
              <div>
                <div className="mb-1 text-xs text-slate-600">Nom</div>
                <Input value={editing.last_name} onChange={(e) => setEditing({ ...editing, last_name: e.target.value })} placeholder="Ex : KOUASSI" />
              </div>
              <div className="md:col-span-2">
                <div className="mb-1 text-xs text-slate-600">Matricule</div>
                <Input
                  value={editing.matricule}
                  onChange={(e) => setEditing({ ...editing, matricule: e.target.value.toUpperCase() })}
                  placeholder="Ex : 20166309J"
                />
              </div>
            </div>
            <div className="mt-5 flex items-center gap-2">
              <Button onClick={saveEdit} disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</Button>
              <Button tone="white" onClick={() => setEditing(null)} disabled={saving}>Annuler</Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Ajouter / Transférer */}
      {assignOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold">Ajouter / Transférer un élève</h3>
              <button
                onClick={() => { setAssignOpen(false); resetAssign(); }}
                className="text-slate-500 hover:text-slate-700"
                aria-label="Fermer"
              >
                ✕
              </button>
            </div>

            <div className="mt-4">
              <div className="mb-3 grid grid-cols-2 gap-2">
                <Button tone={assignMode === "new" ? "emerald" : "white"} onClick={() => setAssignMode("new")}>➕ Nouvel élève</Button>
                <Button tone={assignMode === "transfer" ? "emerald" : "white"} onClick={() => setAssignMode("transfer")}>🔁 Transférer</Button>
              </div>

              {assignMode === "new" ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs text-slate-600">Nom</div>
                    <Input
                      value={form.new_last_name}
                      onChange={(e) => setForm((f) => ({ ...f, new_last_name: e.target.value.toUpperCase() }))}
                      placeholder="Ex : AMON"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-slate-600">Prénom(s)</div>
                    <Input
                      value={form.new_first_name}
                      onChange={(e) => setForm((f) => ({ ...f, new_first_name: e.target.value }))}
                      placeholder="Ex : ANGE ARISTIDE"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <div className="mb-1 text-xs text-slate-600">Matricule <span className="text-slate-400">(optionnel)</span></div>
                    <Input
                      value={form.new_matricule}
                      onChange={(e) => setForm((f) => ({ ...f, new_matricule: e.target.value.toUpperCase() }))}
                      placeholder="Ex : 20166309J"
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <div className="mb-1 text-xs text-slate-600">Par matricule (rapide)</div>
                      <Input
                        value={form.transfer_matricule}
                        onChange={(e) => setForm((f) => ({ ...f, transfer_matricule: e.target.value.toUpperCase() }))}
                        placeholder="Ex : 20166309J"
                      />
                    </div>
                    <div>
                      <div className="mb-1 text-xs text-slate-600">Ou rechercher par nom (autocomplete global)</div>
                      <Input
                        value={searchQ}
                        onChange={(e) => setSearchQ(e.target.value)}
                        placeholder="Ex : KOUASSI, TRAORE, N’GUESSAN… (min. 2 caractères)"
                      />
                      <div className="mt-2 max-h-56 overflow-auto rounded-xl border">
                        {searchBusy ? (
                          <div className="p-3 text-sm text-slate-600">Recherche…</div>
                        ) : searchItems.length === 0 ? (
                          <div className="p-3 text-sm text-slate-500">Aucun résultat</div>
                        ) : (
                          <ul className="divide-y">
                            {searchItems.map((it) => {
                              const ln = (it.last_name || "").toUpperCase();
                              const fn = (it.first_name || "").trim();
                              const nm = [ln, fn].filter(Boolean).join(" ");
                              return (
                                <li key={it.id} className="flex items-center justify-between gap-2 p-2 hover:bg-slate-50">
                                  <div className="min-w-0">
                                    <div className="truncate font-medium">{nm || "—"}</div>
                                    <div className="text-xs text-slate-500">
                                      {it.matricule ? `Matricule: ${it.matricule}` : "Sans matricule"}
                                      {it.class_label ? ` • Classe: ${it.class_label}` : ""}
                                    </div>
                                  </div>
                                  <Button tone="white" onClick={() => chooseStudent(it)}>Choisir</Button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>

                      {selectedStu && (
                        <div className="mt-2 text-xs text-emerald-700">
                          Sélectionné: {(selectedStu.last_name || "").toUpperCase()} {selectedStu.first_name || ""} {selectedStu.matricule ? `• ${selectedStu.matricule}` : "(sans matricule)"}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              <div className="mt-5 flex items-center gap-2">
                <Button onClick={submitAssign} disabled={assigning || !classId}>
                  {assigning ? "Traitement…" : assignMode === "new" ? "Ajouter dans la classe" : "Transférer vers la classe"}
                </Button>
                <Button tone="white" onClick={() => { setAssignOpen(false); resetAssign(); }} disabled={assigning}>
                  Annuler
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
