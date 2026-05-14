// src/app/founder/attendance-slots/page.tsx
import { redirect } from "next/navigation";
import { CalendarDays, Clock3 } from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

export default async function FounderAttendanceSlotsPage() {
  const supabase = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: roles } = await service
    .from("user_roles")
    .select("institution_id")
    .eq("profile_id", user.id)
    .eq("role", "founder");

  const institutionIds: string[] = Array.from(
    new Set((roles ?? []).map((row: any) => String(row.institution_id || "")).filter(Boolean)),
  );

  if (!institutionIds.length) redirect("/(errors)/forbidden");

  const today = todayYmd();

  const [{ data: institutions }, { data: periods }, { data: sessions }] = await Promise.all([
    service.from("institutions").select("id,name,code_unique").in("id", institutionIds).order("name"),
    service.from("institution_periods").select("id,institution_id,label,start_time,end_time,weekday,is_active").in("institution_id", institutionIds).eq("is_active", true),
    service
      .from("teacher_sessions")
      .select("id,institution_id,started_at,ended_at")
      .in("institution_id", institutionIds)
      .gte("started_at", `${today}T00:00:00.000Z`)
      .lte("started_at", `${today}T23:59:59.999Z`),
  ]);

  const rows = (institutions ?? []).map((school: any) => {
    const p = (periods ?? []).filter((row: any) => row.institution_id === school.id);
    const s = (sessions ?? []).filter((row: any) => row.institution_id === school.id);
    return { school, periods: p, sessions: s };
  });

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-700">Vue créneau fondateur</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Contrôle global des créneaux</h1>
        <p className="mt-2 text-sm text-slate-600">Première vue consolidée : créneaux actifs configurés et appels détectés aujourd’hui.</p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {rows.map(({ school, periods, sessions }) => (
          <div key={school.id} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="font-black text-slate-950">{school.name || "Établissement"}</div>
            <div className="mt-1 text-xs text-slate-500">{school.code_unique || school.id}</div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-sky-700">
                  <Clock3 className="h-4 w-4" /> Créneaux actifs
                </div>
                <div className="mt-2 text-2xl font-black text-sky-800">{periods.length}</div>
              </div>

              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-emerald-700">
                  <CalendarDays className="h-4 w-4" /> Appels du jour
                </div>
                <div className="mt-2 text-2xl font-black text-emerald-800">{sessions.length}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
