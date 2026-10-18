"use client";
import { useEffect, useMemo, useState } from "react";

type ClassRow={id:string;label:string};
type Subject={id:string;subjectId:string;name:string};
type Candidate={teacherId:string;subjectId:string;name:string};
type Assignment={id:string;teacher_id:string;subject_id:string;teacherName:string};
type Response={ok?:boolean;error?:string;subjects?:Subject[];candidates?:Candidate[];assignments?:Assignment[]};
const endpoint="/api/direction-enseignement/teacher-services";

export default function DirectorTeacherServices({classes}:{classes:ClassRow[]}) {
  const [classId,setClassId]=useState(classes[0]?.id||"");
  const [subjects,setSubjects]=useState<Subject[]>([]);
  const [candidates,setCandidates]=useState<Candidate[]>([]);
  const [assignments,setAssignments]=useState<Assignment[]>([]);
  const [subjectId,setSubjectId]=useState("");
  const [teacherId,setTeacherId]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const chosen=subjects.find(x=>x.id===subjectId);
  const eligible=useMemo(()=>candidates.filter(x=>x.subjectId===chosen?.subjectId),
    [candidates,chosen?.subjectId]);
  useEffect(()=>{
    setTeacherId("");
  },[subjectId]);
  async function refresh(id=classId) {
    setError("");
    if(!id)return;
    const res=await fetch(endpoint+"?class_id="+encodeURIComponent(id),{cache:"no-store"});
    const body=await res.json() as Response;
    if(!res.ok||!body.ok)throw new Error(body.error||"Services indisponibles.");
    setSubjects(body.subjects||[]);
    setCandidates(body.candidates||[]);
    setAssignments(body.assignments||[]);
    if(!(body.subjects||[]).some(x=>x.id===subjectId))setSubjectId("");
  }
  useEffect(()=>{
    setSubjects([]);setCandidates([]);setAssignments([]);
    let active=true;
    if(!classId)return;
    const controller=new AbortController();
    fetch(endpoint+"?class_id="+encodeURIComponent(classId),
      {cache:"no-store",signal:controller.signal})
      .then(async res=>{
        const body=await res.json() as Response;
        if(!res.ok||!body.ok)throw new Error(body.error||"Services indisponibles.");
        if(!active)return;
        setSubjects(body.subjects||[]);setCandidates(body.candidates||[]);
        setAssignments(body.assignments||[]);setSubjectId("");setTeacherId("");
      }).catch(e=>{if(active&&!controller.signal.aborted)setError(
        e instanceof Error?e.message:"Chargement impossible");});
    return ()=>{active=false;controller.abort();};
  },[classId]);
  async function assign() {
    if(!classId||!subjectId||!teacherId||busy)return;
    setBusy(true);setError("");setNotice("");
    try{
      const res=await fetch(endpoint,{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({classId,teacherId,institutionSubjectId:subjectId}),
      });
      const body=await res.json() as Response;
      if(!res.ok||!body.ok)throw new Error(body.error||"Affectation impossible");
      await refresh();
      setNotice("Enseignant affecté à cette discipline.");
    }catch(e){setError(e instanceof Error?e.message:"Affectation impossible");}
    finally{setBusy(false);}
  }
  async function close(id:string) {
    if(busy||!window.confirm("Mettre fin à cette affectation ?"))return;
    setBusy(true);setError("");setNotice("");
    try{
      const res=await fetch(endpoint,{
        method:"PATCH",headers:{"content-type":"application/json"},
        body:JSON.stringify({classId,assignmentId:id}),
      });
      const body=await res.json() as Response;
      if(!res.ok||!body.ok)throw new Error(body.error||"Clôture impossible");
      await refresh();
      setNotice("Affectation terminée, historique conservé.");
    }catch(e){setError(e instanceof Error?e.message:"Clôture impossible");}
    finally{setBusy(false);}
  }
  return <section className="rounded-2xl border bg-white p-5 space-y-4">
    <h2 className="text-xl font-bold">Services des enseignants — mon enseignement</h2>
    <p className="text-sm text-slate-600">
      Affectez un enseignant déjà rattaché à une discipline, sans intervenir sur la paie.
      Les classes et matières de l'autre enseignement ne sont pas accessibles.
    </p>
    <label className="block text-sm">Classe
      <select className="mt-1 w-full rounded-lg border p-2" value={classId}
        onChange={e=>{setClassId(e.target.value);setError("");setNotice("");}}>
        {classes.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
    </label>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Discipline
        <select className="mt-1 w-full rounded-lg border p-2" value={subjectId}
          onChange={e=>setSubjectId(e.target.value)}>
          <option value="">Choisir une discipline</option>
          {subjects.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label className="text-sm">Enseignant habilité
        <select className="mt-1 w-full rounded-lg border p-2" value={teacherId}
          onChange={e=>setTeacherId(e.target.value)}>
          <option value="">Choisir l'enseignant</option>
          {eligible.map(x=><option key={x.teacherId} value={x.teacherId}>{x.name}</option>)}
        </select>
      </label>
    </div>
    <button type="button" onClick={()=>void assign()} disabled={busy||!teacherId||!subjectId}
      className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-40">
      Affecter l'enseignant
    </button>
    <div className="space-y-2">
      <h3 className="font-semibold">Affectations en cours ({assignments.length})</h3>
      {assignments.map(a=><div key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm">
        <span>{a.teacherName} — {subjects.find(s=>s.id===a.subject_id)?.name||"Discipline"}</span>
        <button type="button" onClick={()=>void close(a.id)} disabled={busy}
          className="rounded-lg border border-amber-400 px-3 py-1.5 text-amber-900">
          Terminer
        </button>
      </div>)}
      {!assignments.length&&<p className="text-sm text-slate-500">Aucun service actif dans cette classe.</p>}
    </div>
    {error&&<p role="alert" className="text-sm text-red-800">{error}</p>}
    {notice&&<p role="status" className="text-sm text-emerald-800">{notice}</p>}
  </section>;
}
