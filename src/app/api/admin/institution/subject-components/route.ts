import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role =
  | "super_admin"
  | "admin"
  | "educator"
  | "teacher"
  | "parent"
  | string;

type GuardOk = {
  user: { id: string };
  instId: string;
};
type GuardErr = { error: "unauthorized" | "no_institution" | "forbidden" };

type SubjectComponentRow = {
  id: string;
  subject_id: string;
  subject_name: string;
  level: string | null; // niveau (6e, 5e, 3e, ...)
  code: string;
  label: string;
  short_label: string | null;
  coeff_in_subject: number; // utilisé par les écrans de saisie
  coeff: number; // alias pratique pour l'admin (même valeur)
  order_index: number;
  is_active: boolean;
};

type IncomingComponent = {
  id?: string | null; // ignoré, on remplace tout
  code?: string | null;
  label?: string | null;
  short_label?: string | null;
  coeff_in_subject?: number | string | null;
  order_index?: number | null;
  is_active?: boolean | null;
};

const OFFICIAL_TRACK_CODES = [
  "6eme",
  "5eme",
  "4eme",
  "3eme",
  "2ndeA",
  "2ndeC",
  "1ereA1",
  "1ereA2",
  "1ereC",
  "1ereD",
  "tleA1",
  "tleA2",
  "tleC",
  "tleD",
] as const;

type OfficialTrackCode = (typeof OFFICIAL_TRACK_CODES)[number];

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function isOfficialTrackCode(value: string): value is OfficialTrackCode {
  return (OFFICIAL_TRACK_CODES as readonly string[]).includes(value);
}

function normalizeOfficialTrackCode(value: unknown): OfficialTrackCode | null {
  const raw = String(value ?? "").trim();
  if (isOfficialTrackCode(raw)) return raw;

  const normalized = normalizeText(raw);
  const exactByNormalized: Record<string, OfficialTrackCode> = {
    "6EME": "6eme",
    "6E": "6eme",
    SIXIEME: "6eme",
    "5EME": "5eme",
    "5E": "5eme",
    CINQUIEME: "5eme",
    "4EME": "4eme",
    "4E": "4eme",
    QUATRIEME: "4eme",
    "3EME": "3eme",
    "3E": "3eme",
    TROISIEME: "3eme",
    "2NDEA": "2ndeA",
    SECONDEA: "2ndeA",
    "2A": "2ndeA",
    "2NDEC": "2ndeC",
    SECONDEC: "2ndeC",
    "2C": "2ndeC",
    "1EREA1": "1ereA1",
    PREMIEREA1: "1ereA1",
    "1EREA2": "1ereA2",
    PREMIEREA2: "1ereA2",
    "1EREC": "1ereC",
    PREMIEREC: "1ereC",
    "1C": "1ereC",
    "1ERED": "1ereD",
    PREMIERED: "1ereD",
    "1D": "1ereD",
    TLEA1: "tleA1",
    TERMINALEA1: "tleA1",
    TLEA2: "tleA2",
    TERMINALEA2: "tleA2",
    TLEC: "tleC",
    TERMINALEC: "tleC",
    TC: "tleC",
    TLED: "tleD",
    TERMINALED: "tleD",
    TD: "tleD",
  };

  if (exactByNormalized[normalized]) return exactByNormalized[normalized];

  if (/^6/.test(normalized)) return "6eme";
  if (/^5/.test(normalized)) return "5eme";
  if (/^4/.test(normalized)) return "4eme";
  if (/^3/.test(normalized)) return "3eme";
  if (/^(2NDEA|2A|SECONDEA)/.test(normalized)) return "2ndeA";
  if (/^(2NDEC|2C|SECONDEC)/.test(normalized)) return "2ndeC";
  if (/^(1D|1ERED|PREMIERED)/.test(normalized)) return "1ereD";
  if (/^(1C|1EREC|PREMIEREC)/.test(normalized)) return "1ereC";
  if (/^(1A|1EREA|PREMIEREA)/.test(normalized)) return "1ereA2";
  if (/^(TLED|TD|TERMINALED)/.test(normalized)) return "tleD";
  if (/^(TLEC|TC|TERMINALEC)/.test(normalized)) return "tleC";
  if (/^(TLEA|TA|TERMINALEA)/.test(normalized)) return "tleA2";

  return null;
}

function canonicalLevel(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return normalizeOfficialTrackCode(raw) || raw;
}

function equivalentLegacyLevels(level: string | null) {
  if (!level) return [];
  const out = new Set<string>([level]);
  switch (level) {
    case "6eme":
      out.add("6e");
      out.add("6ème");
      break;
    case "5eme":
      out.add("5e");
      out.add("5ème");
      break;
    case "4eme":
      out.add("4e");
      out.add("4ème");
      break;
    case "3eme":
      out.add("3e");
      out.add("3ème");
      break;
    case "2ndeA":
      out.add("2A");
      out.add("2nde A");
      out.add("Seconde A");
      break;
    case "2ndeC":
      out.add("2C");
      out.add("2nde C");
      out.add("Seconde C");
      break;
    case "1ereA2":
      out.add("1A");
      out.add("1ère A");
      out.add("Première A");
      break;
    case "1ereC":
      out.add("1C");
      out.add("1ère C");
      out.add("Première C");
      break;
    case "1ereD":
      out.add("1D");
      out.add("1ère D");
      out.add("Première D");
      break;
    case "tleA2":
      out.add("TA");
      out.add("Tle A");
      out.add("Terminale A");
      break;
    case "tleC":
      out.add("TC");
      out.add("Tle C");
      out.add("Terminale C");
      break;
    case "tleD":
      out.add("TD");
      out.add("Tle D");
      out.add("Terminale D");
      break;
  }
  return Array.from(out);
}

/* ───────── Helper auth admin ───────── */

async function guard(
  supa: SupabaseClient,
  srv: SupabaseClient,
): Promise<GuardOk | GuardErr> {
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return { error: "unauthorized" };

  const { data: prof } = await supa
    .from("profiles")
    .select("id, role, institution_id")
    .eq("id", user.id)
    .maybeSingle();

  let instId: string | null = (prof?.institution_id as string) || null;
  let roleProfile: Role = (prof?.role as Role) ?? "";

  let roleFromUR: Role | null = null;
  if (!instId || !["admin", "super_admin", "file_correspondent"].includes(roleProfile)) {
    const { data: urRows } = await srv
      .from("user_roles")
      .select("role,institution_id")
      .eq("profile_id", user.id);

    const adminRow = (urRows || []).find((r: any) =>
      ["admin", "super_admin", "file_correspondent"].includes(String(r.role || "")),
    );
    if (adminRow) {
      roleFromUR = adminRow.role as Role;
      if (!instId && adminRow.institution_id) {
        instId = String(adminRow.institution_id);
      }
    }
  }

  const isAdmin =
    ["admin", "super_admin", "file_correspondent"].includes(roleProfile) ||
    ["admin", "super_admin", "file_correspondent"].includes(String(roleFromUR || ""));

  if (!instId) return { error: "no_institution" };
  if (!isAdmin) return { error: "forbidden" };

  return { user: { id: user.id }, instId };
}

function error(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

/* ───────── GET : liste des sous-matières ───────── */

export async function GET(req: NextRequest) {
  const supa = (await getSupabaseServerClient()) as unknown as SupabaseClient;
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;

  const g = await guard(supa, srv);
  if ("error" in g) {
    const status =
      g.error === "unauthorized" ? 401 : g.error === "forbidden" ? 403 : 400;
    return error(g.error, status);
  }

  const url = new URL(req.url);
  const subjectIdFilter = (url.searchParams.get("subject_id") || "").trim();
  const levelFilter = (url.searchParams.get("level") || "").trim(); // niveau

  let query = srv
    .from("grade_subject_components")
    .select(
      "id,subject_id,code,label,short_label,coeff_in_subject,order_index,is_active,level,subjects(name)",
    )
    .eq("institution_id", g.instId)
    .order("subject_id", { ascending: true })
    .order("order_index", { ascending: true });

  if (subjectIdFilter) {
    query = query.eq("subject_id", subjectIdFilter);
  }
  if (levelFilter) {
    query = query.eq("level", levelFilter);
  }

  const { data, error: dbErr } = await query;

  if (dbErr) {
    return error(dbErr.message, 400);
  }

  const canonicalFilter = canonicalLevel(levelFilter);

  const byKey = new Map<string, { item: SubjectComponentRow; score: number }>();

  (data || []).forEach((row: any) => {
    const rawLevel = row.level ? String(row.level) : null;
    const level = canonicalLevel(rawLevel);

    if (canonicalFilter && level !== canonicalFilter) return;

    const coeff = Number(row.coeff_in_subject ?? 1);
    const code = String(row.code || "");
    const label = String(row.label || "");
    const item: SubjectComponentRow = {
      id: String(row.id),
      subject_id: String(row.subject_id),
      subject_name: row.subjects?.name ? String(row.subjects.name) : "Matière",
      level,
      code,
      label,
      short_label: row.short_label ? String(row.short_label) : null,
      coeff_in_subject: coeff,
      coeff, // alias pour l’admin (même valeur)
      order_index: Number(row.order_index ?? 1),
      is_active: row.is_active !== false,
    };

    const key = [
      item.subject_id,
      item.level || "",
      normalizeText(item.code || item.label),
    ].join("__");
    const score = rawLevel && rawLevel === item.level ? 2 : 1;
    const existing = byKey.get(key);
    if (!existing || score >= existing.score) {
      byKey.set(key, { item, score });
    }
  });

  const items = Array.from(byKey.values())
    .map((entry) => entry.item)
    .sort((a, b) => {
      const subj = a.subject_name.localeCompare(b.subject_name, "fr", {
        sensitivity: "base",
      });
      if (subj !== 0) return subj;
      const lvl = String(a.level || "").localeCompare(
        String(b.level || ""),
        "fr",
        {
          numeric: true,
          sensitivity: "base",
        },
      );
      if (lvl !== 0) return lvl;
      return Number(a.order_index || 0) - Number(b.order_index || 0);
    });

  return NextResponse.json({ ok: true, items });
}

/* ───────── PUT : remplace les sous-matières d’un sujet/niveau ───────── */

export async function PUT(req: NextRequest) {
  const supa = (await getSupabaseServerClient()) as unknown as SupabaseClient;
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;

  const g = await guard(supa, srv);
  if ("error" in g) {
    const status =
      g.error === "unauthorized" ? 401 : g.error === "forbidden" ? 403 : 400;
    return error(g.error, status);
  }

  const body = (await req.json().catch(() => ({}))) as {
    subject_id?: string;
    level?: string | null; // niveau
    items?: IncomingComponent[];
  };

  const subject_id = (body.subject_id || "").trim();
  if (!subject_id) {
    return error("Champ 'subject_id' obligatoire dans le body.", 400);
  }

  const rawLevel = (body.level ?? "").trim() || null;
  const level = rawLevel ? canonicalLevel(rawLevel) : null; // "" → null = global

  const rawItems = Array.isArray(body.items) ? body.items : [];
  // On autorise de tout supprimer pour ce sujet/niveau
  if (rawItems.length === 0) {
    let delQuery = srv
      .from("grade_subject_components")
      .delete()
      .eq("institution_id", g.instId)
      .eq("subject_id", subject_id);

    if (level === null) {
      delQuery = delQuery.is("level", null);
    } else {
      delQuery = delQuery.in("level", equivalentLegacyLevels(level));
    }

    const { error: delErr } = await delQuery;
    if (delErr) return error(delErr.message, 400);

    return NextResponse.json({
      ok: true,
      subject_id,
      level,
      inserted: 0,
    });
  }

  const normalized = rawItems
    .map((raw, idx) => {
      const label = (raw.label || "").trim();
      if (!label) return null;

      const codeBase = (raw.code || "").trim();
      const code =
        codeBase || `c${idx + 1}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");

      const short_label = (raw.short_label || label).trim();

      const ordRaw = Number(raw.order_index ?? idx + 1);
      const order_index =
        Number.isFinite(ordRaw) && ordRaw > 0 ? ordRaw : idx + 1;

      let coeff = 1;
      if (typeof raw.coeff_in_subject === "number") {
        coeff =
          Number.isFinite(raw.coeff_in_subject) && raw.coeff_in_subject >= 0
            ? raw.coeff_in_subject
            : 1;
      } else if (
        typeof raw.coeff_in_subject === "string" &&
        raw.coeff_in_subject.trim() !== ""
      ) {
        const parsed = parseFloat(raw.coeff_in_subject.replace(",", "."));
        if (!Number.isNaN(parsed) && parsed >= 0) {
          coeff = parsed;
        }
      }

      return {
        code,
        label,
        short_label,
        order_index,
        coeff_in_subject: coeff,
        is_active: raw.is_active !== false,
      };
    })
    .filter(Boolean) as {
    code: string;
    label: string;
    short_label: string;
    order_index: number;
    coeff_in_subject: number;
    is_active: boolean;
  }[];

  // 1) On supprime tout pour (institution, sujet, niveau)
  {
    let delQuery = srv
      .from("grade_subject_components")
      .delete()
      .eq("institution_id", g.instId)
      .eq("subject_id", subject_id);

    if (level === null) {
      delQuery = delQuery.is("level", null);
    } else {
      delQuery = delQuery.in("level", equivalentLegacyLevels(level));
    }

    const { error: delErr } = await delQuery;
    if (delErr) return error(delErr.message, 400);
  }

  // 2) On insère la nouvelle liste
  const payload = normalized.map((c) => ({
    institution_id: g.instId,
    subject_id,
    level,
    code: c.code,
    label: c.label,
    short_label: c.short_label,
    order_index: c.order_index,
    coeff_in_subject: c.coeff_in_subject,
    is_active: c.is_active,
  }));

  const { data, error: insErr } = await srv
    .from("grade_subject_components")
    .insert(payload)
    .select("id");

  if (insErr) return error(insErr.message, 400);

  return NextResponse.json({
    ok: true,
    subject_id,
    level,
    inserted: data?.length ?? 0,
  });
}
