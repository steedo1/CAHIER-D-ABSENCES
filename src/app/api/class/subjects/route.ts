// src/app/api/class/subjects/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SubjectItem = {
  id: string; // institution_subjects.id
  label: string;
};

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set((arr || []).filter(Boolean))) as T[];
}

type PhoneVariants = { variants: string[]; likePatterns: string[] };

function buildPhoneVariants(raw: string): PhoneVariants {
  const t = String(raw || "").trim();
  const digits = t.replace(/\D/g, "");
  const local10 = digits ? digits.slice(-10) : "";
  const localNo0 = local10.replace(/^0/, "");
  const cc = "225";

  const variants = uniq<string>([
    t,
    t.replace(/\s+/g, ""),
    digits,
    `+${digits}`,
    `+${cc}${local10}`,
    `+${cc}${localNo0}`,
    `00${cc}${local10}`,
    `00${cc}${localNo0}`,
    `${cc}${local10}`,
    `${cc}${localNo0}`,
    local10,
    localNo0 ? `0${localNo0}` : "",
  ]);

  const likePatterns = uniq<string>([
    local10 ? `%${local10}%` : "",
    local10 ? `%${cc}${local10}%` : "",
    local10 ? `%+${cc}${local10}%` : "",
    local10 ? `%00${cc}${local10}%` : "",
  ]);

  return { variants, likePatterns };
}

function hmsToMin(hms: string | null | undefined) {
  const s = String(hms || "00:00:00").slice(0, 8);
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function hmInTZ(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function weekdayInTZ0to6(d: Date, tz: string): number {
  const w = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  })
    .format(d)
    .toLowerCase();

  const map: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };

  return map[w] ?? 0;
}

export async function GET(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();

    const {
      data: { user },
    } = await supa.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const class_id = (new URL(req.url).searchParams.get("class_id") ?? "").trim();
    if (!class_id) {
      return NextResponse.json({ items: [] as SubjectItem[] });
    }

    let phone = String((user as any).phone || "").trim();
    if (!phone) {
      const { data: au } = await srv
        .schema("auth")
        .from("users")
        .select("phone")
        .eq("id", user.id)
        .maybeSingle();
      phone = String(au?.phone || "").trim();
    }

    if (!phone) {
      return NextResponse.json({ error: "no_phone" }, { status: 404 });
    }

    const { variants, likePatterns } = buildPhoneVariants(phone);

    const { data: cls, error: clsErr } = await srv
      .from("classes")
      .select("id,label,institution_id,class_phone_e164")
      .eq("id", class_id)
      .maybeSingle();

    if (clsErr) {
      return NextResponse.json({ error: clsErr.message }, { status: 400 });
    }
    if (!cls) {
      return NextResponse.json({ items: [] as SubjectItem[] });
    }

    let match = false;
    if (cls.class_phone_e164 && variants.includes(String(cls.class_phone_e164))) match = true;
    if (!match && likePatterns.length) {
      const stored = String(cls.class_phone_e164 || "");
      match = likePatterns.some((p) => {
        const pat = String(p).replace(/%/g, ".*");
        try {
          return new RegExp(pat).test(stored);
        } catch {
          return false;
        }
      });
    }

    if (!match) {
      return NextResponse.json({ error: "forbidden_not_class_device" }, { status: 403 });
    }

    const { data: inst, error: instErr } = await srv
      .from("institutions")
      .select("id,tz")
      .eq("id", cls.institution_id)
      .maybeSingle();

    if (instErr) {
      return NextResponse.json({ error: instErr.message }, { status: 400 });
    }

    const tz = String(inst?.tz || "Africa/Abidjan");
    const now = new Date();
    const weekday = weekdayInTZ0to6(now, tz);
    const nowMin = hmsToMin(`${hmInTZ(now, tz)}:00`);

    const { data: periods, error: pErr } = await srv
      .from("institution_periods")
      .select("id,start_time,end_time")
      .eq("institution_id", cls.institution_id)
      .eq("weekday", weekday)
      .order("period_no", { ascending: true });

    if (pErr) {
      return NextResponse.json({ error: pErr.message }, { status: 400 });
    }

    const active = ((periods || []) as any[]).find((p) => {
      const startMin = hmsToMin(p?.start_time);
      const endMin = hmsToMin(p?.end_time);
      return nowMin >= startMin && nowMin < endMin;
    });

    if (!active?.id) {
      return NextResponse.json({ items: [] as SubjectItem[] });
    }

    const { data: ttRows, error: ttErr } = await srv
      .from("teacher_timetables")
      .select("subject_id")
      .eq("institution_id", cls.institution_id)
      .eq("class_id", class_id)
      .eq("period_id", String(active.id));

    if (ttErr) {
      return NextResponse.json({ error: ttErr.message }, { status: 400 });
    }

    const subjectIds = uniq<string>(
      ((ttRows || []) as any[]).map((r) => String(r.subject_id || "")).filter(Boolean)
    );

    if (!subjectIds.length) {
      return NextResponse.json({ items: [] as SubjectItem[] });
    }

    const { data: instSubs, error: subjErr } = await srv
      .from("institution_subjects")
      .select("id,custom_name,subjects:subject_id(name)")
      .in("id", subjectIds);

    if (subjErr) {
      return NextResponse.json({ error: subjErr.message }, { status: 400 });
    }

    const items = ((instSubs || []) as any[])
      .map((row) => ({
        id: String(row.id),
        label: String(row.custom_name || row.subjects?.name || "—").trim(),
      }))
      .filter((it) => it.id.length > 0)
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));

    return NextResponse.json({ items });
  } catch (err: any) {
    console.error("[class.subjects] unexpected error", err);
    return NextResponse.json({ error: err?.message || "class_subjects_failed" }, { status: 500 });
  }
}
