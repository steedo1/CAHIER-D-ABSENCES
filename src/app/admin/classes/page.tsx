// src/app/admin/classes/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

/* ─────────────────────────────
   Types
───────────────────────────── */
type ClassRow = { id: string; name: string; level: string; class_phone_e164?: string | null };

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
  disabled,
}: {
  title: string;
  onClick: () => void;
  children: any;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={
        "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium border " +
        (disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-slate-50")
      }
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
  const [format, setFormat] = useState<"none" | "numeric" | "alpha">("numeric");
  const [count, setCount] = useState<number>(5);
  const [preview, setPreview] = useState<string[]>([]);

  // Liste
  const [items, setItems] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Drafts de numéros (édition rapide par carte)
  const [phoneDraft, setPhoneDraft] = useState<Record<string, string>>({});
  const [savingPhoneId, setSavingPhoneId] = useState<string | null>(null);
  const [msgPhone, setMsgPhone] = useState<string | null>(null);

  // Accordéon des groupes
  const [openLevel, setOpenLevel] = useState<string | null>(null);

  // Édition (modal)
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [eLabel, setELabel] = useState("");
  const [eLevel, setELevel] = useState("");
  const [ePhone, setEPhone] = useState(""); // numéro optionnel
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
      p.push(level);
    } else {
      for (let i = 1; i <= count; i++) {
        p.push(format === "numeric" ? `${level}${i}` : `${level}${String.fromCharCode(64 + i)}`);
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
      const rows: ClassRow[] = (j.items || []).map((x: any) => {
        // compat : accepte class_phone_e164 OU (ancien) device_phone_e164
        const phone = x.class_phone_e164 ?? x.device_phone_e164 ?? null;
        return { id: x.id, name: x.name, level: x.level, class_phone_e164: phone };
      });
      setItems(rows);
      // initialise les drafts à partir de la donnée
      const init: Record<string, string> = {};
      for (const it of rows) init[it.id] = it.class_phone_e164 ?? "";
      setPhoneDraft(init);
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    const r = await fetch("/api/admin/classes/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level, format, count }),
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
    setOpenLevel(level);
    setMsgPhone("Classes créées. Vous pouvez maintenant attribuer un numéro à chaque classe depuis la liste.");
    setTimeout(() => setMsgPhone(null), 3000);
  }

  // Groupage des classes par niveau
  const grouped = useMemo(() => {
    const m = new Map<string, ClassRow[]>();
    for (const c of items) {
      if (!m.has(c.level)) m.set(c.level, []);
      m.get(c.level)!.push(c);
    }
    for (const [k, arr] of m) {
      arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      m.set(k, arr);
    }
    return m;
  }, [items]);

  useEffect(() => {
    setOpenLevel(level);
  }, [level]);

  function openEdit(row: ClassRow) {
    setEditId(row.id);
    setELabel(row.name);
    setELevel(row.level);
    setEPhone(row.class_phone_e164 ?? "");
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editId) return;
    setSaving(true);
    setMsgPhone(null);
    // ✅ l’API PATCH attend `class_phone`, pas `class_phone_e164`
    const body: any = { label: eLabel, level: eLevel, class_phone: ePhone.trim() || null };
    const r = await fetch(`/api/admin/classes/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (r.status === 401) {
      setAuthErr(true);
      return;
    }
    if (!r.ok) {
      const t = await r.json().catch(() => ({}));
      if (r.status === 409) {
        alert("Ce numéro est déjà utilisé par une autre classe de votre établissement.");
      } else if (r.status === 400) {
        alert("Numéro invalide. Saisissez un local ou un international : il sera normalisé.");
      } else {
        alert("Échec de mise à jour" + (t?.error ? ` : ${t.error}` : ""));
      }
      return;
    }
    setEditOpen(false);
    setEditId(null);
    await refresh();
    setMsgPhone("Classe mise à jour.");
    setTimeout(() => setMsgPhone(null), 2000);
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

  // Éditeur rapide du téléphone par carte
  function setDraft(id: string, v: string) {
    setPhoneDraft((m) => ({ ...m, [id]: v }));
  }
  async function savePhone(id: string) {
    setSavingPhoneId(id);
    setMsgPhone(null);
    // ✅ envoie `class_phone` (UI accepte local ou international)
    const body: any = { class_phone: (phoneDraft[id] || "").trim() || null };
    const r = await fetch(`/api/admin/classes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSavingPhoneId(null);
    if (r.status === 401) {
      setAuthErr(true);
      return;
    }
    if (!r.ok) {
      const t = await r.json().catch(() => ({}));
      if (r.status === 409) {
        alert("Ce numéro est déjà utilisé par une autre classe de votre établissement.");
      } else if (r.status === 400) {
        alert("Numéro invalide. Saisissez un local ou un international : il sera normalisé.");
      } else {
        alert("Échec de mise à jour" + (t?.error ? ` : ${t.error}` : ""));
      }
      return;
    }
    await refresh();
    setMsgPhone("Numéro enregistré.");
    setTimeout(() => setMsgPhone(null), 1500);
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
        <p className="text-slate-600">
          Créer, éditer et supprimer des classes de l’établissement. Vous pouvez aussi <b>attribuer un numéro de
          téléphone</b> (optionnel) par classe.
        </p>
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
            <Input
              type="number"
              min={1}
              max={30}
              value={count}
              disabled={format === "none"}
              onChange={(e) => setCount(parseInt(e.target.value || "1", 10))}
            />
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
                      {arr.map((c) => {
                        const draft = phoneDraft[c.id] ?? c.class_phone_e164 ?? "";
                        const unchanged = (draft || "") === (c.class_phone_e164 || "");
                        return (
                          <div key={c.id} className="rounded-xl border p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-medium truncate">{c.name}</div>
                                <div className="text-xs text-slate-500">Niveau : {c.level}</div>
                                <div className="mt-2 text-xs text-slate-600">
                                  <span className="inline-block min-w-[140px] font-medium">Téléphone (optionnel)</span>
                                </div>
                                <div className="mt-1 flex items-center gap-2">
                                  <Input
                                    placeholder="+2250701020304"
                                    value={draft}
                                    onChange={(e) => setDraft(c.id, e.target.value)}
                                    className="w-56"
                                  />
                                  <IconButton
                                    title="Enregistrer le numéro"
                                    onClick={() => savePhone(c.id)}
                                    disabled={savingPhoneId === c.id || unchanged}
                                  >
                                    {savingPhoneId === c.id ? (
                                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25"></circle>
                                        <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4"></path>
                                      </svg>
                                    ) : (
                                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                        <path d="M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-8 2.5 5-5L15.5 9 9 15.5 5.5 12 7 10.5l2 2Z" />
                                      </svg>
                                    )}
                                    Enregistrer
                                  </IconButton>
                                </div>
                                <div className="mt-1 text-[11px] text-slate-500">
                                  Saisissez un <i>numéro local</i> (ex: 07…) <b>ou</b> international (ex: +225…).
                                  Il sera <b>normalisé automatiquement</b>.
                                </div>
                              </div>
                              <div className="flex items-start gap-2">
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
                            {c.class_phone_e164 && (
                              <div className="mt-2 text-xs text-emerald-700">
                                Numéro en vigueur : <b>{c.class_phone_e164}</b>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
        )}
        {msgPhone && <div className="mt-2 text-sm text-slate-700" aria-live="polite">{msgPhone}</div>}
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
          <div>
            <div className="mb-1 text-xs text-slate-500">Téléphone de la classe (optionnel)</div>
            <Input
              value={ePhone}
              onChange={(e) => setEPhone(e.target.value)}
              placeholder="+2250701020304"
              inputMode="tel"
              autoComplete="tel"
            />
            <div className="mt-1 text-[11px] text-slate-500">
              Saisissez un <i>numéro local</i> (ex: 07…) <b>ou</b> international (ex: +225…). Il sera normalisé automatiquement.
            </div>
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
