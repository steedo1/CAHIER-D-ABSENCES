// src/app/api/cron/whatsapp/prepare-absences/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
// import { normalizePhone } from "@/lib/phone"; // [WHATSAPP OFF] non utilisé

// ─────────────────────────────────────────
// Auth Cron (header x-cron-key)
// ─────────────────────────────────────────
function assertCronAuth(req: Request) {
  const key = (process.env.CRON_SECRET || "").trim();
  const h   = (req.headers.get("x-cron-key") || "").trim();
  if (!key || h !== key) throw Object.assign(new Error("forbidden"), { status: 403 });
}

// YYYY-MM-DD en UTC
const isoDateOnly = (d: Date) => d.toISOString().slice(0, 10);

// ─────────────────────────────────────────
// POST /api/cron/whatsapp/prepare-absences
// (WhatsApp neutralisé : aucune écriture / envoi)
// ─────────────────────────────────────────
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // 0) Auth
  try { assertCronAuth(req); }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: e.status || 403 }); }

  const srv = getSupabaseServiceClient();
  const body = await req.json().catch(() => ({} as any));

  const digestDate: string =
    (body?.date && String(body.date).slice(0, 10)) || isoDateOnly(new Date());
  const instFilter: string | null = body?.institution_id || null;

  const dayStart = `${digestDate}T00:00:00Z`;
  const nextDay  = new Date(Date.parse(digestDate) + 24 * 3600 * 1000);
  const dayEnd   = `${isoDateOnly(nextDay)}T00:00:00Z`;

  // 1) Absences du jour (vue minute)
  const { data: marks, error: mErr } = await srv
    .from("v_mark_minutes")
    .select("student_id, subject_name, started_at, institution_id, student_name, class_label, status")
    .eq("status", "absent")
    .gte("started_at", dayStart)
    .lt("started_at", dayEnd)
    .order("started_at", { ascending: true });

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 400 });
  if (!marks?.length) {
    return NextResponse.json({ ok: true, prepared: 0, note: "no_absences", date: digestDate });
  }

  const dayMarks = instFilter ? marks.filter(x => x.institution_id === instFilter) : marks;

  // 2) Groupage par élève (pour debug/aperçu)
  type Slot = { time: string; subject: string };
  type StudentDigest = {
    student_id: string;
    institution_id: string;
    student_name?: string | null;
    class_label?: string | null;
    slots: Slot[];
  };

  const byStudent = new Map<string, StudentDigest>();
  for (const r of dayMarks) {
    const k = r.student_id as string;
    if (!byStudent.has(k)) {
      byStudent.set(k, {
        student_id: k,
        institution_id: r.institution_id as string,
        student_name: (r as any).student_name || null,
        class_label: (r as any).class_label || null,
        slots: [],
      });
    }
    byStudent.get(k)!.slots.push({
      time: new Date(r.started_at as string).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      subject: (r.subject_name as string) || "—",
    });
  }

  // 3) (WHATSAPP OFF) Tout ce qui suit est neutralisé.
  //    - Récupération parents/élèves pour téléphones
  //    - Formatage des messages agrégés
  //    - UPSERT dans whatsapp_outbox
  //
  // const studentIds = Array.from(byStudent.keys());
  // const { data: links } = await srv
  //   .from("student_guardians")
  //   .select("student_id, parent_id, notifications_enabled")
  //   .in("student_id", studentIds);
  //
  // const parentIds = Array.from(new Set((links || []).map(l => l.parent_id)));
  // const { data: parentProfiles } = await srv
  //   .from("profiles")
  //   .select("id, phone, display_name, whatsapp_opt_in, institution_id")
  //   .in("id", parentIds);
  //
  // const { data: studentProfiles } = await srv
  //   .from("profiles")
  //   .select("id, phone, display_name, whatsapp_opt_in")
  //   .in("id", studentIds);
  //
  // function fmtStudentDigest(s: StudentDigest, dateStr: string) { /* … */ }
  // function fmtParentDigest(children: Map<string, StudentDigest>, dateStr: string) { /* … */ }
  //
  // let prepared = 0;
  // // UPSERT whatsapp_outbox … (supprimé)

  // 4) Réponse neutre (aucun envoi ni écriture)
  //    On renvoie un petit aperçu utile au besoin (limité) pour vérifier la collecte.
  const preview = Array.from(byStudent.values()).slice(0, 10).map(s => ({
    student_id: s.student_id,
    student_name: s.student_name,
    class_label: s.class_label,
    slots: s.slots,
  }));

  return NextResponse.json({
    ok: true,
    prepared: 0,              // rien n'est préparé/écrit
    date: digestDate,
    total_absences: dayMarks.length,
    unique_students: byStudent.size,
    // simple aperçu (max 10 élèves) pour debug
    preview,
    note: "WhatsApp disabled: no outbox writes, no messages.",
  });
}
