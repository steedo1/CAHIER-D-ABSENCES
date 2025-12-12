// src/app/api/admin/students/photos/import/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GuardOk = { user: { id: string }; instId: string };
type GuardErr = { error: "unauthorized" | "no_institution" | "forbidden" };

async function guard(
  supa: SupabaseClient,
  srv: SupabaseClient
): Promise<GuardOk | GuardErr> {
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return { error: "unauthorized" };

  // profiles
  const { data: me } = await supa
    .from("profiles")
    .select("id, role, institution_id")
    .eq("id", user.id)
    .maybeSingle();

  let instId: string | null = (me?.institution_id as string) || null;
  const roleProfile = String(me?.role || "");

  // user_roles fallback (admin / super_admin)
  let roleFromUR: string | null = null;
  if (!instId || !["admin", "super_admin"].includes(roleProfile)) {
    const { data: urRows } = await srv
      .from("user_roles")
      .select("role, institution_id")
      .eq("profile_id", user.id);

    const adminRow = (urRows || []).find((r: any) =>
      ["admin", "super_admin"].includes(String(r.role || ""))
    );
    if (adminRow) {
      roleFromUR = String(adminRow.role);
      if (!instId && adminRow.institution_id) instId = String(adminRow.institution_id);
    }
  }

  const isAdmin =
    ["admin", "super_admin"].includes(roleProfile) ||
    ["admin", "super_admin"].includes(String(roleFromUR || ""));

  if (!instId) return { error: "no_institution" };
  if (!isAdmin) return { error: "forbidden" };

  return { user: { id: user.id }, instId };
}

/* ───────── Normalisation ───────── */
function stripAccents(s: string) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function baseNameNoExt(filename: string) {
  const n = String(filename || "").trim();
  const lastDot = n.lastIndexOf(".");
  return lastDot > 0 ? n.slice(0, lastDot) : n;
}

function normalizeKeyForName(v: string) {
  // "ANOH_Ekloi-Acouba" => "ANOH EKLOI ACOUBA"
  return stripAccents(String(v || ""))
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizeKeyForMatricule(v: string) {
  // matricule: on supprime espaces et séparateurs
  return stripAccents(String(v || ""))
    .replace(/\s+/g, "")
    .replace(/[_-]+/g, "")
    .trim()
    .toUpperCase();
}

type MatchMode = "auto" | "matricule" | "full_name";

function normalizeMatchMode(v: any): MatchMode {
  const s = String(v || "auto");
  return s === "matricule" || s === "full_name" || s === "auto" ? s : "auto";
}

type StudentMini = {
  id: string;
  matricule: string | null;
  full_name: string | null;
};

async function fetchAllStudentsForInstitution(
  srv: SupabaseClient,
  instId: string
): Promise<StudentMini[]> {
  const out: StudentMini[] = [];
  const pageSize = 2000;
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await srv
      .from("students")
      .select("id, matricule, full_name")
      .eq("institution_id", instId)
      .range(from, to);

    if (error) throw new Error(error.message);

    const rows = (data || []) as any[];
    for (const r of rows) {
      out.push({
        id: String(r.id),
        matricule: r.matricule ? String(r.matricule) : null,
        full_name: r.full_name ? String(r.full_name) : null,
      });
    }

    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 20000) break; // garde-fou
  }

  return out;
}

function buildMaps(students: StudentMini[]) {
  const matMap = new Map<string, StudentMini>();
  const matDup = new Set<string>();

  const nameMap = new Map<string, StudentMini>();
  const nameDup = new Set<string>();

  for (const s of students) {
    if (s.matricule) {
      const k = normalizeKeyForMatricule(s.matricule);
      if (matMap.has(k)) matDup.add(k);
      else matMap.set(k, s);
    }
    if (s.full_name) {
      const k = normalizeKeyForName(s.full_name);
      if (nameMap.has(k)) nameDup.add(k);
      else nameMap.set(k, s);
    }
  }
  return { matMap, matDup, nameMap, nameDup };
}

function matchOne(filename: string, mode: MatchMode, maps: ReturnType<typeof buildMaps>) {
  const keyRaw = baseNameNoExt(filename);
  const keyMat = normalizeKeyForMatricule(keyRaw);
  const keyName = normalizeKeyForName(keyRaw);

  const tryMat = () => {
    if (maps.matDup.has(keyMat)) return { ok: false, error: "ambiguous_matricule" as const };
    const s = maps.matMap.get(keyMat);
    return s
      ? { ok: true, type: "matricule" as const, student: s }
      : { ok: false, error: "not_found" as const };
  };

  const tryName = () => {
    if (maps.nameDup.has(keyName)) return { ok: false, error: "ambiguous_full_name" as const };
    const s = maps.nameMap.get(keyName);
    return s
      ? { ok: true, type: "full_name" as const, student: s }
      : { ok: false, error: "not_found" as const };
  };

  if (mode === "matricule") return { keyRaw, keyMat, keyName, ...tryMat() };
  if (mode === "full_name") return { keyRaw, keyMat, keyName, ...tryName() };

  // auto
  const m = tryMat();
  if ((m as any).ok) return { keyRaw, keyMat, keyName, ...(m as any) };
  const n = tryName();
  return { keyRaw, keyMat, keyName, ...(n as any) };
}

function extFromFileName(name: string) {
  const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "jpg";
}

function isFileLike(v: unknown): v is File {
  if (!v) return false;
  if (typeof v === "string") return false;
  const anyV = v as any;
  return typeof anyV.name === "string" && typeof anyV.arrayBuffer === "function";
}

export async function POST(req: NextRequest) {
  const supa = (await getSupabaseServerClient()) as unknown as SupabaseClient;
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;

  const g = await guard(supa, srv);
  if ("error" in g) {
    const status = g.error === "unauthorized" ? 401 : 403;
    return NextResponse.json({ error: g.error }, { status });
  }

  const ct = req.headers.get("content-type") || "";
  const bucket = "student-photos";

  // ── PREVIEW (JSON) ──
  if (ct.includes("application/json")) {
    const body: any = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    const match_mode: MatchMode = normalizeMatchMode(body?.match_mode);

    // ✅ FIX TS: on force un vrai string[]
    const filenames: string[] = Array.isArray(body?.filenames)
      ? (body.filenames as unknown[]).map((v) => String(v))
      : [];

    if (action !== "preview") {
      return NextResponse.json({ error: "bad_action" }, { status: 400 });
    }
    if (!filenames.length) {
      return NextResponse.json({ items: [] });
    }

    try {
      const students = await fetchAllStudentsForInstitution(srv, g.instId);
      const maps = buildMaps(students);

      // ✅ FIX TS: fn est typé string
      const items = filenames.slice(0, 2000).map((fn: string) => {
        const r = matchOne(fn, match_mode, maps);
        if ((r as any).ok) {
          const s = (r as any).student as StudentMini;
          return {
            file_name: fn,
            key_raw: r.keyRaw,
            match_ok: true,
            match_type: (r as any).type,
            student: {
              id: s.id,
              matricule: s.matricule,
              full_name: s.full_name,
            },
          };
        }
        return {
          file_name: fn,
          key_raw: r.keyRaw,
          match_ok: false,
          error: (r as any).error,
        };
      });

      return NextResponse.json({ items });
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || "preview_failed" },
        { status: 400 }
      );
    }
  }

  // ── COMMIT (multipart/form-data) ──
  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    const action = String(fd.get("action") || "commit");
    const match_mode: MatchMode = normalizeMatchMode(fd.get("match_mode"));

    if (action !== "commit") {
      return NextResponse.json({ error: "bad_action" }, { status: 400 });
    }

    // ✅ accepte "files" OU "file" + filtre File réel
    const raw = [...fd.getAll("files"), ...fd.getAll("file")];
    const files: File[] = raw.filter(isFileLike);

    if (!files.length) {
      return NextResponse.json({ error: "no_files" }, { status: 400 });
    }

    // charger les élèves et maps
    let students: StudentMini[] = [];
    try {
      students = await fetchAllStudentsForInstitution(srv, g.instId);
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || "students_fetch_failed" },
        { status: 400 }
      );
    }
    const maps = buildMaps(students);

    const results: any[] = [];
    let updated = 0;
    let uploaded = 0;
    let failed = 0;

    for (const file of files) {
      const filename = file?.name || "unknown";
      const r = matchOne(filename, match_mode, maps);

      if (!(r as any).ok) {
        failed++;
        results.push({
          file_name: filename,
          key_raw: r.keyRaw,
          ok: false,
          error: (r as any).error,
        });
        continue;
      }

      const s = (r as any).student as StudentMini;

      // validations simples
      const size = (file as any).size ?? 0;
      if (size > 6 * 1024 * 1024) {
        failed++;
        results.push({
          file_name: filename,
          key_raw: r.keyRaw,
          ok: false,
          error: "file_too_large",
          max_mb: 6,
        });
        continue;
      }

      const contentType = (file as any).type || "image/jpeg";
      if (!String(contentType).startsWith("image/")) {
        failed++;
        results.push({
          file_name: filename,
          key_raw: r.keyRaw,
          ok: false,
          error: "not_an_image",
          content_type: contentType,
        });
        continue;
      }

      const ext = extFromFileName(filename);
      const safeLabel = (s.matricule || s.full_name || s.id || "student")
        .toString()
        .replace(/[^\w.-]+/g, "_")
        .slice(0, 80);

      const path = `${g.instId}/${s.id}/${safeLabel}.${ext}`;

      try {
        const bytes = Buffer.from(await file.arrayBuffer());

        const up = await srv.storage.from(bucket).upload(path, bytes, {
          contentType,
          upsert: true,
        });

        if (up.error) {
          failed++;
          results.push({
            file_name: filename,
            key_raw: r.keyRaw,
            ok: false,
            error: "upload_failed",
            detail: up.error.message,
          });
          continue;
        }

        uploaded++;

        const pub = srv.storage.from(bucket).getPublicUrl(path);
        const publicUrl = pub?.data?.publicUrl || "";

        const { error: uerr } = await srv
          .from("students")
          .update({
            photo_url: publicUrl || null,
            photo_path: path,
            photo_updated_at: new Date().toISOString(),
          })
          .eq("id", s.id)
          .eq("institution_id", g.instId);

        if (uerr) {
          failed++;
          results.push({
            file_name: filename,
            key_raw: r.keyRaw,
            ok: false,
            error: "db_update_failed",
            detail: uerr.message,
          });
          continue;
        }

        updated++;
        results.push({
          file_name: filename,
          key_raw: r.keyRaw,
          ok: true,
          match_type: (r as any).type,
          student: {
            id: s.id,
            matricule: s.matricule,
            full_name: s.full_name,
          },
          photo_url: publicUrl,
          photo_path: path,
        });
      } catch (e: any) {
        failed++;
        results.push({
          file_name: filename,
          key_raw: r.keyRaw,
          ok: false,
          error: "unexpected_error",
          detail: e?.message || String(e),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      match_mode,
      total: files.length,
      uploaded,
      updated,
      failed,
      results: results.slice(0, 2000),
    });
  }

  return NextResponse.json({ error: "unsupported_content_type" }, { status: 415 });
}
