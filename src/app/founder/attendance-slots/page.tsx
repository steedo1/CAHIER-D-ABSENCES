// src/app/founder/attendance-slots/page.tsx
import { redirect } from "next/navigation";
import { AlertTriangle, CalendarDays, CheckCircle2, Clock3, School2 } from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type QueryResult<T> = { data: T | null; error: { message?: string } | null };

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

async function safeData<T>(label: string, query: PromiseLike<QueryResult<T>>, fallback: T): Promise<T> {
  try {
    const res = await query;
    if (res?.error) {
      console.warn(`[founder/attendance-slots] ${label}:`, res.error.message || res.error);
      return fallback;
    }
    return (res?.data ?? fallback) as T;
  } catch (e: any) {
    console.warn(`[founder/attendance-slots] ${label}:`, e?.message || e);
    return fallback;
  }
}

function formatPeriod(row: any) {
  const label = String(row?.label || "Créneau").trim();
  const start = String(row?.start_time || "").slice(0, 5);
  const end = String(row?.end_time || "").slice(0, 5);
  if (start && end) return `${label} • ${start}–${end}`;
  return label;
}

export default async function FounderAttendanceSlotsPage() {
  const supabase = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const roles = await safeData<any[]>(
    "user_roles",
    service.from("user_roles").select("institution_id").eq("profile_id", user.id).eq("role", "founder"),
    [],
  );

  const institutionIds: string[] = Array.from(
    new Set((roles ?? []).map((row: any) => String(row.institution_id || "")).filter(Boolean)),
  );

  if (!institutionIds.length) redirect("/profile");

  const today = todayYmd();
  const startIso = `${today}T00:00:00.000Z`;
  const endIso = `${today}T23:59:59.999Z`;

  const [institutions, periods, sessions] = await Promise.all([
    safeData<any[]>(
      "institutions",
      service.from("institutions").select("id,name").in("id", institutionIds).order("name"),
      [],
    ),
    safeData<any[]>(
      "institution_periods",
      service
        .from("institution_periods")
        .select("id,institution_id,label,start_time,end_time,weekday,is_active")
        .in("institution_id", institutionIds)
        .eq("is_active", true),
      [],
    ),
    safeData<any[]>(
      "teacher_sessions",
      service
        .from("teacher_sessions")
        .select("id,institution_id,started_at,ended_at")
        .in("institution_id", institutionIds)
        .gte("started_at", startIso)
        .lte("started_at", endIso),
      [],
    ),
  ]);

  const rows = (institutions ?? []).map((school: any) => {
    const schoolPeriods = (periods ?? []).filter((row: any) => row.institution_id === school.id);
    const schoolSessions = (sessions ?? []).filter((row: any) => row.institution_id === school.id);
    const opened = schoolSessions.filter((row: any) => !row.ended_at).length;
    const ended = schoolSessions.filter((row: any) => !!row.ended_at).length;
    return { school, periods: schoolPeriods, sessions: schoolSessions, opened, ended };
  });

  const totalPeriods = periods.length;
  const totalSessions = sessions.length;
  const openedSessions = rows.reduce((sum, row) => sum + row.opened, 0);

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-700">Vue créneau fondateur</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
          Contrôle global des créneaux
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600 sm:text-base">
          Suivi consolidé des créneaux configurés et des appels détectés dans les écoles rattachées.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-[28px] border border-sky-100 bg-sky-50 p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-sky-700">
            <Clock3 className="h-4 w-4" /> Créneaux actifs
          </div>
          <div className="mt-3 text-3xl font-black text-sky-900">{totalPeriods}</div>
          <p className="mt-1 text-xs font-semibold text-sky-800">Paramétrés dans les écoles suivies</p>
        </div>

        <div className="rounded-[28px] border border-emerald-100 bg-emerald-50 p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
            <CalendarDays className="h-4 w-4" /> Appels du jour
          </div>
          <div className="mt-3 text-3xl font-black text-emerald-900">{totalSessions}</div>
          <p className="mt-1 text-xs font-semibold text-emerald-800">Séances détectées aujourd’hui</p>
        </div>

        <div className="rounded-[28px] border border-amber-100 bg-amber-50 p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-amber-700">
            <AlertTriangle className="h-4 w-4" /> En cours
          </div>
          <div className="mt-3 text-3xl font-black text-amber-900">{openedSessions}</div>
          <p className="mt-1 text-xs font-semibold text-amber-800">Sessions ouvertes non terminées</p>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {rows.length === 0 ? (
          <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-800">
            Aucune école rattachée trouvée pour ce compte fondateur.
          </div>
        ) : (
          rows.map(({ school, periods, sessions, opened, ended }) => (
            <div key={school.id} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 font-black text-slate-950">
                    <School2 className="h-4 w-4 text-slate-500" />
                    {school.name || "Établissement"}
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-500">{school.id}</div>
                </div>
                <div className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
                  {today}
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-sky-700">
                    <Clock3 className="h-4 w-4" /> Créneaux
                  </div>
                  <div className="mt-2 text-2xl font-black text-sky-800">{periods.length}</div>
                </div>

                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-emerald-700">
                    <CalendarDays className="h-4 w-4" /> Appels
                  </div>
                  <div className="mt-2 text-2xl font-black text-emerald-800">{sessions.length}</div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                    <CheckCircle2 className="h-4 w-4" /> Terminés
                  </div>
                  <div className="mt-2 text-2xl font-black text-slate-950">{ended}</div>
                  <div className="mt-1 text-xs text-slate-500">{opened} encore ouvert(s)</div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                  Créneaux configurés
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {periods.length === 0 ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
                      Aucun créneau actif configuré
                    </span>
                  ) : (
                    periods.slice(0, 8).map((period: any) => (
                      <span key={period.id} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600">
                        {formatPeriod(period)}
                      </span>
                    ))
                  )}
                  {periods.length > 8 ? (
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-400">
                      +{periods.length - 8} autre(s)
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
