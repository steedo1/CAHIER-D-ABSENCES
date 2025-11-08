// src/app/admin/parents/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

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
    white:
      "bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-white/90 active:bg-slate-50",
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
};

/* ───────── Page Component ───────── */
export default function AdminStudentsByClassPage() {
  // Data
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);

  // Filters
  const [level, setLevel] = useState<string>("");
  const [classId, setClassId] = useState<string>("");
  const [q, setQ] = useState("");

  // UX
  const [loading, setLoading] = useState(true);
  const [authErr, setAuthErr] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Edit modal
  const [editing, setEditing] = useState<null | {
    id: string;
    first_name: string;
    last_name: string;
    matricule: string;
  }>(null);
  const [saving, setSaving] = useState(false);

  // Fetch data
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

  // Derived
  const levels = useMemo(
    () => Array.from(new Set(classes.map((c) => c.level).filter(Boolean))).sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { numeric: true })
    ),
    [classes]
  );
  const classesOfLevel = useMemo(
    () => classes.filter((c) => !level || c.level === level),
    [classes, level]
  );

  const studentsOfClass = useMemo(() => {
    let list = students;
    if (classId) list = list.filter((s) => s.class_id === classId);
    if (q.trim()) {
      const k = q.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.full_name.toLowerCase().includes(k) ||
          (s.matricule ?? "").toLowerCase().includes(k)
      );
    }
    return list.sort((a, b) => a.full_name.localeCompare(b.full_name, undefined, { sensitivity: "base" }));
  }, [students, classId, q]);

  // Open modal with split names
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

      // rafraîchir local
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

  if (authErr) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="text-sm text-slate-700">
            Votre session a expiré.{" "}
            <a className="text-emerald-700 underline" href="/login">Se reconnecter</a>
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
        <div className="relative z-10">
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Liste des élèves par classe</h1>
          <p className="mt-1 text-white/80 text-sm">
            Sélectionnez un <b>niveau</b>, choisissez la <b>classe</b> puis modifiez un élève.
          </p>
        </div>
      </header>

      {/* Filtres */}
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
                <option key={l} value={l}>{l}</option>
              ))}
            </Select>
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-600">Classe</div>
            <Select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
            >
              <option value="">— Choisir —</option>
              {classesOfLevel.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.label || c.id}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-600">Recherche (nom ou matricule)</div>
            <Input
              placeholder="Ex : KOFFI / 20166309J"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Tableau */}
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Élèves {classId ? <span className="ml-2"><Badge>{studentsOfClass.length}</Badge></span> : null}
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !classId ? (
          <div className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-700">
            Choisissez d’abord une <b>classe</b>.
          </div>
        ) : studentsOfClass.length === 0 ? (
          <div className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-700">
            Aucun élève pour cette classe.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left">Nom & Prénoms</th>
                  <th className="px-3 py-2 text-left">Matricule</th>
                  <th className="px-3 py-2 text-left">Classe</th>
                  <th className="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white/60">
                {studentsOfClass.map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className="px-3 py-2">{s.full_name || "—"}</td>
                    <td className="px-3 py-2">{s.matricule || "—"}</td>
                    <td className="px-3 py-2">{s.class_label || "—"}</td>
                    <td className="px-3 py-2">
                      <Button tone="white" onClick={() => openEdit(s)}>Modifier</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {msg && <div className="mt-3 text-sm text-slate-700" aria-live="polite">{msg}</div>}
      </section>

      {/* Modal d'édition */}
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
                <Input
                  value={editing.first_name}
                  onChange={(e) => setEditing({ ...editing, first_name: e.target.value })}
                  placeholder="Ex : KOFFI"
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-slate-600">Nom</div>
                <Input
                  value={editing.last_name}
                  onChange={(e) => setEditing({ ...editing, last_name: e.target.value })}
                  placeholder="Ex : Kouadio"
                />
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
              <Button onClick={saveEdit} disabled={saving}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </Button>
              <Button tone="white" onClick={() => setEditing(null)} disabled={saving}>
                Annuler
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
