"use client";

import { useEffect, useMemo, useState } from "react";

function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={"w-full rounded-lg border px-3 py-2 text-sm " + (p.className ?? "")} />;
}
function Button(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} className={"rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm font-medium shadow " + (p.disabled ? "opacity-60" : "hover:bg-emerald-700 transition")} />;
}
function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={"w-full rounded-lg border bg-white px-3 py-2 text-sm " + (p.className ?? "")} />;
}

type ClassRow   = { id: string; name: string; level: string };
type StudentRow = { id: string; full_name: string; class_id: string | null; class_label: string | null };

export default function ParentsClient() {
  // CrÃ©ation parent
  const [pEmail, setPEmail] = useState("");
  const [pPhone, setPPhone] = useState("");
  const [pName,  setPName]  = useState("");
  const [creating, setCreating] = useState(false);
  const [msgCreate, setMsgCreate] = useState<string | null>(null);

  async function createParent() {
    setCreating(true); setMsgCreate(null);
    try {
      const r = await fetch("/api/admin/users/create", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "parent",
          email: pEmail.trim() || null,  // optionnel
          phone: pPhone.trim(),          // obligatoire
          display_name: pName.trim() || null,
        }),
      });
      const j = await r.json().catch(()=>({}));
      setCreating(false);
      if (!r.ok) { setMsgCreate(j?.error || "Ã‰chec"); return; }
      setMsgCreate("Parent crÃ©Ã©.");
      setPEmail(""); setPPhone(""); setPName("");
    } catch (e:any) { setCreating(false); setMsgCreate(e?.message || "Erreur rÃ©seau"); }
  }

  // DonnÃ©es classes + Ã©lÃ¨ves
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [level, setLevel] = useState<string>("");
  const [classId, setClassId] = useState<string>("");

  const levels = useMemo(
    () => Array.from(new Set(classes.map(c => c.level).filter(Boolean)))
      .sort((a,b)=>String(a).localeCompare(String(b), undefined, { numeric:true })),
    [classes]
  );
  const classesOfLevel = useMemo(
    () => classes.filter(c => !level || c.level === level),
    [classes, level]
  );
  const filteredStudents = useMemo(
    () => students.filter(s => !classId || s.class_id === classId),
    [students, classId]
  );

  useEffect(() => {
    (async () => {
      const [c, s] = await Promise.all([
        fetch("/api/admin/classes?limit=999", { cache:"no-store", credentials:"include" }).then(r=>r.json()),
        fetch("/api/admin/students?limit=2000", { cache:"no-store", credentials:"include" }).then(r=>r.json()),
      ]);
      setClasses(c.items || []);
      setStudents(s.items || []);
    })();
  }, []);

  // SÃ©lection multiple d'Ã©lÃ¨ves
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  function toggleStudent(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
  }
  function toggleAllVisible() {
    const visible = filteredStudents.map(s => s.id);
    const all = visible.every(id => selectedIds.includes(id));
    setSelectedIds(all ? selectedIds.filter(id => !visible.includes(id)) : Array.from(new Set([...selectedIds, ...visible])));
  }

  // Liaison parent â†” Ã©lÃ¨ves (tÃ©lÃ©phone prioritaire / email fallback) â€” VERSION BULK
  const [parentPhone, setParentPhone] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [linking, setLinking] = useState(false);
  const [msgLink, setMsgLink] = useState<string | null>(null);

  async function linkParentToStudents() {
    if (!selectedIds.length) return;
    if (!parentPhone.trim() && !parentEmail.trim()) { setMsgLink("Renseigne au moins le tÃ©lÃ©phone ou l'email du parent."); return; }

    setLinking(true); setMsgLink(null);
    try {
      const r = await fetch("/api/admin/associations", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "parent_students",
          student_ids: selectedIds,
          phone: parentPhone.trim() || null,
          email: parentEmail.trim() || null,
        }),
      });
      const j = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(j?.error || "Ã‰chec");

      setMsgLink(`Association rÃ©ussie pour ${j.linked ?? selectedIds.length} Ã©lÃ¨ve(s)`);
      setSelectedIds([]);
    } catch (e:any) {
      setMsgLink(e?.message || "Erreur");
    } finally { setLinking(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Parents</h1>
        <p className="text-slate-600">
          CrÃ©er un parent et lâ€™associer Ã  un ou plusieurs Ã©lÃ¨ves (par numÃ©ro). Un parent peut aussi Ãªtre enseignant avec le mÃªme numÃ©ro.
        </p>
      </div>

      {/* CrÃ©ation parent */}
      <div className="rounded-2xl border bg-white p-5">
        <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">CrÃ©er un parent</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div><div className="mb-1 text-xs text-slate-500">Nom affichÃ©</div><Input value={pName} onChange={e=>setPName(e.target.value)} placeholder="Mme/M. NOM" /></div>
          <div><div className="mb-1 text-xs text-slate-500">TÃ©lÃ©phone (obligatoire)</div><Input value={pPhone} onChange={e=>setPPhone(e.target.value)} placeholder="+225..." /></div>
          <div><div className="mb-1 text-xs text-slate-500">Email (optionnel)</div><Input type="email" value={pEmail} onChange={e=>setPEmail(e.target.value)} placeholder="parent@exemple.com" /></div>
        </div>
        <div className="mt-3">
          <Button onClick={createParent} disabled={creating || !pPhone.trim()}>{creating ? "CrÃ©ationâ€¦" : "CrÃ©er le parent"}</Button>
          {msgCreate && <span className="ml-3 text-sm text-slate-600">{msgCreate}</span>}
        </div>
      </div>

      {/* Association */}
      <div className="rounded-2xl border bg-white p-5">
        <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">Associer parent â†” Ã©lÃ¨ves</div>

        {/* Filtres */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 mb-3">
          <div>
            <div className="mb-1 text-xs text-slate-500">Niveau</div>
            <Select value={level} onChange={e=>{ setLevel(e.target.value); setClassId(""); setSelectedIds([]); }}>
              <option value="">â€” Tous les niveaux â€”</option>
              {levels.map(l => <option key={l} value={l}>{l}</option>)}
            </Select>
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-500">Classe</div>
            <Select value={classId} onChange={e=>{ setClassId(e.target.value); setSelectedIds([]); }}>
              <option value="">â€” Choisir â€”</option>
              {classesOfLevel.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div className="rounded-lg border bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <div className="font-medium mb-1">Parent Ã  associer</div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <Input placeholder="TÃ©lÃ©phone parent (prioritaire)" value={parentPhone} onChange={e=>setParentPhone(e.target.value)} />
              <Input placeholder="Email parent (optionnel)" value={parentEmail} onChange={e=>setParentEmail(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Ã‰lÃ¨ves */}
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">Ã‰lÃ¨ves de la classe</div>
          <button type="button" onClick={toggleAllVisible} className="text-xs text-emerald-700 underline-offset-2 hover:underline" disabled={!filteredStudents.length}>
            {filteredStudents.length && filteredStudents.every(s => selectedIds.includes(s.id)) ? "Tout dÃ©sÃ©lectionner" : "Tout sÃ©lectionner"}
          </button>
        </div>

        {!classId ? (
          <div className="text-sm text-slate-500">Choisis dâ€™abord une classe.</div>
        ) : filteredStudents.length === 0 ? (
          <div className="text-sm text-slate-500">Aucun Ã©lÃ¨ve.</div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {filteredStudents.map(s => (
              <label key={s.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <input type="checkbox" checked={selectedIds.includes(s.id)} onChange={()=>toggleStudent(s.id)} />
                <span className="font-medium">{s.full_name}</span>
              </label>
            ))}
          </div>
        )}

        <div className="mt-4">
          <Button onClick={linkParentToStudents} disabled={linking || selectedIds.length===0 || (!parentPhone.trim() && !parentEmail.trim())}>
            {linking ? "Associationâ€¦" : `Associer au parent (${selectedIds.length})`}
          </Button>
          {msgLink && <span className="ml-3 text-sm text-slate-600">{msgLink}</span>}
        </div>
      </div>
    </div>
  );
}
