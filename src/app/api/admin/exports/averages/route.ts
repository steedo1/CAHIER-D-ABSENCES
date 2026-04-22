import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

type Role = "super_admin" | "admin" | "educator" | "teacher" | "parent" | string;

type GradePeriodRow = {
  id: string;
  academic_year: string | null;
  code: string | null;
  label: string | null;
  short_label: string | null;
  start_date: string;
  end_date: string;
  coeff: number | null;
};

type ClassRow = {
  id: string;
  label?: string | null;
  code?: string | null;
  level?: string | null;
  academic_year?: string | null;
  institution_id?: string | null;
};

type StudentMetaRow = {
  student_id: string;
  class_id: string;
  class_label: string;
  class_level: string | null;
  academic_year: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  matricule: string | null;
};

type BulletinItem = {
  student_id: string;
  full_name: string;
  matricule: string | null;
  general_avg: number | null;
  annual_avg?: number | null;
  annual_rank?: number | null;
  rank?: number | null;
};

type BulletinResponse = {
  ok: boolean;
  class?: {
    id: string;
    label: string;
    academic_year?: string | null;
    level?: string | null;
  };
  period?: {
    from: string | null;
    to: string | null;
    code?: string | null;
    label?: string | null;
    short_label?: string | null;
    academic_year?: string | null;
    coeff?: number | null;
  };
  items?: BulletinItem[];
};

type ConductAverageItem = {
  student_id: string;
  total?: number | null;
  avg20?: number | null;
  avg?: number | null;
  value?: number | null;
  score?: number | null;
  note?: number | null;
};

type ConductResponse =
  | { ok?: boolean; items?: ConductAverageItem[]; data?: ConductAverageItem[] }
  | ConductAverageItem[];

type ExportRow = {
  institution: string;
  academic_year: string;
  periode: string;
  periode_code: string;
  classe: string;
  niveau: string;
  matricule: string;
  nom: string;
  prenoms: string;
  nom_prenoms: string;
  moyenne_generale: number | null;
  rang: number | null;
  moyenne_annuelle: number | null;
  rang_annuel: number | null;
  conduite: number | null;
};

type ExportFormat = "xlsx" | "csv";
type ExportModel = "standard" | "generic";

type ResolvedPeriod = {
  academicYear: string;
  requestedKind: "period" | "annual";
  requestedLabel: string;
  requestedCode: string;
  bulletinFrom: string;
  bulletinTo: string;
  bulletinPeriod: GradePeriodRow;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanNumber(value: unknown, precision = 2): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(precision));
}

function isUuid(v: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    v
  );
}

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  if (/[";\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(csvEscape).join(";")];

  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(";"));
  }

  return `\uFEFF${lines.join("\r\n")}`;
}

function toFileSafePart(value: string): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function splitStudentName(meta: Pick<StudentMetaRow, "first_name" | "last_name" | "full_name">) {
  const lastName = String(meta.last_name || "").trim();
  const firstName = String(meta.first_name || "").trim();
  const fullName = String(meta.full_name || "").trim();

  if (lastName || firstName) {
    return {
      nom: lastName,
      prenoms: firstName,
      nom_prenoms: [lastName, firstName].filter(Boolean).join(" ").trim() || fullName,
    };
  }

  if (!fullName) {
    return { nom: "", prenoms: "", nom_prenoms: "" };
  }

  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { nom: parts[0], prenoms: "", nom_prenoms: fullName };
  }

  return {
    nom: parts[0],
    prenoms: parts.slice(1).join(" "),
    nom_prenoms: fullName,
  };
}

function pickOrigin(req: NextRequest) {
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    process.env.VERCEL_URL ??
    null;

  if (!host) {
    return (
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.PUBLIC_APP_URL ||
      process.env.APP_URL ||
      "http://localhost:3000"
    );
  }

  const protoHeader =
    req.headers.get("x-forwarded-proto") ??
    req.headers.get("x-forwarded-protocol") ??
    null;

  const isLocal =
    host.includes("localhost") ||
    host.includes("127.0.0.1") ||
    host.includes("0.0.0.0");

  const proto = protoHeader ?? (isLocal ? "http" : "https");

  return host.startsWith("http://") || host.startsWith("https://")
    ? host
    : `${proto}://${host}`;
}

function makeDownloadFilename(opts: {
  institutionName: string;
  academicYear: string;
  requestedCode: string;
  format: ExportFormat;
  classLabel?: string;
}) {
  const base = [
    "export-moyennes",
    toFileSafePart(opts.institutionName || "etablissement"),
    toFileSafePart(opts.academicYear || "annee"),
    toFileSafePart(opts.requestedCode || "periode"),
    opts.classLabel ? toFileSafePart(opts.classLabel) : "toutes-classes",
  ]
    .filter(Boolean)
    .join("_");

  return `${base}.${opts.format}`;
}

function buildStandardRows(rows: ExportRow[]) {
  return rows.map((row) => ({
    Institution: row.institution,
    "Année scolaire": row.academic_year,
    Période: row.periode,
    "Code période": row.periode_code,
    Classe: row.classe,
    Niveau: row.niveau,
    Matricule: row.matricule,
    Nom: row.nom,
    Prénoms: row.prenoms,
    "Nom complet": row.nom_prenoms,
    "Moyenne générale": row.moyenne_generale ?? "",
    Rang: row.rang ?? "",
    "Moyenne annuelle": row.moyenne_annuelle ?? "",
    "Rang annuel": row.rang_annuel ?? "",
    Conduite: row.conduite ?? "",
  }));
}

function buildGenericRows(rows: ExportRow[]) {
  return rows.map((row) => ({
    matricule: row.matricule,
    nom: row.nom,
    prenoms: row.prenoms,
    classe: row.classe,
    annee_scolaire: row.academic_year,
    periode: row.periode,
    moyenne: row.moyenne_generale ?? "",
    rang: row.rang ?? "",
    moyenne_annuelle: row.moyenne_annuelle ?? "",
    rang_annuel: row.rang_annuel ?? "",
    conduite: row.conduite ?? "",
  }));
}

async function getAdminAndInstitution() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { supabase, error: "UNAUTHENTICATED" as const };
  }

  const { data: roleRow, error: roleErr } = await supabase
    .from("user_roles")
    .select("institution_id, role")
    .eq("profile_id", user.id)
    .in("role", ["admin", "super_admin"])
    .limit(1)
    .maybeSingle();

  if (roleErr || !roleRow) {
    return { supabase, error: "PROFILE_NOT_FOUND" as const };
  }

  const role = roleRow.role as Role;
  if (!["super_admin", "admin"].includes(role)) {
    return { supabase, error: "FORBIDDEN" as const };
  }

  if (!roleRow.institution_id) {
    return { supabase, error: "NO_INSTITUTION" as const };
  }

  return {
    supabase,
    institutionId: String(roleRow.institution_id),
    role,
    userId: user.id,
  };
}

async function resolvePeriod(params: {
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  institutionId: string;
  academicYear: string;
  periodRef: string;
}): Promise<ResolvedPeriod | null> {
  const { supabase, institutionId, academicYear, periodRef } = params;

  if (periodRef.startsWith("period:")) {
    const periodId = periodRef.slice("period:".length).trim();
    if (!isUuid(periodId)) return null;

    const { data: period } = await supabase
      .from("grade_periods")
      .select("id, academic_year, code, label, short_label, start_date, end_date, coeff")
      .eq("institution_id", institutionId)
      .eq("id", periodId)
      .maybeSingle();

    if (!period) return null;

    const row = period as GradePeriodRow;
    const year = String(row.academic_year || academicYear || "").trim();
    const label = String(row.short_label || row.label || row.code || "Période").trim();
    const code = String(row.code || row.short_label || row.label || "period").trim();

    return {
      academicYear: year,
      requestedKind: "period",
      requestedLabel: label,
      requestedCode: code,
      bulletinFrom: row.start_date,
      bulletinTo: row.end_date,
      bulletinPeriod: row,
    };
  }

  if (periodRef.startsWith("annual:")) {
    const year = periodRef.slice("annual:".length).trim() || academicYear;

    const { data: periods } = await supabase
      .from("grade_periods")
      .select("id, academic_year, code, label, short_label, start_date, end_date, coeff")
      .eq("institution_id", institutionId)
      .eq("academic_year", year)
      .order("start_date", { ascending: true });

    const rows = (periods || []) as GradePeriodRow[];
    if (!rows.length) return null;

    const sorted = rows.slice().sort((a, b) => {
      const ae = String(a.end_date || "");
      const be = String(b.end_date || "");
      if (ae !== be) return ae.localeCompare(be);
      return String(a.start_date || "").localeCompare(String(b.start_date || ""));
    });

    const lastPeriod = sorted[sorted.length - 1];

    return {
      academicYear: year,
      requestedKind: "annual",
      requestedLabel: "Annuel",
      requestedCode: "ANNUEL",
      bulletinFrom: String(lastPeriod.start_date),
      bulletinTo: String(lastPeriod.end_date),
      bulletinPeriod: lastPeriod,
    };
  }

  return null;
}

async function fetchBulletinForClass(params: {
  req: NextRequest;
  classId: string;
  from: string;
  to: string;
}): Promise<BulletinResponse | null> {
  const origin = pickOrigin(params.req);
  const url = new URL("/api/admin/grades/bulletin", origin);
  url.searchParams.set("class_id", params.classId);
  url.searchParams.set("from", params.from);
  url.searchParams.set("to", params.to);

  const cookie = params.req.headers.get("cookie") ?? "";

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: cookie ? { cookie } : {},
      cache: "no-store",
    });

    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as BulletinResponse | null;
    if (!data?.ok) return null;
    return data;
  } catch {
    return null;
  }
}

async function fetchConductMap(params: {
  req: NextRequest;
  classId: string;
  from: string;
  to: string;
}): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const origin = pickOrigin(params.req);
  const url = new URL("/api/admin/conduite/averages", origin);
  url.searchParams.set("class_id", params.classId);
  url.searchParams.set("from", params.from);
  url.searchParams.set("to", params.to);

  const cookie = params.req.headers.get("cookie") ?? "";

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: cookie ? { cookie } : {},
      cache: "no-store",
    });

    if (!res.ok) return out;

    const json = (await res.json().catch(() => null)) as ConductResponse | null;
    const items = Array.isArray(json)
      ? json
      : Array.isArray(json?.items)
      ? json.items
      : Array.isArray(json?.data)
      ? json.data
      : [];

    for (const item of items) {
      const sid = String(item?.student_id || "");
      if (!sid) continue;
      const raw =
        item?.total ?? item?.avg20 ?? item?.avg ?? item?.value ?? item?.score ?? item?.note ?? null;
      out.set(sid, cleanNumber(raw, 4));
    }
  } catch {
    return out;
  }

  return out;
}

export async function GET(req: NextRequest) {
  const ctx = await getAdminAndInstitution();

  if ("error" in ctx) {
    const status =
      ctx.error === "UNAUTHENTICATED"
        ? 401
        : ctx.error === "FORBIDDEN"
        ? 403
        : 400;
    return NextResponse.json({ ok: false, error: ctx.error }, { status });
  }

  const { supabase, institutionId } = ctx;
  const { searchParams } = new URL(req.url);

  const academicYear = String(searchParams.get("academic_year") || "").trim();
  const periodRef = String(searchParams.get("period_ref") || "").trim();
  const classId = String(searchParams.get("class_id") || "").trim();
  const exportModel = String(searchParams.get("export_model") || "standard").trim() as ExportModel;
  const format = String(searchParams.get("format") || "xlsx").trim().toLowerCase() as ExportFormat;

  if (!academicYear) {
    return NextResponse.json({ ok: false, error: "MISSING_ACADEMIC_YEAR" }, { status: 400 });
  }

  if (!periodRef) {
    return NextResponse.json({ ok: false, error: "MISSING_PERIOD_REF" }, { status: 400 });
  }

  if (!["standard", "generic"].includes(exportModel)) {
    return NextResponse.json({ ok: false, error: "INVALID_EXPORT_MODEL" }, { status: 400 });
  }

  if (!["xlsx", "csv"].includes(format)) {
    return NextResponse.json({ ok: false, error: "INVALID_FORMAT" }, { status: 400 });
  }

  const resolvedPeriod = await resolvePeriod({
    supabase,
    institutionId,
    academicYear,
    periodRef,
  });

  if (!resolvedPeriod) {
    return NextResponse.json({ ok: false, error: "INVALID_PERIOD_REF" }, { status: 400 });
  }

  let classesQuery = supabase
    .from("classes")
    .select("id, label, code, level, academic_year, institution_id")
    .eq("institution_id", institutionId)
    .eq("academic_year", resolvedPeriod.academicYear)
    .order("level", { ascending: true })
    .order("label", { ascending: true });

  if (classId) {
    if (!isUuid(classId)) {
      return NextResponse.json({ ok: false, error: "INVALID_CLASS_ID" }, { status: 400 });
    }
    classesQuery = classesQuery.eq("id", classId);
  }

  const { data: classRows, error: classErr } = await classesQuery;
  if (classErr) {
    return NextResponse.json({ ok: false, error: "CLASSES_ERROR" }, { status: 500 });
  }

  const classes = (classRows || []) as ClassRow[];
  if (!classes.length) {
    return NextResponse.json({ ok: false, error: "NO_CLASSES_FOUND" }, { status: 404 });
  }

  const targetClassIds = classes.map((c) => String(c.id));
  const classMap = new Map<string, ClassRow>(classes.map((c) => [String(c.id), c]));

  let enrollQuery = supabase
    .from("class_enrollments")
    .select(
      `
      class_id,
      student_id,
      students(
        first_name,
        last_name,
        full_name,
        matricule
      )
    `
    )
    .in("class_id", targetClassIds)
    .or(`end_date.gte.${resolvedPeriod.bulletinFrom},end_date.is.null`)
    .order("student_id", { ascending: true });

  const { data: enrollments, error: enrollErr } = await enrollQuery;
  if (enrollErr) {
    return NextResponse.json({ ok: false, error: "ENROLLMENTS_ERROR" }, { status: 500 });
  }

  const studentMetaByKey = new Map<string, StudentMetaRow>();
  for (const row of (enrollments || []) as any[]) {
    const currentClassId = String(row?.class_id || "");
    const studentId = String(row?.student_id || "");
    if (!currentClassId || !studentId) continue;

    const cls = classMap.get(currentClassId);
    if (!cls) continue;

    const student = row?.students || {};
    const key = `${currentClassId}__${studentId}`;

    studentMetaByKey.set(key, {
      student_id: studentId,
      class_id: currentClassId,
      class_label: String(cls.label || cls.code || "Classe"),
      class_level: cls.level ?? null,
      academic_year: cls.academic_year ?? resolvedPeriod.academicYear,
      first_name: student.first_name ?? null,
      last_name: student.last_name ?? null,
      full_name: student.full_name ?? null,
      matricule: student.matricule ?? null,
    });
  }

  const { data: institution } = await supabase
    .from("institutions")
    .select("name")
    .eq("id", institutionId)
    .maybeSingle();

  const institutionName = String((institution as any)?.name || "Établissement");
  const exportRows: ExportRow[] = [];

  for (const cls of classes) {
    const currentClassId = String(cls.id);

    const [bulletinData, conductMap] = await Promise.all([
      fetchBulletinForClass({
        req,
        classId: currentClassId,
        from: resolvedPeriod.bulletinFrom,
        to: resolvedPeriod.bulletinTo,
      }),
      fetchConductMap({
        req,
        classId: currentClassId,
        from: resolvedPeriod.bulletinFrom,
        to: resolvedPeriod.bulletinTo,
      }),
    ]);

    if (!bulletinData?.items?.length) continue;

    for (const item of bulletinData.items) {
      const key = `${currentClassId}__${String(item.student_id)}`;
      const meta = studentMetaByKey.get(key);
      const split = splitStudentName({
        first_name: meta?.first_name ?? null,
        last_name: meta?.last_name ?? null,
        full_name: meta?.full_name ?? item.full_name ?? null,
      });

      const currentGeneral = cleanNumber(item.general_avg, 4);
      const currentAnnual = cleanNumber(item.annual_avg, 4);
      const currentConduct = cleanNumber(conductMap.get(String(item.student_id)) ?? null, 4);

      const exportedAverage =
        resolvedPeriod.requestedKind === "annual"
          ? currentAnnual ?? currentGeneral
          : currentGeneral;

      const exportedRank =
        resolvedPeriod.requestedKind === "annual"
          ? item.annual_rank ?? item.rank ?? null
          : item.rank ?? null;

      exportRows.push({
        institution: institutionName,
        academic_year: String(meta?.academic_year || resolvedPeriod.academicYear || ""),
        periode: resolvedPeriod.requestedLabel,
        periode_code: resolvedPeriod.requestedCode,
        classe: String(meta?.class_label || cls.label || cls.code || "Classe"),
        niveau: String(meta?.class_level || cls.level || ""),
        matricule: String(meta?.matricule || item.matricule || ""),
        nom: split.nom,
        prenoms: split.prenoms,
        nom_prenoms: split.nom_prenoms || String(item.full_name || ""),
        moyenne_generale: exportedAverage,
        rang: exportedRank,
        moyenne_annuelle: currentAnnual,
        rang_annuel: item.annual_rank ?? null,
        conduite: currentConduct,
      });
    }
  }

  if (!exportRows.length) {
    return NextResponse.json({ ok: false, error: "NO_EXPORTABLE_DATA" }, { status: 404 });
  }

  exportRows.sort((a, b) => {
    const classCmp = a.classe.localeCompare(b.classe, "fr");
    if (classCmp !== 0) return classCmp;
    const rankA = Number.isFinite(Number(a.rang)) ? Number(a.rang) : 999999;
    const rankB = Number.isFinite(Number(b.rang)) ? Number(b.rang) : 999999;
    if (rankA !== rankB) return rankA - rankB;
    return a.nom_prenoms.localeCompare(b.nom_prenoms, "fr");
  });

  const preparedRows =
    exportModel === "generic" ? buildGenericRows(exportRows) : buildStandardRows(exportRows);

  const filename = makeDownloadFilename({
    institutionName,
    academicYear: resolvedPeriod.academicYear,
    requestedCode: resolvedPeriod.requestedCode,
    classLabel: classes.length === 1 ? String(classes[0].label || classes[0].code || "") : undefined,
    format,
  });

  if (format === "csv") {
    const csv = buildCsv(preparedRows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  try {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();

    const summarySheet = XLSX.utils.json_to_sheet(preparedRows);
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Résumé");

    if (classes.length > 1) {
      for (const cls of classes) {
        const classLabel = String(cls.label || cls.code || "Classe");
        const classRows = exportRows.filter(
          (row) => row.classe === classLabel
        );
        if (!classRows.length) continue;

        const rowsForSheet =
          exportModel === "generic"
            ? buildGenericRows(classRows)
            : buildStandardRows(classRows);

        const ws = XLSX.utils.json_to_sheet(rowsForSheet);
        const sheetName = classLabel.slice(0, 31) || "Classe";
        XLSX.utils.book_append_sheet(workbook, ws, sheetName);
      }
    }

    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    }) as Buffer;

    const fileBytes = Uint8Array.from(buffer);
    const fileArrayBuffer = fileBytes.buffer.slice(
      fileBytes.byteOffset,
      fileBytes.byteOffset + fileBytes.byteLength
    );

    return new Response(fileArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "XLSX_LIBRARY_MISSING",
        message: "Installe le package xlsx pour activer l’export Excel : npm i xlsx",
      },
      { status: 500 }
    );
  }
}
