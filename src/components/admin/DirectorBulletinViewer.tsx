"use client";

import { useEffect, useState } from "react";
import type { SchoolCycle, TeachingTrack } from "@/lib/school-cycles";
import SpecializedBulletinPanel from "@/components/bulletins/SpecializedBulletinPanel";
import type { SpecializedBulletinPayload } from "@/lib/server/specialized-bulletin";

type ClassOption = { id: string; label: string; cycle: SchoolCycle };
type Period = { id: string; code: string; label: string; start_date: string; end_date: string };
type Payload = { ok?: boolean; error?: string; message?: string;
  items?: Period[]; specialized?: SpecializedBulletinPayload };

export default function DirectorBulletinViewer({ classes, year, track }: {
  classes: ClassOption[]; year: string; track: TeachingTrack;
}) {
  const [classId,setClassId]=useState(classes[0]?.id || "");
  const [periodId,setPeriodId]=useState("");
  const [periods,setPeriods]=useState<Period[]>([]);
  const [payload,setPayload]=useState<SpecializedBulletinPayload | null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const current=classes.find(row=>row.id===classId);

  useEffect(()=>{
    setPeriodId("");setPayload(null);setPeriods([]);setError("");
    if(!current||!year)return;
    let active=true;
    const controller=new AbortController();
    const qs=new URLSearchParams({academic_year:year,cycle:current.cycle,track});
    void fetch(`/api/admin/school-grading-periods?${qs}`,{cache:"no-store",signal:controller.signal})
      .then(async response=>{
        const data=await response.json() as Payload;
        if(!response.ok||!data.ok)throw new Error(data.error||"Périodes indisponibles.");
        if(active)setPeriods((data.items||[]).filter(row=>row.id));
      }).catch(err=>{if(active&&!controller.signal.aborted)setError(
        err instanceof Error?err.message:"Périodes indisponibles.");});
    return ()=>{active=false;controller.abort();};
  },[classId,current?.cycle,track,year]);

  async function viewBulletins() {
    if(!current||!periodId||loading)return;
    setError("");setPayload(null);setLoading(true);
    try{
      const qs=new URLSearchParams({class_id:current.id,period_id:periodId});
      const response=await fetch(`/api/direction-enseignement/bulletins?${qs}`,{cache:"no-store"});
      const data=await response.json() as Payload;
      if(!response.ok||!data.ok||!data.specialized)
        throw new Error(data.message||data.error||"Les bulletins ne sont pas disponibles.");
      setPayload(data.specialized);
    }catch(err){setError(err instanceof Error?err.message:"Bulletins indisponibles.");}
    finally{setLoading(false);}
  }
  return <div className="space-y-5">
    <a href="/direction-enseignement" className="text-sm font-semibold text-emerald-800 underline">← Retour à la direction</a>
    <div className="rounded-xl border bg-white p-5">
      <h1 className="text-xl font-bold">Bulletins de l'enseignement {track==="arabic"?"arabe":"français"}</h1>
      <p className="mt-1 text-sm text-slate-600">
        Année {year}. Les modèles restent indépendants. La direction ne peut
        générer que les bulletins des classes et périodes de son enseignement.
      </p>
      {!classes.length?<p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm">
        Aucune classe attribuée exclusivement à cet enseignement.
      </p>:<div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm">
          Classe
          <select className="rounded-lg border p-2" value={classId}
            onChange={event=>{setClassId(event.target.value);setPayload(null);}}>
            {classes.map(row=><option key={row.id} value={row.id}>{row.label}</option>)}
          </select>
        </label>
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm">
          Période d'évaluation
          <select className="rounded-lg border p-2" value={periodId}
            onChange={event=>{setPeriodId(event.target.value);setPayload(null);}}>
            <option value="">Choisir la période</option>
            {periods.map(row=><option key={row.id} value={row.id}>{row.label||row.code}
              {row.start_date?` (${row.start_date} – ${row.end_date})`:""}</option>)}
          </select>
        </label>
        <button type="button" disabled={!periodId||loading}
          className="rounded-lg bg-emerald-700 px-4 py-2.5 font-semibold text-white disabled:opacity-40"
          onClick={()=>void viewBulletins()}>{loading?"Chargement…":"Afficher les bulletins"}</button>
      </div>}
      {!periods.length&&classes.length>0&&<p className="mt-3 text-sm text-amber-800">
        Aucune période spécialisée disponible pour cette classe.
        Configurez d'abord les périodes dans l'espace de direction.
      </p>}
      {error&&<p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
    </div>
    {payload&&<SpecializedBulletinPanel data={payload}
      onBack={()=>setPayload(null)}
      onPrint={async()=>{window.print();}}/>}
  </div>;
}
