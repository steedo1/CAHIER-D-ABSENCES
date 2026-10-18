import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireTeachingDirector } from "@/lib/auth/teaching-director";
import { loadTeachingDirectorWorkspace } from "@/lib/server/school-director-workspace";
import { readStudentProgramSettings } from "@/lib/school-student-programs";
import DirectorBulletinViewer from "@/components/admin/DirectorBulletinViewer";

export const dynamic="force-dynamic";

export default async function TeachingDirectorBulletins() {
  const client=await getSupabaseServerClient();
  const service=getSupabaseServiceClient();
  const access=await requireTeachingDirector(client,service);
  if(!access.ok){
    if(access.status===401)redirect("/login");
    return <main className="mx-auto max-w-3xl p-8" role="alert">Accès aux bulletins refusé.</main>;
  }
  const [workspace,school]=await Promise.all([
    loadTeachingDirectorWorkspace(service,access.principal).catch(()=>null),
    service.from("institutions").select("settings_json")
      .eq("id",access.principal.institutionId).maybeSingle(),
  ]);
  if(!workspace||school.error||!school.data)return <main className="p-8">
    La liste des classes n'est pas disponible pour le moment.
  </main>;
  const policies=readStudentProgramSettings(school.data.settings_json)
    .years[workspace.year]?.classes||{};
  const classes=workspace.classes.filter(c=>
    policies[c.id]?.tracks.length===1&&
    policies[c.id].tracks[0]===access.principal.teachingTrack)
    .map(c=>({id:c.id,label:c.label,cycle:c.cycle}));
  return <main className="mx-auto max-w-6xl p-4 sm:p-8">
    <DirectorBulletinViewer year={workspace.year}
      track={access.principal.teachingTrack} classes={classes}/>
  </main>;
}
