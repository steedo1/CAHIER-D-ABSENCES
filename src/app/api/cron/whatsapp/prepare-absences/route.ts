// src/app/api/cron/whatsapp/prepare-absences/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { normalizePhone } from "@/lib/phone";

function assertCronAuth(req: Request) {
  const key = process.env.CRON_SECRET || "";
  const h   = req.headers.get("x-cron-key") || "";
  if (!key || h !== key) throw Object.assign(new Error("forbidden"), { status: 403 });
}
const isoDateOnly = (d: Date) => d.toISOString().slice(0,10); // YYYY-MM-DD (UTC)

export async function POST(req: Request) {
  try { assertCronAuth(req); } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: e.status || 403 });
  }

  const srv = getSupabaseServiceClient();
  const body = await req.json().catch(() => ({}));
  const digestDate: string = (body?.date && String(body.date).slice(0,10)) || isoDateOnly(new Date());
  const instFilter: string | null = body?.institution_id || null;

  const dayStart = `${digestDate}T00:00:00Z`;
  const nextDay  = new Date(Date.parse(digestDate) + 24*3600*1000);
  const dayEnd   = `${isoDateOnly(nextDay)}T00:00:00Z`;

  // 1) Absences du jour
  const { data: marks, error: mErr } = await srv
    .from("v_mark_minutes")
    .select("student_id, subject_name, started_at, institution_id, student_name, class_label, status")
    .eq("status", "absent")
    .gte("started_at", dayStart)
    .lt("started_at",  dayEnd)
    .order("started_at", { ascending: true });

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 400 });
  if (!marks?.length) return NextResponse.json({ ok: true, prepared: 0, note: "no_absences" });

  const dayMarks = instFilter ? marks.filter(x => x.institution_id === instFilter) : marks;

  // Grouper par élève
  type S = {
    student_id: string;
    institution_id: string;
    student_name?: string | null;
    class_label?: string | null;
    slots: Array<{ time: string; subject: string }>;
  };
  const byStudent = new Map<string, S>();
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

  // Liens parents + profils
  const studentIds = Array.from(byStudent.keys());
  const { data: links } = await srv
    .from("student_guardians")
    .select("student_id, parent_id, notifications_enabled")
    .in("student_id", studentIds);

  const parentIds = Array.from(new Set((links || []).map(l => l.parent_id)));
  const { data: parentProfiles } = await srv
    .from("profiles")
    .select("id, phone, display_name, whatsapp_opt_in, institution_id")
    .in("id", parentIds);

  const { data: studentProfiles } = await srv
    .from("profiles")
    .select("id, phone, display_name, whatsapp_opt_in")
    .in("id", studentIds);

  const parentProfileById = new Map((parentProfiles || []).map(p => [p.id as string, p]));
  const studentProfileById = new Map((studentProfiles || []).map(p => [p.id as string, p]));

  const fmtStudentDigest = (s: S, dateStr: string) => {
    const lines = s.slots.map(sl => `• ${sl.time} — ${sl.subject}`).join("\n");
    const head  = s.student_name ? `${s.student_name} — ${s.class_label || ""}`.trim() : "Absences";
    return (
`Absences du ${dateStr}
${head}

${lines}

Si vous constatez une erreur, contactez la vie scolaire.`).trim();
  };

  const byParent = new Map<string, Map<string, S>>();
  for (const l of (links || [])) {
    if (l.notifications_enabled === false) continue;
    const s = byStudent.get(l.student_id as string);
    if (!s) continue;
    if (!byParent.has(l.parent_id as string)) byParent.set(l.parent_id as string, new Map());
    byParent.get(l.parent_id as string)!.set(s.student_id, s);
  }

  const fmtParentDigest = (children: Map<string, S>, dateStr: string) => {
    const blocks: string[] = [];
    for (const s of children.values()) {
      const header = `${s.student_name || "Élève"}${s.class_label ? ` (${s.class_label})` : ""}`;
      const lines  = s.slots.map(sl => `   • ${sl.time} — ${sl.subject}`).join("\n");
      blocks.push(`${header}\n${lines}`);
    }
    return (
`Absences du ${dateStr}

${blocks.join("\n\n")}

Message automatique — Merci de ne pas répondre.`).trim();
  };

  // 4) Outbox
  let prepared = 0;

  // Élèves (optionnel si profil élève)
  for (const s of byStudent.values()) {
    const prof = studentProfileById.get(s.student_id);
    const phone = normalizePhone(prof?.phone ?? null);
    if (!phone || !prof?.whatsapp_opt_in) continue;

    const { error: upErr } = await srv
      .from("whatsapp_outbox")
      .upsert({
        institution_id: s.institution_id,
        digest_date: digestDate,
        kind: "student",
        student_id: s.student_id,
        to_phone_e164: phone,
        body: fmtStudentDigest(s, digestDate),
        status: "pending",
      }, { onConflict: "digest_date,student_id" });

    if (!upErr) prepared++;
  }

  // Parents (prioritaire)
  for (const [pid, children] of byParent.entries()) {
    const prof = parentProfileById.get(pid);
    const phone = normalizePhone(prof?.phone ?? null);
    if (!phone || !prof?.whatsapp_opt_in) continue;

    const instId = (prof?.institution_id as string) || Array.from(children.values())[0]?.institution_id;

    const { error: upErr } = await srv
      .from("whatsapp_outbox")
      .upsert({
        institution_id: instId,
        digest_date: digestDate,
        kind: "parent",
        parent_id: pid,
        to_phone_e164: phone,
        body: fmtParentDigest(children, digestDate),
        status: "pending",
      }, { onConflict: "digest_date,parent_id" });

    if (!upErr) prepared++;
  }

  return NextResponse.json({ ok: true, prepared, date: digestDate });
}
