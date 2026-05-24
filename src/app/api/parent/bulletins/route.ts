// src/app/api/parent/bulletins/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toDateValue(value: unknown) {
  const s = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function isExpired(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) && time <= Date.now();
}

export async function GET() {
  const srv = getSupabaseServiceClient();

  try {
    const jar = await cookies();
    const deviceId = jar.get("parent_device")?.value || "";
    if (!deviceId) return NextResponse.json({ ok: true, items: [] });

    const { data: links, error: linksErr } = await srv
      .from("parent_device_children")
      .select("student_id")
      .eq("device_id", deviceId);

    if (linksErr) return NextResponse.json({ ok: false, error: linksErr.message }, { status: 400 });

    const studentIds = Array.from(
      new Set((links || []).map((row: any) => String(row.student_id || "").trim()).filter(Boolean)),
    );

    if (!studentIds.length) return NextResponse.json({ ok: true, items: [] });

    const rows: any[] = [];
    for (const studentId of studentIds) {
      const { data, error } = await srv
        .from("bulletin_qr_codes")
        .select("code, payload, created_at, expires_at, revoked")
        .eq("revoked", false)
        .contains("payload", { studentId })
        .order("created_at", { ascending: false })
        .limit(12);

      if (error) {
        // La table QR peut ne pas encore exister sur certains environnements.
        console.warn("[parent.bulletins] bulletin_qr_codes indisponible", error.message);
        continue;
      }
      rows.push(...(data || []));
    }

    const seen = new Set<string>();
    const items = rows
      .filter((row) => row?.code && !isExpired(row?.expires_at))
      .map((row) => {
        const payload = row.payload || {};
        return {
          code: String(row.code),
          url: `/v/${encodeURIComponent(String(row.code))}`,
          student_id: String(payload.studentId || ""),
          class_id: payload.classId || null,
          academic_year: payload.academicYear || null,
          period_label: payload.periodShortLabel || payload.periodLabel || "Bulletin",
          period_from: toDateValue(payload.periodFrom || payload.from || payload.period_from),
          period_to: toDateValue(payload.periodTo || payload.to || payload.period_to),
          created_at: row.created_at || null,
        };
      })
      .filter((item) => {
        if (!item.student_id || seen.has(item.code)) return false;
        seen.add(item.code);
        return true;
      })
      .sort((a, b) => {
        const ad = a.period_to || a.created_at || "";
        const bd = b.period_to || b.created_at || "";
        return bd.localeCompare(ad);
      });

    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
