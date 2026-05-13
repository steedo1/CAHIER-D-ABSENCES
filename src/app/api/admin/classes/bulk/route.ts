// src/app/api/admin/classes/bulk/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

type OfficialTrackCode =
  | "6eme"
  | "5eme"
  | "4eme"
  | "3eme"
  | "2ndeA"
  | "2ndeC"
  | "1ereA1"
  | "1ereA2"
  | "1ereC"
  | "1ereD"
  | "tleA1"
  | "tleA2"
  | "tleC"
  | "tleD";

type Body = {
  level: string;
  format: "none" | "numeric" | "alpha";
  count: number;
  academic_year?: string | null;
  codePrefix?: string | null;
  official_track_code?: OfficialTrackCode | "" | null;
  officialTrackCode?: OfficialTrackCode | "" | null;
};

const OFFICIAL_TRACK_CODES = new Set<string>([
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
]);

function slug(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeKey(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function computeAcademicYear(d = new Date()) {
  const m = d.getUTCMonth() + 1;
  const y = d.getUTCFullYear();
  return m >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

function inferOfficialTrackCode(level: string): OfficialTrackCode | null {
  const key = normalizeKey(level);

  if (/^6/.test(key)) return "6eme";
  if (/^5/.test(key)) return "5eme";
  if (/^4/.test(key)) return "4eme";
  if (/^3/.test(key)) return "3eme";

  if (/^(2NDEA|SECONDEA|2A)/.test(key)) return "2ndeA";
  if (/^(2NDEC|SECONDEC|2C)/.test(key)) return "2ndeC";

  if (/^(1ERED|PREMIERED|1D)/.test(key)) return "1ereD";
  if (/^(1EREC|PREMIEREC|1C)/.test(key)) return "1ereC";

  // Décision actuelle : l'établissement en production n'a pas de série A1.
  // Les classes 1A, 1A1, 1A2, 1A3 sont donc rattachées par défaut à 1ereA2.
  if (/^(1EREA|PREMIEREA|1A)/.test(key)) return "1ereA2";

  if (/^(TLED|TERMINALED|TD)/.test(key)) return "tleD";
  if (/^(TLEC|TERMINALEC|TC)/.test(key)) return "tleC";

  // Même logique pour TA, TA1, TA2, TA3 : par défaut TleA2.
  if (/^(TLEA|TERMINALEA|TA)/.test(key)) return "tleA2";

  return null;
}

function cleanOfficialTrackCode(value: unknown, fallbackLevel: string): OfficialTrackCode | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw) {
    if (!OFFICIAL_TRACK_CODES.has(raw)) {
      throw new Error("bad_official_track_code");
    }
    return raw as OfficialTrackCode;
  }

  return inferOfficialTrackCode(fallbackLevel);
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;

  const level = (body.level ?? "").trim();
  const format = body.format;
  const count = Number(body.count ?? 0);
  const academic_year = String(body.academic_year || computeAcademicYear()).trim();
  const codePrefix = body.codePrefix ?? null;

  let official_track_code: OfficialTrackCode | null = null;
  try {
    official_track_code = cleanOfficialTrackCode(
      body.official_track_code ?? body.officialTrackCode ?? null,
      level
    );
  } catch {
    return NextResponse.json({ error: "bad_official_track_code" }, { status: 400 });
  }

  const formatOk = format === "none" || format === "numeric" || format === "alpha";
  const countOk = Number.isFinite(count) && (format === "none" ? true : count >= 1 && count <= 30);

  if (!level || !formatOk || !countOk || !academic_year) {
    return NextResponse.json({ error: "bad_payload" }, { status: 400 });
  }

  const supabaseAuth = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: me, error: meErr } = await supabaseAuth
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
  if (!me?.institution_id) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  const institution_id = me.institution_id as string;

  const effectiveCount = format === "none" ? 1 : count;
  let labels: string[] = [];

  if (format === "none") {
    labels = [level];
  } else if (format === "numeric") {
    labels = Array.from({ length: effectiveCount }, (_, i) => `${level}${i + 1}`);
  } else {
    labels = Array.from({ length: effectiveCount }, (_, i) => `${level}${String.fromCharCode(65 + i)}`);
  }

  const supabaseAdmin = getSupabaseServiceClient();

  // On ne réutilise plus une classe d'une ancienne année scolaire.
  // On vérifie seulement les doublons dans la même institution + même année + même libellé.
  const { data: existingRows, error: existingErr } = await supabaseAdmin
    .from("classes")
    .select("id,label,level,code,academic_year,official_track_code,class_phone_e164")
    .eq("institution_id", institution_id)
    .eq("academic_year", academic_year)
    .in("label", labels);

  if (existingErr) {
    return NextResponse.json({ error: existingErr.message }, { status: 400 });
  }

  const existingLabels = new Set((existingRows ?? []).map((row: any) => String(row.label)));

  const rows = labels
    .filter((label) => !existingLabels.has(label))
    .map((label) => {
      const base = slug(label);
      const code = codePrefix ? `${codePrefix}-${base}` : base;
      return {
        institution_id,
        label,
        level,
        code,
        academic_year,
        official_track_code,
      };
    });

  let insertedRows: any[] = [];

  if (rows.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("classes")
      .insert(rows)
      .select("id,label,level,code,academic_year,official_track_code,class_phone_e164");

    if (error) {
      const isUnique = (error as any).code === "23505";
      return NextResponse.json(
        {
          error: error.message,
          code: (error as any).code ?? null,
          hint: isUnique
            ? "Vérifiez que l'ancienne contrainte unique institution_id,label a bien été remplacée par une unicité par année scolaire."
            : null,
        },
        { status: isUnique ? 409 : 400 }
      );
    }

    insertedRows = data ?? [];
  }

  const items = [...(existingRows ?? []), ...insertedRows].sort((a: any, b: any) =>
    String(a.label).localeCompare(String(b.label), "fr", { numeric: true })
  );

  return NextResponse.json({
    inserted: insertedRows.length,
    existing: existingRows?.length ?? 0,
    items,
  });
}
