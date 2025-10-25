// src/app/admin/classes/page.tsx (ou le bon chemin)
"use client";

import { useEffect, useMemo, useState } from "react";

/* ─────────────────────────────
   Types
───────────────────────────── */
type ClassRow = { id: string; name: string; level: string };

/* ─────────────────────────────
   UI helpers
───────────────────────────── */
function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={"w-full rounded-lg border px-3 py-2 text-sm " + (p.className ?? "")} />;
}
function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={"w-full rounded-lg border bg-white px-3 py-2 text-sm " + (p.className ?? "")} />;
}
function Button(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={
        "rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm font-medium shadow " +
        (p.disabled ? "opacity-60" : "hover:bg-emerald-700 transition")
      }
    />
  );
}
function IconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: any;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium border hover:bg-slate-50"
    >
      {children}
    </button>
  );
}
function Modal({
  open,
  title,
  children,
  onClose,
  actions,
}: {
  open: boolean;
  title: string;
  children: any;
  onClose: () => void;
  actions?: any;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm font-semibold">{title}</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">
            ×
          </button>
        </div>
        <div className="p-4">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">{actions}</div>
      </div>
    </div>
  );
}

/* ─────────────────────────────
   Page
───────────────────────────── */
export default function ClassesPage() {
  // Génération
  const [level, setLevel] = useState("6e");
  const [format, setFormat] = useState<"none" | "numeric" | "alpha">("numeric"); // ← ajoute "none"
  const [count, setCount] = useState<number>(5);
  const [preview, setPreview] = useState<string[]>([]);

  // Liste
  const [items, setItems] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Accordéon des groupes
  const [openLevel, setOpenLevel] = useState<string | null>(null);

  // Édition
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [eLabel, setELabel] = useState("");
  const [eLevel, setELevel] = useState("");
  const [saving, setSaving] = useState(false);

  // Suppression
  const [delOpen, setDelOpen] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Auth
  const [authErr, setAuthErr] = useState(false);

  useEffect(() => {
    refresh();
  }, []);

  // Si on choisit "Aucun suffixe", on force count=1 (évite CM21)
  useEffect(() => {
    if (format === "none") setCount(1);
  }, [format]);

  // Prévisualisation
  function genPreview() {
    if (!level || count < 1) return setPreview([]);
    const p: string[] = [];
    if (format === "none") {
      p.push(level); // ex: "CM2"
    } else {
      for (let i = 1; i <= count; i++) {
        p.push(format === "numeric" ? `${level}${i}` : `${level}${String.fromCharCode(64 + i)}`); // A=65
      }
    }
    setPreview(p);
  }
  useEffect(genPreview, [level, format, count]);

  async function refresh() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/classes?limit=200", { cache: "no-store" });
      if (r.status === 401) {
        setAuthErr(true);
        setItems([]);
        return;
      }
      const j = await r.json().catch(() => ({}));
      setItems(j.items || []);
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    const r = await fetch("/api/admin/classes/bulk", {
      method: "POST",
      headers: new Headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ level, format, count }), // "none" possible
    });
    if (r.status === 401) {
      setAuthErr(true);
      return;
    }
    if (!r.ok) {
      const t = await r.json().catch(() => ({}));
      alert("Échec de création" + (t?.error ? ` : ${t.error}` : ""));
      return;
    }
    await refresh();
    // Après création, on ouvre le groupe du niveau courant
    setOpenLevel(level);
  }

  // Groupage des classes par niveau
  const grouped = useMemo(() => {
    const m = new Map<string, ClassRow[]>();
    for (const c of items) {
      if (!m.has(c.level)) m.set(c.level, []);
      m.get(c.level)!.push(c);
    }
    // tri simple par libellé
    for (const [k, arr] of m) {
      arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      m.set(k, arr);
    }
    return m;
  }, [items]);

  // Quand le niveau saisi change, on affiche par défaut ce groupe
  useEffect(() => {
    setOpenLevel(level);
  }, [level]);

  function openEdit(row: ClassRow) {
    setEditId(row.id);
    setELabel(row.name);
    setELevel(row.level);
    setEditOpen(true);
  }
  async function saveEdit() {
    if (!editId) return;
    setSaving(true);
    const r = await fetch(`/api/admin/classes/${editId}`, {
      method: "PATCH",
      headers: new Headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ label: eLabel, level: eLevel }),
    });
    setSaving(false);
    if (r.status === 401) {
      setAuthErr(true);
      return;
    }
    if (!r.ok) {
      const t = await r.json().catch(() => ({}));
      if (r.status === 409) {
        alert("Ce libellé existe déjà pour votre établissement.");
      } else {
        alert("Échec de mise à jour" + (t?.error ? ` : ${t.error}` : ""));
      }
      return;
    }
    setEditOpen(false);
    setEditId(null);
    await refresh();
  }

  function openDelete(row: ClassRow) {
    setDelId(row.id);
    setDelOpen(true);
  }
  async function confirmDelete() {
    if (!delId) return;
    setDeleting(true);
    const r = await fetch(`/api/admin/classes/${delId}`, { method: "DELETE" });
    setDeleting(false);
    if (r.status === 401) {
      setAuthErr(true);
      return;
    }
    if (!r.ok) {
      const t = await r.json().catch(() => ({}));
      alert("Échec de suppression" + (t?.error ? ` : ${t.error}` : ""));
      return;
    }
    setDelOpen(false);
    setDelId(null);
    await refresh();
  }

  if (authErr) {
    return (
      <div className="rounded-xl border bg-white p-5">
        <div className="text-sm text-slate-700">
          Votre session a expiré.{" "}
          <a className="text-emerald-700 underline" href="/login">
            Se reconnecter
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Classes</h1>
        <p className="text-slate-600">Créer, éditer et supprimer des classes de l’établissement.</p>
      </div>

      {/* Génération rapide */}
      <div className="rounded-2xl border bg-white p-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <div className="mb-1 text-xs text-slate-500">Niveau</div>
            <Input value={level} onChange={(e) => setLevel(e.target.value)} placeholder="CM2 / 6e / 5e / 2nde ..." />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-500">Format</div>
            <Select value={format} onChange={(e) => setFormat(e.target.value as any)}>
              <option value="none">Aucun suffixe</option>
              <option value="numeric">Numérique (1,2,3…)</option>
              <option value="alpha">Alphanumérique (A,B,C…)</option>
            </Select>
            {format === "none" && (
              <div className="mt-1 text-[11px] text-slate-500">
                Avec « Aucun suffixe », <b>Nombre = 1</b> pour créer exactement « {level} ».
              </div>
            )}
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-500">Nombre</div>
            <Input type="number" min={1} max={30} value={count} disabled={format === "none"} onChange={(e) => setCount(parseInt(e.target.value || "1", 10))} />
          </div>
          <div className="flex items-end">
            <Button onClick={create}>Créer</Button>
          </div>
        </div>
        {preview.length > 0 && (
          <div className="mt-4 text-sm text-slate-700">
            <b>Prévisualisation :</b> {preview.join(", ")}
          </div>
        )}
      </div>

      {/* Liste groupée par niveau (accordéon) */}
      <div className="rounded-2xl border bg-white p-5">
        <div className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">Liste des classes</div>

        {loading ? (
          <div className="text-sm text-slate-500">Chargement…</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-slate-500">Aucune classe.</div>
        ) : (
          Array.from(grouped.keys())
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .map((lvl) => {
              const arr = grouped.get(lvl)!;
              const opened = openLevel === lvl;
              return (
                <div key={lvl} className="mb-3 overflow-hidden rounded-xl border">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between bg-slate-50 px-4 py-2 text-left hover:bg-slate-100"
                    onClick={() => setOpenLevel(opened ? null : lvl)}
                    aria-expanded={opened}
                  >
                    <span className="font-medium">{lvl}</span>
                    <span className="text-xs text-slate-500">{arr.length} classe(s)</span>
                  </button>

                  {opened && (
                    <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2">
                      {arr.map((c) => (
                        <div key={c.id} className="rounded-xl border p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-medium">{c.name}</div>
                              <div className="text-xs text-slate-500">Niveau : {c.level}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <IconButton title="Éditer" onClick={() => openEdit(c)}>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                  <path d="M17.414 2.586a2 2 0 0 0-2.828 0L6 11.172V14h2.828l8.586-8.586a2 2 0 0 0 0-2.828z" />
                                  <path fillRule="evenodd" d="M4 16a2 2 0 0 0 2 2h8a1 1 0 1 0 0-2H6a1 1 0 0 1-1-1V5a1 1 0 1 0-2 0v10z" />
                                </svg>
                                Éditer
                              </IconButton>
                              <IconButton title="Supprimer" onClick={() => openDelete(c)}>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                  <path d="M6 7a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0V8a1 1 0 0 1 1-1zm4 0a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0V8a1 1 0 0 1 1-1zm5-3h-3.5l-1-1h-3l-1 1H2v2h16V4z" />
                                </svg>
                                Supprimer
                              </IconButton>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
        )}
      </div>

      {/* Modal Édition */}
      <Modal
        open={editOpen}
        title="Éditer la classe"
        onClose={() => setEditOpen(false)}
        actions={
          <>
            <button onClick={() => setEditOpen(false)} className="rounded-lg border px-3 py-1.5 text-sm">
              Annuler
            </button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3">
          <div>
            <div className="mb-1 text-xs text-slate-500">Libellé</div>
            <Input value={eLabel} onChange={(e) => setELabel(e.target.value)} placeholder="ex: CM2" />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-500">Niveau</div>
            <Input value={eLevel} onChange={(e) => setELevel(e.target.value)} placeholder="ex: CM2 / 6e / 2nde" />
          </div>
        </div>
      </Modal>

      {/* Modal Suppression */}
      <Modal
        open={delOpen}
        title="Supprimer la classe"
        onClose={() => setDelOpen(false)}
        actions={
          <>
            <button onClick={() => setDelOpen(false)} className="rounded-lg border px-3 py-1.5 text-sm">
              Annuler
            </button>
            <button
              onClick={confirmDelete}
              disabled={deleting}
              className={
                "rounded-xl bg-red-600 text-white px-4 py-2 text-sm font-medium shadow " +
                (deleting ? "opacity-60" : "hover:bg-red-700 transition")
              }
            >
              {deleting ? "Suppression…" : "Supprimer"}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-700">Cette action est définitive. Confirmer la suppression ?</p>
      </Modal>
    </div>
  );
}
