// src/app/api/admin/grades/bulletin/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";
import QRCode from "qrcode";

// ✅ QR court stocké en DB (table bulletin_qr_codes)
import { getOrCreateBulletinShortCode } from "@/lib/bulletin-qr-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role =
  | "super_admin"
  | "admin"
  | "educator"
  | "teacher"
  | "parent"
  | string;

type ClassRow = {
  id: string;
  label?: string | null;
  code?: string | null;
  institution_id?: string | null;
  academic_year?: string | null;
  head_teacher_id?: string | null;
  level?: string | null;
};

type HeadTeacherRow = {
  id: string;
  display_name?: string | null;
  phone?: string | null;
  email?: string | null;
};

type EvalRow = {
  id: string;
  class_id: string;
  subject_id: string | null;
  teacher_id: string | null; // ✅ prof qui a créé l'évaluation
  eval_date: string;
  scale: number;
  coeff: number;
  is_published: boolean;
  subject_component_id?: string | null; // ✅ sous-matière éventuelle
};

type ScoreRow = {
  evaluation_id: string;
  student_id: string;
  score: number | null;
};

type ClassStudentRow = {
  student_id: string;
  students?:
    | {
        full_name?: string | null;
        last_name?: string | null;
        first_name?: string | null;
        matricule?: string | null;

        // ✅ photo (ajouté sans retirer quoi que ce soit)
        photo_url?: string | null;

        gender?: string | null;
        birthdate?: string | null;
        birth_place?: string | null;
        nationality?: string | null;
        regime?: string | null;
        is_repeater?: boolean | null;
        is_boarder?: boolean | null;
        is_affecte?: boolean | null;
      }
    | null;
};

type SubjectRow = {
  id: string;
  name?: string | null;
  code?: string | null;
};

type SubjectCoeffRow = {
  subject_id: string;
  coeff: number;
  include_in_average?: boolean | null;
  level?: string | null;
};

type BulletinSubjectGroupItem = {
  id: string;
  group_id: string;
  subject_id: string;
  subject_name: string;
  order_index: number;
  subject_coeff_override: number | null;
  is_optional: boolean;
};

type BulletinSubjectGroup = {
  id: string;
  code: string;
  label: string;
  short_label: string | null;
  order_index: number;
  is_active: boolean;
  annual_coeff: number;
  items: BulletinSubjectGroupItem[];
};

// ✅ Sous-matières renvoyées au front
type BulletinSubjectComponent = {
  id: string;
  subject_id: string; // subjects.id parent
  label: string;
  short_label: string | null;
  coeff_in_subject: number;
  order_index: number;
};

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

/* ───────── helpers nombres ───────── */

// ✅ IMPORTANT: on garde plus de précision (4 décimales) pour éviter
// les écarts Total vs somme/pondération (ex: Français = sous-matières).
function cleanNumber(x: any, precision: number = 2): number | null {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(precision));
}

function cleanCoeff(c: any): number {
  const n = Number(c);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Number(n.toFixed(2));
}

function isUuid(v: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    v
  );
}

// ✅ Normalisation du niveau "bulletin"
function normalizeBulletinLevel(level?: string | null): string | null {
  if (!level) return null;
  const x = String(level).trim().toLowerCase();

  if (["6e", "5e", "4e", "3e", "seconde", "première", "terminale"].includes(x)) {
    return x;
  }
  if (x === "premiere") return "première";

  if (x.startsWith("2de") || x.startsWith("2nde") || x.startsWith("2")) return "seconde";
  if (x.startsWith("1re") || x.startsWith("1ere") || x.startsWith("1")) return "première";
  if (x.startsWith("t")) return "terminale";

  return null;
}

/* ───────── classification bilans (API) ───────── */

function normText(s?: string | null) {
  return (s ?? "").toString().trim().toLowerCase();
}

// ⚠️ EPS / EDHC / Musique / Arts / Conduite / Vie scolaire => AUTRES
function isOtherSubject(name?: string | null, code?: string | null): boolean {
  const n = normText(name);
  const c = normText(code);

  return (
    /(^|\b)(eps|e\.p\.s|sport)(\b|$)/.test(c) ||
    /(^|\b)(eps|e\.p\.s|sport)(\b|$)/.test(n) ||
    /(education\s*physique|éducation\s*physique|sportive|eps)/.test(n) ||
    /(edhc|civique|citoyenn|vie\s*scolaire|conduite)/.test(n) ||
    /(musique|chant|arts?\s*plastiques|dessin|th[eé]atre)/.test(n) ||
    /(tic|tice|informatique\s*(de\s*base)?)/.test(n) ||
    /(entrepreneuriat|travail\s*manuel|tm|bonus)/.test(n)
  );
}

// ✅ PHILO => LETTRES
function isPhiloSubject(name?: string | null, code?: string | null): boolean {
  const n = normText(name);
  const c = normText(code);
  return /(philo|philosoph)/.test(n) || /(philo|philosoph)/.test(c);
}

// ✅ LETTRES / langues / Histoire-Géo
function isLettersSubject(name?: string | null, code?: string | null): boolean {
  // ⚠️ si c'est déjà "AUTRES", on ne le classe pas en lettres
  if (isOtherSubject(name, code)) return false;

  const n = normText(name);
  const c = normText(code);

  // PHILO est toujours dans LETTRES
  if (isPhiloSubject(name, code)) return true;

  // codes courts fréquents
  if (
    /(^|\b)(fr|francais|français|ang|anglais|esp|espagnol|all|allemand|ar|arabe|hg|hist|histoire|geo|geographie|géographie|lit|litt|eco|economie|économie)(\b|$)/.test(
      c
    )
  ) {
    return true;
  }

  // noms
  return (
    /(fran[cç]ais|french|anglais|english|espagnol|spanish|allemand|german|arabe|arabic)/.test(n) ||
    /(histoire|hist\.|g[eé]ographie|histoire\s*-?\s*g[eé]o|hg)/.test(n) ||
    /(litt[eé]r|lettres|grammaire|orthograph|conjug|lecture|r[eé]daction|expression|compr[eé]hension)/.test(
      n
    ) ||
    /(economie|gestion|comptabilit|droit)/.test(n)
  );
}


// ✅ Sciences
function isScienceSubject(name?: string | null, code?: string | null): boolean {
  const n = normText(name);
  const c = normText(code);

  // ⚠️ ne PAS classer EPS/EDHC/Musique en sciences
  if (isOtherSubject(name, code)) return false;

  return (
    /(math|math[ée]m|pc|phys|chim|svt|bio|science|info|algo|stat|techno|thermo|mec|m[ée]can|electr|[ée]lectr|opt|astron|geol|g[eé]ol)/.test(c) ||
    /(math|math[ée]m|physique|chimie|svt|biolog|scienc|informat|algo|statist|technolog|thermo|m[ée]can|mecaniq|[ée]lectr|optique|astronom|g[eé]olog|g[eé]ophys)/.test(n)
  );
}

function groupKey(s?: string | null) {
  return (s ?? "")
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function findGroupByMeaning(
  groups: BulletinSubjectGroup[],
  meaning: "LETTRES" | "SCIENCES" | "AUTRES"
): BulletinSubjectGroup | null {
  const keys =
    meaning === "LETTRES"
      ? ["BILANLETTRES", "LETTRES", "LITTERAIRE", "LITTERATURE", "LANGUES"]
      : meaning === "SCIENCES"
      ? ["BILANSCIENCES", "SCIENCES", "SCIENTIFIQUE"]
      : ["BILANAUTRES", "AUTRES", "DIVERS", "VIESCOLAIRE", "CONDUITE"];

  for (const g of groups) {
    const k1 = groupKey(g.code);
    const k2 = groupKey(g.label);
    if (keys.includes(k1) || keys.includes(k2)) return g;
  }
  return null;
}

/* ───────── QR code (court /v/[code]) + fallback token ───────── */

const BULLETIN_VERIFY_SHORT_PREFIX = "/v"; // ✅ nouvelle page publique: /v/[code]
const BULLETIN_VERIFY_LEGACY_PATH = "/verify/bulletin"; // fallback historique

type BulletinQRPayload = {
  v: 1;
  instId: string;
  classId: string;
  studentId: string;
  academicYear: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  periodLabel: string | null;
  periodShortLabel?: string | null;

  // ✅ Snapshot (moyennes déjà calculées côté bulletin, utile pour la vérification publique sans cookie)
  s?:
    | {
        g?: number | null; // general_avg
        a?: number | null; // annual_avg
      }
    | null;

  iat: number; // ms
};

function b64urlEncode(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signBulletinQRToken(payload: Omit<BulletinQRPayload, "v" | "iat">): string | null {
  const secret = process.env.BULLETIN_QR_SECRET;
  if (!secret) return null;

  const full: BulletinQRPayload = { v: 1, iat: Date.now(), ...payload };
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(full), "utf8"));
  const sig = b64urlEncode(crypto.createHmac("sha256", secret).update(payloadB64).digest());
  return `${payloadB64}.${sig}`;
}

/** ✅ Origin PUBLIC (anti localhost) */
function pickPublicOrigin(fallbackOrigin: string) {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.APP_URL ||
    fallbackOrigin;

  return String(raw || "").replace(/\/+$/, "");
}

/** ✅ QR PNG server-side (qualité print + quiet zone) */
async function attachQrPng<T extends { qr_url: string | null }>(items: T[]) {
  // ✅ défaut plus robuste à l'impression
  const size = Number(process.env.BULLETIN_QR_PNG_SIZE || "600");
  const margin = Number(process.env.BULLETIN_QR_PNG_MARGIN || "2");
  const ecl =
    (process.env.BULLETIN_QR_PNG_ECL || "M") as "L" | "M" | "Q" | "H";

  return await Promise.all(
    items.map(async (it) => {
      if (!it.qr_url) return { ...it, qr_png: null as string | null };

      try {
        const png = await QRCode.toDataURL(it.qr_url, {
          width: size,
          margin, // ✅ quiet zone (CRITIQUE)
          errorCorrectionLevel: ecl,
        });
        return { ...it, qr_png: png || null };
      } catch (e) {
        return { ...it, qr_png: null as string | null };
      }
    })
  );
}

function computeBulletinKey(p: {
  instId: string;
  classId: string;
  studentId: string;
  academicYear: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  periodLabel: string | null;
}) {
  const raw = [
    p.instId,
    p.classId,
    p.studentId,
    p.academicYear ?? "",
    p.periodFrom ?? "",
    p.periodTo ?? "",
    p.periodLabel ?? "",
  ].join("|");

  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * ✅ Génère un QR URL COURT (/v/[code]) en stockant un mapping en DB.
 * ✅ Fallback automatique vers l'ancien token si la table n'est pas prête.
 */
async function addQrToItems<T extends { student_id: string }>(
  srv: SupabaseClient,
  items: T[],
  opts: {
    origin: string;
    institutionId: string;
    classId: string;
    classAcademicYear?: string | null;
    periodMeta: {
      from: string | null;
      to: string | null;
      code?: string | null;
      label?: string | null;
      short_label?: string | null;
      academic_year?: string | null;
    };
  }
): Promise<
  (T & {
    qr_mode: "short" | "token" | null;
    qr_code: string | null;
    qr_token: string | null;
    qr_url: string | null;
  })[]
> {
  const academicYear = opts.periodMeta.academic_year ?? opts.classAcademicYear ?? null;

  const periodLabel =
    opts.periodMeta.short_label ?? opts.periodMeta.label ?? opts.periodMeta.code ?? null;

const snapFor = (row: any) => {
  const g = cleanNumber((row as any)?.general_avg, 4);
  const a = cleanNumber((row as any)?.annual_avg, 4);
  if (g === null && a === null) return null;
  return { g, a };
};


  // On essaie le mode "short" par défaut (idéal pour le scan)
  const envMode = String(process.env.BULLETIN_QR_MODE || "short").toLowerCase();
  const preferShort = envMode !== "token";

  // 1) Test "short" une fois (évite de spammer les erreurs si table absente)
  let shortSupported = false;
  let firstShort: { student_id: string; code: string } | null = null;

  if (preferShort && items.length) {
    try {
      const it0 = items[0];
      const bulletinKey = computeBulletinKey({
        instId: opts.institutionId,
        classId: opts.classId,
        studentId: it0.student_id,
        academicYear,
        periodFrom: opts.periodMeta.from ?? null,
        periodTo: opts.periodMeta.to ?? null,
        periodLabel,
      });

      const code = await getOrCreateBulletinShortCode(srv, {
        bulletinKey,
        payload: {
          instId: opts.institutionId,
          classId: opts.classId,
          studentId: it0.student_id,
          academicYear,
          periodFrom: opts.periodMeta.from ?? null,
          periodTo: opts.periodMeta.to ?? null,
          periodLabel,
          periodShortLabel: opts.periodMeta.short_label ?? null,
          s: snapFor(it0),
        },
        expiresAt: null,
      });

      shortSupported = !!code;
      if (shortSupported) firstShort = { student_id: it0.student_id, code };
    } catch {
      shortSupported = false;
    }
  }

  // 2) Mode short si supporté
  if (shortSupported) {
    return await Promise.all(
      items.map(async (it) => {
        try {
          let code: string;

          if (firstShort && firstShort.student_id === it.student_id) {
            code = firstShort.code;
          } else {
            const bulletinKey = computeBulletinKey({
              instId: opts.institutionId,
              classId: opts.classId,
              studentId: it.student_id,
              academicYear,
              periodFrom: opts.periodMeta.from ?? null,
              periodTo: opts.periodMeta.to ?? null,
              periodLabel,
            });

            code = await getOrCreateBulletinShortCode(srv, {
              bulletinKey,
              payload: {
                instId: opts.institutionId,
                classId: opts.classId,
                studentId: it.student_id,
                academicYear,
                periodFrom: opts.periodMeta.from ?? null,
                periodTo: opts.periodMeta.to ?? null,
                periodLabel,
                periodShortLabel: opts.periodMeta.short_label ?? null,
                s: snapFor(it),
              },
              expiresAt: null,
            });
          }

          const url = code ? `${opts.origin}${BULLETIN_VERIFY_SHORT_PREFIX}/${code}` : null;

          return {
            ...it,
            qr_mode: code ? ("short" as const) : null,
            qr_code: code || null,
            qr_token: null,
            qr_url: url,
          };
        } catch {
          // fallback token (si possible)
          const token = signBulletinQRToken({
            instId: opts.institutionId,
            classId: opts.classId,
            studentId: it.student_id,
            academicYear,
            periodFrom: opts.periodMeta.from ?? null,
            periodTo: opts.periodMeta.to ?? null,
            periodLabel,
            periodShortLabel: opts.periodMeta.short_label ?? null,
            s: snapFor(it),
          });

          const url = token
            ? `${opts.origin}${BULLETIN_VERIFY_LEGACY_PATH}?t=${encodeURIComponent(token)}`
            : null;

          return {
            ...it,
            qr_mode: token ? ("token" as const) : null,
            qr_code: null,
            qr_token: token,
            qr_url: url,
          };
        }
      })
    );
  }

  // 3) Fallback token pour tous
  return items.map((it) => {
    const token = signBulletinQRToken({
      instId: opts.institutionId,
      classId: opts.classId,
      studentId: it.student_id,
      academicYear,
      periodFrom: opts.periodMeta.from ?? null,
      periodTo: opts.periodMeta.to ?? null,
      periodLabel,
    });

    const url = token
      ? `${opts.origin}${BULLETIN_VERIFY_LEGACY_PATH}?t=${encodeURIComponent(token)}`
      : null;

    return {
      ...it,
      qr_mode: token ? ("token" as const) : null,
      qr_code: null,
      qr_token: token,
      qr_url: url,
    };
  });
}

/* ───────── helper : récup user_roles + institution ───────── */
async function getAdminAndInstitution(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>
) {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "UNAUTHENTICATED" as const };
  }

  const { data: roleRow, error: roleErr } = await supabase
    .from("user_roles")
    .select("institution_id, role")
    .eq("profile_id", user.id)
    .in("role", ["admin", "super_admin"])
    .limit(1)
    .maybeSingle();

  if (roleErr || !roleRow) {
    return { error: "PROFILE_NOT_FOUND" as const };
  }

  const role = roleRow.role as Role;
  if (!["super_admin", "admin"].includes(role)) {
    return { error: "FORBIDDEN" as const };
  }

  const institutionId = roleRow.institution_id;
  if (!institutionId) {
    return { error: "NO_INSTITUTION" as const };
  }

  return { user, institutionId, role };
}

/* ───────── helper : rang par matière (subject_rank) ───────── */
function applySubjectRanks(items: any[]) {
  if (!items || !items.length) return;

  type Entry = { index: number; avg: number; subject_id: string };
  const bySubject = new Map<string, Entry[]>();

  items.forEach((item, idx) => {
    const perSubject = item.per_subject as any[] | undefined;
    if (!Array.isArray(perSubject)) return;

    perSubject.forEach((ps) => {
      const avg =
        typeof ps.avg20 === "number" && Number.isFinite(ps.avg20) ? ps.avg20 : null;
      const sid = ps.subject_id as string | undefined;
      if (!sid || avg === null) return;

      const arr = bySubject.get(sid) || [];
      arr.push({ index: idx, avg, subject_id: sid });
      bySubject.set(sid, arr);
    });
  });

  bySubject.forEach((entries, subjectId) => {
    entries.sort((a, b) => b.avg - a.avg);

    let lastAvg: number | null = null;
    let currentRank = 0;
    let position = 0;

    for (const { index, avg } of entries) {
      position += 1;
      if (lastAvg === null || avg !== lastAvg) {
        currentRank = position;
        lastAvg = avg;
      }

      const perSubject = items[index].per_subject as any[];
      if (!Array.isArray(perSubject)) continue;

      const cell = perSubject.find((ps: any) => ps.subject_id === subjectId);
      if (cell) (cell as any).subject_rank = currentRank;
    }
  });
}

/* ───────── helper : rang par sous-matière (component_rank) ───────── */
function applySubjectComponentRanks(items: any[]) {
  if (!items || !items.length) return;

  type Entry = { index: number; avg: number; component_id: string };
  const byComponent = new Map<string, Entry[]>();

  items.forEach((item, idx) => {
    const perComp = item.per_subject_components as any[] | undefined;
    if (!Array.isArray(perComp)) return;

    perComp.forEach((psc) => {
      const avg =
        typeof psc.avg20 === "number" && Number.isFinite(psc.avg20) ? psc.avg20 : null;
      const cid = psc.component_id as string | undefined;
      if (!cid || avg === null) return;

      const arr = byComponent.get(cid) || [];
      arr.push({ index: idx, avg, component_id: cid });
      byComponent.set(cid, arr);
    });
  });

  byComponent.forEach((entries, componentId) => {
    entries.sort((a, b) => b.avg - a.avg);

    let lastAvg: number | null = null;
    let currentRank = 0;
    let position = 0;

    for (const { index, avg } of entries) {
      position += 1;
      if (lastAvg === null || avg !== lastAvg) {
        currentRank = position;
        lastAvg = avg;
      }

      const perComp = items[index].per_subject_components as any[] | undefined;
      if (!Array.isArray(perComp)) continue;

      const cell = perComp.find((psc: any) => psc.component_id === componentId);
      if (cell) (cell as any).component_rank = currentRank;
    }
  });
}

/* ───────── helper : base64 data url (node) ───────── */
async function blobToPngDataUrl(blob: any): Promise<string | null> {
  try {
    if (!blob || typeof blob.arrayBuffer !== "function") return null;
    const ab = await blob.arrayBuffer();
    const b64 = Buffer.from(ab).toString("base64");
    if (!b64) return null;
    return `data:image/png;base64,${b64}`;
  } catch {
    return null;
  }
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* ───────── helper : signatures profs (data url) ───────── */
async function getTeacherSignaturesAsDataUrl(
  srv: SupabaseClient,
  institutionId: string,
  teacherIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(teacherIds.filter((x) => !!x && isUuid(x))));

  if (!unique.length) return out;

  const { data: sigRows, error: sigErr } = await srv
    .from("teacher_signatures")
    .select("teacher_id, storage_path")
    .eq("institution_id", institutionId)
    .in("teacher_id", unique);

  if (sigErr || !sigRows?.length) return out;

  const rows = (sigRows as any[])
    .map((r) => ({
      teacher_id: String(r.teacher_id || ""),
      storage_path: String(r.storage_path || ""),
    }))
    .filter((r) => isUuid(r.teacher_id) && r.storage_path);

  if (!rows.length) return out;

  // ⚠️ éviter trop de downloads en parallèle
  for (const pack of chunk(rows, 8)) {
    await Promise.all(
      pack.map(async (r) => {
        try {
          const { data, error } = await srv.storage.from("signatures").download(r.storage_path);
          if (error || !data) return;
          const url = await blobToPngDataUrl(data);
          if (!url) return;
          out.set(r.teacher_id, url);
        } catch {
          // ignore
        }
      })
    );
  }

  return out;
}

/* ───────── helper : prof par matière + teacher_id + teacher_name ───────── */
async function attachTeachersToSubjects(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  srv: Awaited<ReturnType<typeof getSupabaseServiceClient>>,
  items: any[],
  evals: EvalRow[],
  subjectIds: string[],
  institutionId: string,
  classId: string,
  dateFrom?: string | null,
  dateTo?: string | null
) {
  if (!items.length || !subjectIds.length) return;

  // ✅ subject -> teacher_id
  const teacherIdBySubject = new Map<string, string>();
  const lastEvalDateBySubject = new Map<string, string>();

  /* ── A. Priorité : grade_evaluations.teacher_id (dernière date) ── */
  if (evals.length) {
    for (const ev of evals) {
      if (!ev.subject_id || !ev.teacher_id) continue;
      const sid = String(ev.subject_id);
      const tid = String(ev.teacher_id);
      const date = String(ev.eval_date || "");

      const prev = lastEvalDateBySubject.get(sid) || "";
      if (!prev || (date && date > prev)) {
        lastEvalDateBySubject.set(sid, date);
        teacherIdBySubject.set(sid, tid);
      }
    }
  }

  /* ── B. Fallback : institution_subjects + class_teachers ── */
  const missingSubjectIds = subjectIds.filter((sid) => !teacherIdBySubject.has(sid));

  if (missingSubjectIds.length) {
    const { data: instSubs, error: instErr } = await srv
      .from("institution_subjects")
      .select("id, subject_id")
      .eq("institution_id", institutionId)
      .in("subject_id", missingSubjectIds);

    if (!instErr && instSubs?.length) {
      const instIds: string[] = [];
      const subjectIdByInstId = new Map<string, string>();

      (instSubs as any[]).forEach((row) => {
        const sid = String(row.subject_id || "");
        const instId = String(row.id || "");
        if (!sid || !instId) return;
        instIds.push(instId);
        subjectIdByInstId.set(instId, sid);
      });

      if (instIds.length) {
        let ctQuery = srv
          .from("class_teachers")
          .select("subject_id, teacher_id, start_date, end_date")
          .eq("institution_id", institutionId)
          .eq("class_id", classId)
          .in("subject_id", instIds);

        const pivot = dateTo || dateFrom || null;
        if (pivot) {
          ctQuery = ctQuery
            .or(`end_date.is.null,end_date.gte.${pivot}`)
            .or(`start_date.is.null,start_date.lte.${pivot}`);
        } else {
          ctQuery = ctQuery.is("end_date", null);
        }

        const { data: ctData, error: ctErr } = await ctQuery;

        if (!ctErr && ctData?.length) {
          // on trie pour privilégier l'affectation la plus récente
          const rows = (ctData as any[]).slice().sort((a, b) => {
            const asd = String(a.start_date || "");
            const bsd = String(b.start_date || "");
            return bsd.localeCompare(asd);
          });

          for (const row of rows) {
            const instSubId = String(row.subject_id || "");
            const sid = subjectIdByInstId.get(instSubId);
            const tid = row.teacher_id ? String(row.teacher_id) : "";
            if (!sid || !tid) continue;
            if (teacherIdBySubject.has(sid)) continue;
            teacherIdBySubject.set(sid, tid);
          }
        }
      }
    }
  }

  if (!teacherIdBySubject.size) return;

  const teacherIds = Array.from(new Set(Array.from(teacherIdBySubject.values()).filter((x) => !!x)));
  const nameById = new Map<string, string>();

  if (teacherIds.length) {
    const { data: profs, error: profErr } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", teacherIds);

    if (!profErr && profs?.length) {
      (profs as any[]).forEach((p) => {
        const id = String(p.id || "");
        const dn = String(p.display_name || "").trim();
        if (id && dn) nameById.set(id, dn);
      });
    }
  }

  for (const item of items) {
    const perSubject = item.per_subject as any[] | undefined;
    if (!Array.isArray(perSubject)) continue;

    perSubject.forEach((ps) => {
      const sid = ps.subject_id as string | undefined;
      if (!sid) return;

      const tid = teacherIdBySubject.get(sid) ?? null;
      const tname = tid ? nameById.get(tid) ?? null : null;

      (ps as any).teacher_id = tid;
      (ps as any).teacher_name = tname;
    });
  }
}

/* ───────── fallback bilans (si pas de config DB) ───────── */

function buildFallbackGroups(opts: {
  subjectIds: string[];
  subjectInfoById: Map<string, { name: string; code: string }>;
  coeffBySubject: Map<string, { coeff: number; include: boolean }>;
}): BulletinSubjectGroup[] {
  const { subjectIds, subjectInfoById, coeffBySubject } = opts;

  const letters: string[] = [];
  const sciences: string[] = [];
  const autres: string[] = [];

  for (const sid of subjectIds) {
    const meta = subjectInfoById.get(sid) || { name: "", code: "" };
    const name = meta.name;
    const code = meta.code;

    // ✅ Règle blindée : AUTRES = tout ce qui n'est pas LETTRES et pas SCIENCES
    if (isScienceSubject(name, code)) sciences.push(sid);
    else if (isLettersSubject(name, code)) letters.push(sid);
    else autres.push(sid);
  }

  const mkGroup = (p: {
    id: string;
    code: string;
    label: string;
    order_index: number;
    sids: string[];
  }): BulletinSubjectGroup => {
    const items: BulletinSubjectGroupItem[] = p.sids.map((sid, idx) => {
      const meta = subjectInfoById.get(sid) || { name: "", code: "" };
      const subjectName = meta.name || meta.code || "Matière";
      return {
        id: `virt-${p.code}-${sid}`,
        group_id: p.id,
        subject_id: sid,
        subject_name: subjectName,
        order_index: idx + 1,
        subject_coeff_override: null,
        is_optional: false,
      };
    });

    // annual_coeff = somme des coeffs des matières du groupe (logique "bulletin officiel")
    let sumCoeff = 0;
    for (const sid of p.sids) {
      const info = coeffBySubject.get(sid);
      const c = info ? Number(info.coeff ?? 1) : 1;
      if (Number.isFinite(c) && c > 0) sumCoeff += c;
    }

    return {
      id: p.id,
      code: p.code,
      label: p.label,
      short_label: null,
      order_index: p.order_index,
      is_active: true,
      annual_coeff: cleanCoeff(sumCoeff || 1),
      items,
    };
  };

  const groups: BulletinSubjectGroup[] = [
    mkGroup({
      id: "fallback-letters",
      code: "BILAN_LETTRES",
      label: "BILAN LETTRES",
      order_index: 1,
      sids: letters,
    }),
    mkGroup({
      id: "fallback-sciences",
      code: "BILAN_SCIENCES",
      label: "BILAN SCIENCES",
      order_index: 2,
      sids: sciences,
    }),
    mkGroup({
      id: "fallback-autres",
      code: "BILAN_AUTRES",
      label: "BILAN AUTRES",
      order_index: 3,
      sids: autres,
    }),
  ];

  // On supprime les groupes vides (mais on garde l’ordre)
  return groups.filter((g) => g.items.length > 0);
}

/* ───────── helper annuel : rang avec ex aequo ───────── */
function buildRankMapFromAverageMap(avgByStudent: Map<string, number | null>) {
  const rows: { student_id: string; avg: number }[] = [];
  for (const [sid, avg] of avgByStudent.entries()) {
    if (typeof avg === "number" && Number.isFinite(avg)) rows.push({ student_id: sid, avg });
  }
  rows.sort((a, b) => b.avg - a.avg);

  const rankByStudent = new Map<string, number>();
  let lastAvg: number | null = null;
  let currentRank = 0;
  let position = 0;

  for (const r of rows) {
    position += 1;
    if (lastAvg === null || r.avg !== lastAvg) {
      currentRank = position;
      lastAvg = r.avg;
    }
    rankByStudent.set(r.student_id, currentRank);
  }

  return rankByStudent;
}

/* ───────── GET /api/admin/grades/bulletin ───────── */
export async function GET(req: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const srvClient = srv as unknown as SupabaseClient;

  const ctx = await getAdminAndInstitution(supabase);

  if ("error" in ctx) {
    const status =
      ctx.error === "UNAUTHENTICATED"
        ? 401
        : ctx.error === "FORBIDDEN"
        ? 403
        : 400;
    return NextResponse.json({ ok: false, error: ctx.error }, { status });
  }

  const { institutionId } = ctx;

  const { searchParams } = new URL(req.url);
  const classId = searchParams.get("class_id");
  const dateFrom = searchParams.get("from");
  const dateTo = searchParams.get("to");

  if (!classId) {
    return NextResponse.json({ ok: false, error: "MISSING_CLASS_ID" }, { status: 400 });
  }

  // ✅ class_id non-null (utile dans les closures)
  const classIdStr: string = classId;

  // ✅ origin PUBLIC (anti localhost)
  const origin = pickPublicOrigin(req.nextUrl.origin);

  // ✅ QR considéré "activable" si on peut faire short (service role) ou token (secret)
  const qrEnabled = !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.BULLETIN_QR_SECRET);
  const qrMode = String(process.env.BULLETIN_QR_MODE || "short").toLowerCase();

  /* 1) Vérifier que la classe appartient à l'établissement + récupérer prof principal */
  const { data: cls, error: clsErr } = await supabase
    .from("classes")
    .select("id, label, code, institution_id, academic_year, head_teacher_id, level")
    .eq("id", classId)
    .maybeSingle();

  if (clsErr) {
    return NextResponse.json({ ok: false, error: "CLASS_ERROR" }, { status: 500 });
  }
  if (!cls) {
    return NextResponse.json({ ok: false, error: "CLASS_NOT_FOUND" }, { status: 404 });
  }

  const classRow = cls as ClassRow;

  if (!classRow.institution_id) {
    return NextResponse.json({ ok: false, error: "CLASS_NO_INSTITUTION" }, { status: 400 });
  }
  if (classRow.institution_id !== institutionId) {
    return NextResponse.json({ ok: false, error: "CLASS_FORBIDDEN" }, { status: 403 });
  }

  const bulletinLevel = normalizeBulletinLevel(classRow.level);

  /* ✅ lire l'option établissement : bulletin_signatures_enabled (institutions) */
  let bulletinSignaturesEnabled = false;
  {
    const { data: instRow } = await srvClient
      .from("institutions")
      .select("bulletin_signatures_enabled, settings_json")
      .eq("id", institutionId)
      .maybeSingle();

    const col = (instRow as any)?.bulletin_signatures_enabled;
    if (typeof col === "boolean") bulletinSignaturesEnabled = col;
    else
      bulletinSignaturesEnabled = Boolean(
        (instRow as any)?.settings_json?.bulletin_signatures_enabled ?? false
      );
  }

  // 1a) Lookup du professeur principal (facultatif)
  let headTeacher: HeadTeacherRow | null = null;
  if (classRow.head_teacher_id) {
    const { data: ht, error: htErr } = await supabase
      .from("profiles")
      .select("id, display_name, phone, email")
      .eq("id", classRow.head_teacher_id)
      .maybeSingle();

    if (htErr) {
      // ignore
    } else if (ht) headTeacher = ht as HeadTeacherRow;
  }

  /* 1bis) Retrouver éventuellement la période de bulletin (grade_periods) + son coeff */
  let periodMeta: {
    from: string | null;
    to: string | null;
    code?: string | null;
    label?: string | null;
    short_label?: string | null;
    academic_year?: string | null;
    coeff?: number | null;
  } = { from: dateFrom, to: dateTo };

  if (dateFrom && dateTo) {
    // ⚠️ évite maybeSingle() (erreur si doublons) -> on prend le 1er match
    const { data: gpRows, error: gpErr } = await supabase
      .from("grade_periods")
      .select("id, academic_year, code, label, short_label, start_date, end_date, coeff")
      .eq("institution_id", institutionId)
      .eq("start_date", dateFrom)
      .eq("end_date", dateTo)
      .order("start_date", { ascending: true })
      .limit(1);

    const gp = (gpRows && gpRows.length ? (gpRows[0] as any) : null) as any;

    if (gpErr) {
      // ignore
    } else if (gp) {
      periodMeta = {
        from: dateFrom,
        to: dateTo,
        code: gp.code ?? null,
        label: gp.label ?? null,
        short_label: gp.short_label ?? null,
        academic_year: gp.academic_year ?? null,
        coeff: gp.coeff === null || gp.coeff === undefined ? null : cleanCoeff(gp.coeff),
      };
    }
  }

  /* ✅ 1ter) Déterminer dernière période + flags (annual only on last) */
  const academicYearForPeriods = periodMeta.academic_year ?? classRow.academic_year ?? null;

  let periodsForYear: GradePeriodRow[] = [];
  let periodsDefined = false;
  let lastPeriod: GradePeriodRow | null = null;
  let isLastPeriod = false;

  {
    let q = supabase
      .from("grade_periods")
      .select("id, academic_year, code, label, short_label, start_date, end_date, coeff")
      .eq("institution_id", institutionId);

    if (academicYearForPeriods) q = q.eq("academic_year", academicYearForPeriods);

    const { data: pData, error: pErr } = await q.order("start_date", { ascending: true });

    if (!pErr && pData?.length) {
      periodsForYear = (pData as any[]) as GradePeriodRow[];
      periodsDefined = periodsForYear.length > 0;

      // dernier = max end_date (fallback start_date)
      const sorted = periodsForYear.slice().sort((a, b) => {
        const ae = String(a.end_date || "");
        const be = String(b.end_date || "");
        if (ae !== be) return ae.localeCompare(be);
        const asd = String(a.start_date || "");
        const bsd = String(b.start_date || "");
        return asd.localeCompare(bsd);
      });

      lastPeriod = sorted.length ? sorted[sorted.length - 1] : null;

      isLastPeriod =
        !!lastPeriod &&
        !!dateFrom &&
        !!dateTo &&
        String(lastPeriod.start_date) === String(dateFrom) &&
        String(lastPeriod.end_date) === String(dateTo);
    }
  }

  const periodResponse = {
    ...periodMeta,
    periods_defined: periodsDefined,
    is_last: isLastPeriod,
    last_period: lastPeriod
      ? {
          from: lastPeriod.start_date,
          to: lastPeriod.end_date,
          code: lastPeriod.code ?? null,
          label: lastPeriod.label ?? null,
          short_label: lastPeriod.short_label ?? null,
          academic_year: lastPeriod.academic_year ?? academicYearForPeriods ?? null,
          coeff:
            lastPeriod.coeff === null || lastPeriod.coeff === undefined
              ? null
              : cleanCoeff(lastPeriod.coeff),
        }
      : null,
  };

  /* 2) Récupérer les élèves */
  const hasDateFilter = !!dateFrom || !!dateTo;

  let enrollQuery = supabase
    .from("class_enrollments")
    .select(
      `
      student_id,
      students(
        matricule,
        first_name,
        last_name,
        full_name,
        photo_url,
        gender,
        birthdate,
        birth_place,
        nationality,
        regime,
        is_repeater,
        is_boarder,
        is_affecte
      )
    `
    )
    .eq("class_id", classId);

  if (!hasDateFilter) enrollQuery = enrollQuery.is("end_date", null);
  else if (dateFrom) enrollQuery = enrollQuery.or(`end_date.gte.${dateFrom},end_date.is.null`);

  enrollQuery = enrollQuery.order("student_id", { ascending: true });

  const { data: csData, error: csErr } = await enrollQuery;

  if (csErr) {
    return NextResponse.json({ ok: false, error: "CLASS_STUDENTS_ERROR" }, { status: 500 });
  }

  const classStudents = (csData || []) as ClassStudentRow[];
  const studentIds = classStudents.map((cs) => cs.student_id);

  // Si aucun élève : on renvoie structure minimale (non cassant)
  if (!classStudents.length) {
    return NextResponse.json({
      ok: true,
      qr: {
        enabled: qrEnabled,
        mode: qrMode,
        verify_path: BULLETIN_VERIFY_SHORT_PREFIX,
        legacy_verify_path: BULLETIN_VERIFY_LEGACY_PATH,
      },
      signatures: { enabled: bulletinSignaturesEnabled },
      class: {
        id: classRow.id,
        label: classRow.label || classRow.code || "Classe",
        code: classRow.code || null,
        academic_year: classRow.academic_year || null,
        level: classRow.level || null,
        bulletin_level: bulletinLevel,
        head_teacher: headTeacher
          ? {
              id: headTeacher.id,
              display_name: headTeacher.display_name || null,
              phone: headTeacher.phone || null,
              email: headTeacher.email || null,
            }
          : null,
      },
      period: periodResponse,
      subjects: [],
      subject_groups: [],
      subject_components: [],
      items: [],
    });
  }

  /* ───────── Conduite (coef 1) — helpers ───────── */
  const clamp20 = (n: number) => Math.max(0, Math.min(20, n));

  async function fetchConductAverageMap(
    from: string,
    to: string
  ): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    studentIds.forEach((sid) => out.set(sid, null));

    try {
      const qs = new URLSearchParams({ class_id: classIdStr, from, to });
      const cookie = req.headers.get("cookie") ?? "";

      const r = await fetch(
        `${req.nextUrl.origin}/api/admin/conduite/averages?${qs.toString()}`,
        {
          method: "GET",
          headers: cookie ? { cookie } : {},
          cache: "no-store",
        }
      );

      if (!r.ok) return out;

      const j: any = await r.json();

      // tolère plusieurs shapes: {items:[...]}, {data:[...]} ou tableau direct
      const arr: any[] = Array.isArray(j)
        ? j
        : Array.isArray(j?.items)
          ? j.items
          : Array.isArray(j?.data)
            ? j.data
            : [];

      for (const it of arr) {
        const sid = String(it?.student_id ?? "");
        if (!sid) continue;

        // "total" attendu (note /20). On accepte aussi "avg" ou "value" si présent.
        const raw =
          it?.total ?? it?.avg ?? it?.value ?? it?.score ?? it?.note ?? null;

        const total = Number(raw);
        if (!Number.isFinite(total)) continue;

        out.set(sid, clamp20(total));
      }
    } catch {
      // ne casse jamais le bulletin si la conduite échoue
    }

    return out;
  }

  /* 3) Coefficients bulletin par matière (on les charge même s'il n'y a pas d'évals) */
  let coeffAllQuery = supabase
    .from("institution_subject_coeffs")
    .select("subject_id, coeff, include_in_average, level")
    .eq("institution_id", institutionId);

  if (bulletinLevel) coeffAllQuery = coeffAllQuery.eq("level", bulletinLevel);

  const { data: coeffAllData, error: coeffAllErr } = await coeffAllQuery;
  if (coeffAllErr) {
    // ignore
  }

  const coeffBySubject = new Map<string, { coeff: number; include: boolean }>();
  const subjectIdsFromConfig = new Set<string>();

  for (const row of (coeffAllData || []) as SubjectCoeffRow[]) {
    const sid = String(row.subject_id || "");
    if (!sid || !isUuid(sid)) continue;
    subjectIdsFromConfig.add(sid);
    coeffBySubject.set(sid, {
      coeff: cleanCoeff(row.coeff),
      include: row.include_in_average !== false,
    });
  }

  /* 4) Evaluations publiées (peut être vide) */
  let evals: EvalRow[] = [];
  {
    let evalQuery = supabase
      .from("grade_evaluations")
      .select(
        "id, class_id, subject_id, teacher_id, eval_date, scale, coeff, is_published, subject_component_id"
      )
      .eq("class_id", classId)
      .eq("is_published", true);

    if (dateFrom) evalQuery = evalQuery.gte("eval_date", dateFrom);
    if (dateTo) evalQuery = evalQuery.lte("eval_date", dateTo);

    const { data: evalData, error: evalErr } = await evalQuery;

    if (evalErr) {
      return NextResponse.json({ ok: false, error: "EVALUATIONS_ERROR" }, { status: 500 });
    }

    evals = (evalData || []) as EvalRow[];
  }

  // sujets vus dans les évaluations
  const subjectIdSet = new Set<string>();
  for (const e of evals) if (e.subject_id) subjectIdSet.add(String(e.subject_id));

  // ✅ union: config coeffs + sujets des évaluations (pour ne pas “oublier” une matière)
  const subjectIdsUnionRaw = Array.from(
    new Set([...Array.from(subjectIdsFromConfig), ...Array.from(subjectIdSet)])
  );
  const subjectIds = subjectIdsUnionRaw.filter((sid) => isUuid(sid));

  // Si aucune matière trouvée (ni coeffs ni évals)
  if (!subjectIds.length) {
    const baseItems = classStudents.map((cs) => {
      const stu = cs.students || {};
      const fullName =
        stu.full_name || [stu.last_name, stu.first_name].filter(Boolean).join(" ") || "Élève";
      return {
        student_id: cs.student_id,
        full_name: fullName,
        matricule: stu.matricule || null,
        photo_url: stu.photo_url || null,
        gender: stu.gender || null,
        birth_date: stu.birthdate || null,
        birth_place: stu.birth_place || null,
        nationality: stu.nationality || null,
        regime: stu.regime || null,
        is_repeater: stu.is_repeater ?? null,
        is_boarder: stu.is_boarder ?? null,
        is_affecte: stu.is_affecte ?? null,
        per_subject: [],
        per_group: [],
        general_avg: null,
        per_subject_components: [],
        annual_avg: null as number | null,
        annual_rank: null as number | null,
      };
    });

    const itemsWithQr = await addQrToItems(srvClient, baseItems, {
      origin,
      institutionId,
      classId: classRow.id,
      classAcademicYear: classRow.academic_year ?? null,
      periodMeta: {
        from: periodMeta.from ?? null,
        to: periodMeta.to ?? null,
        code: periodMeta.code ?? null,
        label: periodMeta.label ?? null,
        short_label: periodMeta.short_label ?? null,
        academic_year: periodMeta.academic_year ?? null,
      },
    });

    const itemsWithQrPng = await attachQrPng(itemsWithQr);

    return NextResponse.json({
      ok: true,
      qr: {
        enabled: qrEnabled,
        mode: qrMode,
        verify_path: BULLETIN_VERIFY_SHORT_PREFIX,
        legacy_verify_path: BULLETIN_VERIFY_LEGACY_PATH,
      },
      signatures: { enabled: bulletinSignaturesEnabled },
      class: {
        id: classRow.id,
        label: classRow.label || classRow.code || "Classe",
        code: classRow.code || null,
        academic_year: classRow.academic_year || null,
        level: classRow.level || null,
        bulletin_level: bulletinLevel,
        head_teacher: headTeacher
          ? {
              id: headTeacher.id,
              display_name: headTeacher.display_name || null,
              phone: headTeacher.phone || null,
              email: headTeacher.email || null,
            }
          : null,
      },
      period: periodResponse,
      subjects: [],
      subject_groups: [],
      subject_components: [],
      items: itemsWithQrPng,
    });
  }

  /* 5) Noms/code matières (service client) */
  const { data: subjData, error: subjErr } = await srv
    .from("subjects")
    .select("id, name, code")
    .in("id", subjectIds)
    .order("name", { ascending: true });

  if (subjErr) {
    return NextResponse.json({ ok: false, error: "SUBJECTS_ERROR" }, { status: 500 });
  }

  const subjects = (subjData || []) as SubjectRow[];
  const subjectById = new Map<string, SubjectRow>();
  for (const s of subjects) subjectById.set(s.id, s);

  const isConductSubjectId = (subjectId: string): boolean => {
    const meta = subjectById.get(String(subjectId));
    const key = `${meta?.code ?? ""} ${meta?.name ?? ""}`.toLowerCase();
    return key.includes("conduite") || key.includes("conduct");
  };

  // ordre final des matières (par nom)
  const orderedSubjectIds = subjects.map((s) => s.id).filter((sid) => isUuid(sid));

  /* 6) Liste matières pour le bulletin */
  const subjectsForReport = orderedSubjectIds.map((sid) => {
    const s = subjectById.get(sid);
    const name = s?.name || s?.code || "Matière";
    const info = coeffBySubject.get(sid);
    const coeffBulletin = info ? info.coeff : 1;
    const includeInAverage = info ? info.include : true;

    return {
      subject_id: sid,
      subject_name: name,
      coeff_bulletin: coeffBulletin,
      include_in_average: includeInAverage,
    };
  });

  // ✅ Forcer la matière "Conduite" à être comptée dans la moyenne générale
  // (certaines configurations peuvent l'exclure par erreur)
  for (const s of subjectsForReport as any[]) {
    const meta = subjectById.get(String(s.subject_id));
    const key = `${meta?.code ?? ""} ${meta?.name ?? ""}`.toLowerCase();
    if (key.includes("conduite") || key.includes("conduct")) {
      s.include_in_average = true;
      const c = Number(s.coeff_bulletin ?? 0);
      if (!c || c <= 0) s.coeff_bulletin = 1;
    }
  }

  /* 6bis) Sous-matières */
  let subjectComponentsForReport: BulletinSubjectComponent[] = [];
  const subjectComponentById = new Map<string, BulletinSubjectComponent>();
  const compsBySubject = new Map<string, BulletinSubjectComponent[]>();

  const { data: compData, error: compErr } = await srv
    .from("grade_subject_components")
    .select("id, subject_id, label, short_label, coeff_in_subject, order_index, is_active")
    .eq("institution_id", institutionId)
    .in("subject_id", orderedSubjectIds);

  if (compErr) {
    // ignore
  } else {
    const rows = (compData || [])
      .filter((r: any) => r.is_active !== false)
      .map((r: any) => {
        const coeff =
          r.coeff_in_subject !== null && r.coeff_in_subject !== undefined
            ? Number(r.coeff_in_subject)
            : 1;
        const ord =
          r.order_index !== null && r.order_index !== undefined ? Number(r.order_index) : 1;

        const obj: BulletinSubjectComponent = {
          id: String(r.id),
          subject_id: String(r.subject_id),
          label: (r.label as string) || "Sous-matière",
          short_label: r.short_label ? String(r.short_label) : null,
          coeff_in_subject: cleanCoeff(coeff),
          order_index: ord,
        };
        return obj;
      }) as BulletinSubjectComponent[];

    rows.sort((a, b) => {
      if (a.subject_id !== b.subject_id) return a.subject_id.localeCompare(b.subject_id);
      return a.order_index - b.order_index;
    });

    subjectComponentsForReport = rows;
    rows.forEach((c) => {
      subjectComponentById.set(c.id, c);
      const arr = compsBySubject.get(c.subject_id) || [];
      arr.push(c);
      compsBySubject.set(c.subject_id, arr);
    });
  }

  /* 6ter) Groupes (BILAN LETTRES / SCIENCES / AUTRES) */
  let subjectGroups: BulletinSubjectGroup[] = [];
  let groupedSubjectIds = new Set<string>();

  const subjectInfoById = new Map<string, { name: string; code: string }>();
  subjects.forEach((s) =>
    subjectInfoById.set(s.id, { name: s.name ?? "", code: s.code ?? "" })
  );

  // ⚙️ (A) essayer d'abord la config DB si niveau normalisé
  if (bulletinLevel) {
    const { data: groupsData, error: groupsErr } = await srv
      .from("bulletin_subject_groups")
      .select("id, level, label, order_index, is_active, code, short_label, annual_coeff")
      .eq("institution_id", institutionId)
      .eq("level", bulletinLevel)
      .order("order_index", { ascending: true });

    if (groupsErr) {
      // ignore
    } else if (groupsData && groupsData.length) {
      const activeGroups = (groupsData as any[]).filter((g) => g.is_active !== false);

      if (activeGroups.length) {
        const groupIds = activeGroups.map((g) => String(g.id));

        const { data: itemsData, error: itemsErr } = await srv
          .from("bulletin_subject_group_items")
          .select("id, group_id, subject_id, created_at")
          .in("group_id", groupIds);

        if (itemsErr) {
          // ignore
        }

        const rawItems = (itemsData || []) as any[];

        rawItems.sort((a, b) => {
          const ag = String(a.group_id || "");
          const bg = String(b.group_id || "");
          if (ag !== bg) return ag.localeCompare(bg);
          const ac = String(a.created_at || "");
          const bc = String(b.created_at || "");
          return ac.localeCompare(bc);
        });

        const itemsByGroup = new Map<string, any[]>();
        rawItems.forEach((row) => {
          const gId = String(row.group_id);
          const arr = itemsByGroup.get(gId) || [];
          arr.push(row);
          itemsByGroup.set(gId, arr);
        });

        const builtGroups: BulletinSubjectGroup[] = activeGroups.map((g: any) => {
          const rows = itemsByGroup.get(String(g.id)) || [];
          const items: BulletinSubjectGroupItem[] = rows.flatMap((row: any, idx: number) => {
            const sid = row.subject_id ? String(row.subject_id) : "";
            if (!sid || !isUuid(sid)) return [];
            if (!orderedSubjectIds.includes(sid)) return []; // éviter matières hors bulletin

            const meta = subjectInfoById.get(sid) || { name: "", code: "" };
            const subjectName = meta.name || meta.code || "Matière";

            return [
              {
                id: String(row.id),
                group_id: String(row.group_id),
                subject_id: sid,
                subject_name: String(subjectName),
                order_index: idx + 1,
                subject_coeff_override: null,
                is_optional: false,
              },
            ];
          });

          const annualCoeffRaw =
            g.annual_coeff !== null && g.annual_coeff !== undefined ? Number(g.annual_coeff) : 1;

          const groupCode =
            g.code && String(g.code).trim() !== "" ? String(g.code) : String(g.label);

          const shortLabel =
            g.short_label && String(g.short_label).trim() !== "" ? String(g.short_label) : null;

          return {
            id: String(g.id),
            code: groupCode,
            label: String(g.label),
            short_label: shortLabel,
            order_index: Number(g.order_index ?? 1),
            is_active: g.is_active !== false,
            annual_coeff: cleanCoeff(annualCoeffRaw),
            items,
          };
        });

        // ROUTAGE + ANTI-DOUBLONS + EPS=>AUTRES + PHILO=>LETTRES
        const gLetters = findGroupByMeaning(builtGroups, "LETTRES");
        const gSciences = findGroupByMeaning(builtGroups, "SCIENCES");
        const gAutres = findGroupByMeaning(builtGroups, "AUTRES");

        const chosenGroupIdBySubject = new Map<string, string>();
        const firstSeenOrder = new Map<string, number>();

        const groupOrder = builtGroups
          .slice()
          .sort((a, b) => a.order_index - b.order_index)
          .map((g) => g.id);

        const groupById = new Map<string, BulletinSubjectGroup>();
        builtGroups.forEach((g) => groupById.set(g.id, g));

        function desiredGroupIdForSubject(sid: string): string | null {
          const meta = subjectInfoById.get(sid) || { name: "", code: "" };
          const name = meta.name;
          const code = meta.code;

          // ✅ Règle blindée : AUTRES = complément de (LETTRES ∪ SCIENCES)
          if (isScienceSubject(name, code) && gSciences?.id) return gSciences.id;
          if (isLettersSubject(name, code) && gLetters?.id) return gLetters.id;

          // par défaut, tout le reste en AUTRES
          if (gAutres?.id) return gAutres.id;

          // fallback ultime (si un groupe manque en DB)
          return gLetters?.id ?? gSciences?.id ?? null;
        }

        // first seen
        for (const gid of groupOrder) {
          const g = groupById.get(gid);
          if (!g) continue;
          for (const it of g.items) {
            const sid = it.subject_id;
            if (!isUuid(sid)) continue;
            if (!firstSeenOrder.has(sid)) firstSeenOrder.set(sid, it.order_index);
            if (!chosenGroupIdBySubject.has(sid)) chosenGroupIdBySubject.set(sid, g.id);
          }
        }

        // forçages
        for (const sid of chosenGroupIdBySubject.keys()) {
          const desired = desiredGroupIdForSubject(sid);
          if (desired) chosenGroupIdBySubject.set(sid, desired);
        }

        // reconstruire
        const rebuilt = builtGroups.map((g) => ({ ...g, items: [] as BulletinSubjectGroupItem[] }));
        const rebuiltById = new Map<string, BulletinSubjectGroup>();
        rebuilt.forEach((g) => rebuiltById.set(g.id, g));

        for (const [sid, gid] of chosenGroupIdBySubject.entries()) {
          const target = rebuiltById.get(gid);
          if (!target) continue;

          const meta = subjectInfoById.get(sid) || { name: "", code: "" };
          const subjectName = meta.name || meta.code || "Matière";

          target.items.push({
            id: `virt-${sid}`,
            group_id: gid,
            subject_id: sid,
            subject_name: subjectName,
            order_index: firstSeenOrder.get(sid) ?? 9999,
            subject_coeff_override: null,
            is_optional: false,
          });
        }

        rebuilt.forEach((g) => {
          g.items.sort((a, b) => a.order_index - b.order_index);
          g.items = g.items.map((it, idx) => ({ ...it, order_index: idx + 1 }));
        });

        subjectGroups = rebuilt;

        groupedSubjectIds = new Set<string>();
        subjectGroups.forEach((g) => {
          g.items.forEach((it) => {
            if (orderedSubjectIds.includes(it.subject_id)) groupedSubjectIds.add(it.subject_id);
          });
        });
      }
    }
  }

  // ⚙️ (B) fallback auto : si aucune config DB exploitable => on fabrique bilans LETTRES/SCIENCES/AUTRES
  if (!subjectGroups.length) {
    subjectGroups = buildFallbackGroups({
      subjectIds: orderedSubjectIds,
      subjectInfoById,
      coeffBySubject,
    });

    groupedSubjectIds = new Set<string>();
    subjectGroups.forEach((g) => g.items.forEach((it) => groupedSubjectIds.add(it.subject_id)));
  }

  const hasGroupConfig = subjectGroups.length > 0;

  /* 7) Notes (si evals présentes) */
  const evalById = new Map<string, EvalRow>();
  for (const e of evals) evalById.set(e.id, e);

  let scores: ScoreRow[] = [];
  if (evals.length) {
    const evalIds = evals.map((e) => e.id);

    const { data: scoreData, error: scoreErr } = await supabase
      .from("student_grades")
      .select("evaluation_id, student_id, score")
      .in("evaluation_id", evalIds)
      .in("student_id", studentIds);

    if (scoreErr) {
      return NextResponse.json({ ok: false, error: "SCORES_ERROR" }, { status: 500 });
    }

    scores = (scoreData || []) as ScoreRow[];
  }

  /* 8) Maps calcul */
  const perStudentSubject = new Map<string, Map<string, { sumWeighted: number; sumCoeff: number }>>();

  const perStudentSubjectComponent = new Map<
    string,
    Map<string, { subject_id: string; sumWeighted: number; sumCoeff: number }>
  >();

  for (const sc of scores) {
    const ev = evalById.get(sc.evaluation_id);
    if (!ev) continue;
    if (!ev.subject_id) continue;
    if (!ev.scale || ev.scale <= 0) continue;
    if (sc.score === null || sc.score === undefined) continue;

    const score = Number(sc.score);
    if (!Number.isFinite(score)) continue;

    const norm20 = (score / ev.scale) * 20;
    const weight = ev.coeff ?? 1;

    let stuMap = perStudentSubject.get(sc.student_id);
    if (!stuMap) {
      stuMap = new Map();
      perStudentSubject.set(sc.student_id, stuMap);
    }
    const key = ev.subject_id;
    const cell = stuMap.get(key) || { sumWeighted: 0, sumCoeff: 0 };
    cell.sumWeighted += norm20 * weight;
    cell.sumCoeff += weight;
    stuMap.set(key, cell);

    if (ev.subject_component_id) {
      const comp = subjectComponentById.get(ev.subject_component_id);
      if (comp) {
        let stuCompMap = perStudentSubjectComponent.get(sc.student_id);
        if (!stuCompMap) {
          stuCompMap = new Map();
          perStudentSubjectComponent.set(sc.student_id, stuCompMap);
        }
        const compCell =
          stuCompMap.get(comp.id) || { subject_id: comp.subject_id, sumWeighted: 0, sumCoeff: 0 };
        compCell.sumWeighted += norm20 * weight;
        compCell.sumCoeff += weight;
        stuCompMap.set(comp.id, compCell);
      }
    }
  }

  /* 9) Construire la réponse (par élève) */

  // ✅ Conduite (coef 1) : on la récupère une seule fois pour la période demandée
  const conductAvgByStudent =
    dateFrom && dateTo ? await fetchConductAverageMap(String(dateFrom), String(dateTo)) : null;

  const items = classStudents.map((cs) => {
    const stu = cs.students || {};
    const fullName =
      stu.full_name || [stu.last_name, stu.first_name].filter(Boolean).join(" ") || "Élève";

    const stuMap =
      perStudentSubject.get(cs.student_id) ||
      new Map<string, { sumWeighted: number; sumCoeff: number }>();

    const stuCompMap =
      perStudentSubjectComponent.get(cs.student_id) ||
      new Map<string, { subject_id: string; sumWeighted: number; sumCoeff: number }>();

    // sous-matières
    const per_subject_components =
      subjectComponentsForReport.length === 0
        ? []
        : subjectComponentsForReport.map((comp) => {
            const cell = stuCompMap.get(comp.id);
            let avg20: number | null = null;
            if (cell && cell.sumCoeff > 0) {
              avg20 = cleanNumber(cell.sumWeighted / cell.sumCoeff, 4);
            }
            return {
              subject_id: comp.subject_id,
              component_id: comp.id,
              avg20,
            };
          });

    // matière: ✅ si elle a des composants, on recalcule avg depuis les sous-matières
    const per_subject = subjectsForReport.map((s) => {
      const comps = compsBySubject.get(s.subject_id) || [];

      let avg20: number | null = null;

      // ✅ priorité: calcul depuis sous-matières si au moins 1 sous-matière notée
      if (comps.length) {
        let sum = 0;
        let sumW = 0;

        for (const comp of comps) {
          const cell = stuCompMap.get(comp.id);
          if (!cell || cell.sumCoeff <= 0) continue;

          const compAvgRaw = cell.sumWeighted / cell.sumCoeff;
          if (!Number.isFinite(compAvgRaw)) continue;

          const w = comp.coeff_in_subject ?? 1;
          if (!w || w <= 0) continue;

          sum += compAvgRaw * w;
          sumW += w;
        }

        if (sumW > 0) {
          avg20 = cleanNumber(sum / sumW, 4);
        }
      }

      // fallback: calcul direct via évaluations de la matière
      if (avg20 === null) {
        const cell = stuMap.get(s.subject_id);
        if (cell && cell.sumCoeff > 0) {
          avg20 = cleanNumber(cell.sumWeighted / cell.sumCoeff, 4);
        }
      }

      return {
        subject_id: s.subject_id,
        avg20,

        // ✅ champs ajoutés (remplis plus bas par attachTeachersToSubjects + signatures)
        teacher_id: null as string | null,
        teacher_name: null as string | null,
        teacher_signature_png: null as string | null,
      };
    });

    // moyennes par bilan (pondérées par coeff bulletin des matières)
    let per_group:
      | {
          group_id: string;
          group_avg: number | null;
        }[] = [];

    if (hasGroupConfig) {
      const coeffBulletinBySubject = new Map<string, number>();
      subjectsForReport.forEach((s) =>
        coeffBulletinBySubject.set(s.subject_id, Number(s.coeff_bulletin ?? 1))
      );

      per_group = subjectGroups.map((g) => {
        let sum = 0;
        let sumCoeffLocal = 0;

        for (const it of g.items) {
          const sid = it.subject_id;

          const ps = (per_subject as any[]).find((x) => x.subject_id === sid);
          const subAvg = ps?.avg20 ?? null;
          if (subAvg === null || subAvg === undefined) continue;

          const w =
            it.subject_coeff_override !== null && it.subject_coeff_override !== undefined
              ? Number(it.subject_coeff_override)
              : coeffBulletinBySubject.get(sid) ?? 1;

          if (!w || w <= 0) continue;

          sum += Number(subAvg) * w;
          sumCoeffLocal += w;
        }

        const groupAvg = sumCoeffLocal > 0 ? cleanNumber(sum / sumCoeffLocal, 4) : null;

        return {
          group_id: g.id,
          group_avg: groupAvg,
        };
      });
    }

    // ✅ moyenne générale: uniquement matières (pas bilans)
    let general_avg: number | null = null;
    {
      let sumGen = 0;
      let sumCoeffGen = 0;
      let conductAlreadyCounted = false;

      for (const s of subjectsForReport) {
        if (s.include_in_average === false) continue;
        const coeffSub = Number(s.coeff_bulletin ?? 0);
        if (!coeffSub || coeffSub <= 0) continue;

        const ps = (per_subject as any[]).find((x) => x.subject_id === s.subject_id);
        const subAvg = ps?.avg20 ?? null;
        if (subAvg === null || subAvg === undefined) continue;

        const sn = String((s as any).subject_name ?? "").toLowerCase();
        const isConduct = sn.includes("conduite") || sn.includes("conduct");
        if (isConduct) conductAlreadyCounted = true;

        sumGen += Number(subAvg) * coeffSub;
        sumCoeffGen += coeffSub;
      }

      // ✅ Injecter la conduite coef 1 (si non déjà comptée comme "matière")
      if (!conductAlreadyCounted && conductAvgByStudent) {
        const c = conductAvgByStudent.get(cs.student_id);
        if (c !== null && c !== undefined && Number.isFinite(Number(c))) {
          sumGen += Number(c) * 1;
          sumCoeffGen += 1;
        }
      }

      general_avg = sumCoeffGen > 0 ? cleanNumber(sumGen / sumCoeffGen, 4) : null;
    }

    return {
      student_id: cs.student_id,
      full_name: fullName,
      matricule: stu.matricule || null,

      // ✅ photo (ajouté sans retirer quoi que ce soit)
      photo_url: stu.photo_url || null,

      gender: stu.gender || null,
      birth_date: stu.birthdate || null,
      birth_place: stu.birth_place || null,
      nationality: stu.nationality || null,
      regime: stu.regime || null,
      is_repeater: stu.is_repeater ?? null,
      is_boarder: stu.is_boarder ?? null,
      is_affecte: stu.is_affecte ?? null,
      per_subject,
      per_group,
      general_avg,
      per_subject_components,

      // ✅ annuel (rempli seulement si is_last)
      annual_avg: null as number | null,
      annual_rank: null as number | null,
    };
  });

  // Rang matière / sous-matière
  applySubjectRanks(items);
  applySubjectComponentRanks(items);

  // ✅ Professeurs par matière (même si evals vides : fallback class_teachers)
  await attachTeachersToSubjects(
    supabase,
    srv,
    items,
    evals,
    orderedSubjectIds,
    institutionId,
    classRow.id,
    dateFrom,
    dateTo
  );

  // ✅ Signatures (uniquement si option établissement activée)
  if (bulletinSignaturesEnabled) {
    const teacherIds: string[] = [];
    for (const it of items) {
      const ps = it.per_subject as any[] | undefined;
      if (!Array.isArray(ps)) continue;
      for (const cell of ps) {
        const tid = cell?.teacher_id ? String(cell.teacher_id) : "";
        if (tid && isUuid(tid)) teacherIds.push(tid);
      }
    }

    const sigMap = await getTeacherSignaturesAsDataUrl(srvClient, institutionId, teacherIds);

    for (const it of items) {
      const ps = it.per_subject as any[] | undefined;
      if (!Array.isArray(ps)) continue;

      for (const cell of ps) {
        const tid = cell?.teacher_id ? String(cell.teacher_id) : "";
        (cell as any).teacher_signature_png = tid ? sigMap.get(tid) ?? null : null;
      }
    }
  }

  /* ✅ 10) ANNUEL : calculer uniquement si périodes définies ET bulletin = dernière période */
  if (periodsDefined && isLastPeriod && periodsForYear.length) {
    // ✅ Pour l'annuel, il faut considérer les moyennes de CHAQUE trimestre (ou période),
    // en incluant toutes les matières réellement évaluées sur l'année.
    // Sinon, si le dernier trimestre ne contient que quelques matières, l'annuel est faussé.
    const yearFrom = String(periodsForYear[0]?.start_date ?? dateFrom ?? "");
    const yearTo = String(lastPeriod?.end_date ?? dateTo ?? "");

    // 1) Matières vues sur toute l'année (évaluations publiées)
    const annualSubjectIds = new Set<string>(subjectIds);
    if (yearFrom && yearTo) {
      const { data: yEvals, error: yErr } = await supabase
        .from("grade_evaluations")
        .select("subject_id")
        .eq("class_id", classId)
        .eq("is_published", true)
        .gte("eval_date", yearFrom)
        .lte("eval_date", yearTo);

      if (!yErr && yEvals?.length) {
        for (const r of yEvals as any[]) {
          const sid = r?.subject_id ? String(r.subject_id) : "";
          if (sid && isUuid(sid)) annualSubjectIds.add(sid);
        }
      }
    }

    // 2) Charger le nom/code pour les matières manquantes
    const annualOrderedSubjectIds = Array.from(annualSubjectIds).filter((sid) => isUuid(sid));
    const missingMetaIds = annualOrderedSubjectIds.filter((sid) => !subjectById.has(sid));
    if (missingMetaIds.length) {
      const { data: addSubj, error: addSubjErr } = await srv
        .from("subjects")
        .select("id, name, code")
        .in("id", missingMetaIds);

      if (!addSubjErr && addSubj?.length) {
        for (const s of addSubj as any[]) {
          subjectById.set(String(s.id), { id: String(s.id), name: s.name ?? null, code: s.code ?? null } as any);
        }
      }
    }

    // 3) Liste matières pour le calcul annuel (coeff bulletin + include)
    const annualSubjectsForReport = annualOrderedSubjectIds
      .map((sid) => {
        const s = subjectById.get(sid);
        const name = (s as any)?.name || (s as any)?.code || "Matière";
        const info = coeffBySubject.get(sid);
        const coeffBulletin = info ? info.coeff : 1;
        const includeInAverage = info ? info.include : true;

        return {
          subject_id: sid,
          subject_name: name,
          coeff_bulletin: coeffBulletin,
          include_in_average: includeInAverage,
        };
      })
      // tri alpha pour stabilité (nom puis id)
      .sort((a, b) => {
        const an = String(a.subject_name || "");
        const bn = String(b.subject_name || "");
        const c = an.localeCompare(bn, "fr", { sensitivity: "base" });
        if (c !== 0) return c;
        return String(a.subject_id).localeCompare(String(b.subject_id));
      });

    // ✅ Forcer Conduite incluse dans le calcul annuel
    for (const s of annualSubjectsForReport as any[]) {
      const meta = subjectById.get(String(s.subject_id));
      const key = `${(meta as any)?.code ?? ""} ${(meta as any)?.name ?? ""}`.toLowerCase();
      if (key.includes("conduite") || key.includes("conduct")) {
        s.include_in_average = true;
        const c = Number(s.coeff_bulletin ?? 0);
        if (!c || c <= 0) s.coeff_bulletin = 1;
      }
    }

    // 4) Étendre la liste des sous-matières pour le calcul annuel (si certaines matières n'apparaissent pas au dernier trimestre)
    const annualSubjectComponentById = new Map<string, BulletinSubjectComponent>(subjectComponentById);
    const annualCompsBySubject = new Map<string, BulletinSubjectComponent[]>();
    // seed existing compsBySubject
    compsBySubject.forEach((v, k) => annualCompsBySubject.set(k, v.slice()));

    if (annualOrderedSubjectIds.length) {
      const { data: addCompData, error: addCompErr } = await srv
        .from("grade_subject_components")
        .select("id, subject_id, label, short_label, coeff_in_subject, order_index, is_active")
        .eq("institution_id", institutionId)
        .in("subject_id", annualOrderedSubjectIds);

      if (!addCompErr && addCompData?.length) {
        for (const r of addCompData as any[]) {
          if (r.is_active === false) continue;

          const obj: BulletinSubjectComponent = {
            id: String(r.id),
            subject_id: String(r.subject_id),
            label: (r.label ?? r.short_label ?? "Sous-matière") as any,
            short_label: (r.short_label ?? null) as any,
            coeff_in_subject:
              r.coeff_in_subject !== null && r.coeff_in_subject !== undefined ? Number(r.coeff_in_subject) : 1,
            order_index: r.order_index !== null && r.order_index !== undefined ? Number(r.order_index) : 1,
          } as any;

          annualSubjectComponentById.set(obj.id, obj);

          const arr = annualCompsBySubject.get(obj.subject_id) || [];
          // éviter doublons
          if (!arr.find((x) => x.id === obj.id)) arr.push(obj);
          annualCompsBySubject.set(obj.subject_id, arr);
        }

        // tri interne
        annualCompsBySubject.forEach((arr) => {
          arr.sort((a, b) => (a.order_index ?? 1) - (b.order_index ?? 1));
        });
      }
    }

    // calc moyenne générale d'un élève sur une période
    const computeGeneralAvgMapForRange = async (
      from: string,
      to: string,
      subjectsList: { subject_id: string; coeff_bulletin: number | null; include_in_average: boolean }[],
      compsMap: Map<string, BulletinSubjectComponent[]>,
      compByIdMap: Map<string, BulletinSubjectComponent>,
      conductMap?: Map<string, number | null> | null
    ): Promise<Map<string, number | null>> => {
      const out = new Map<string, number | null>();
      studentIds.forEach((sid) => out.set(sid, null));

      const conductSubjectIds = new Set<string>();
      for (const s of subjectsList) {
        if (isConductSubjectId(String(s.subject_id))) conductSubjectIds.add(String(s.subject_id));
      }

      // evals publiées sur la période
      const { data: eData, error: eErr } = await supabase
        .from("grade_evaluations")
        .select("id, class_id, subject_id, teacher_id, eval_date, scale, coeff, is_published, subject_component_id")
        .eq("class_id", classId)
        .eq("is_published", true)
        .gte("eval_date", from)
        .lte("eval_date", to);

      if (eErr || !eData?.length) return out;

      const pevals = (eData as any[]) as EvalRow[];
      const evalMap = new Map<string, EvalRow>();
      pevals.forEach((ev) => evalMap.set(ev.id, ev));

      const evalIds = pevals.map((ev) => ev.id);

      const { data: sData, error: sErr } = await supabase
        .from("student_grades")
        .select("evaluation_id, student_id, score")
        .in("evaluation_id", evalIds)
        .in("student_id", studentIds);

      if (sErr || !sData?.length) return out;

      const pscores = (sData as any[]) as ScoreRow[];

      const perStuSub = new Map<string, Map<string, { sumWeighted: number; sumCoeff: number }>>();
      const perStuComp = new Map<
        string,
        Map<string, { subject_id: string; sumWeighted: number; sumCoeff: number }>
      >();

      for (const sc of pscores) {
        const ev = evalMap.get(sc.evaluation_id);
        if (!ev) continue;
        if (!ev.subject_id) continue;
        if (!ev.scale || ev.scale <= 0) continue;
        if (sc.score === null || sc.score === undefined) continue;

        const score = Number(sc.score);
        if (!Number.isFinite(score)) continue;

        const norm20 = (score / ev.scale) * 20;
        const weight = ev.coeff ?? 1;

        let sm = perStuSub.get(sc.student_id);
        if (!sm) {
          sm = new Map();
          perStuSub.set(sc.student_id, sm);
        }
        const cell = sm.get(ev.subject_id) || { sumWeighted: 0, sumCoeff: 0 };
        cell.sumWeighted += norm20 * weight;
        cell.sumCoeff += weight;
        sm.set(ev.subject_id, cell);

        if (ev.subject_component_id) {
          const comp = subjectComponentById.get(ev.subject_component_id);
          if (comp) {
            let cm = perStuComp.get(sc.student_id);
            if (!cm) {
              cm = new Map();
              perStuComp.set(sc.student_id, cm);
            }
            const ccell =
              cm.get(comp.id) || { subject_id: comp.subject_id, sumWeighted: 0, sumCoeff: 0 };
            ccell.sumWeighted += norm20 * weight;
            ccell.sumCoeff += weight;
            cm.set(comp.id, ccell);
          }
        }
      }

      // calc general avg pour chaque élève
      for (const sid of studentIds) {
        const sm = perStuSub.get(sid) || new Map();
        const cm = perStuComp.get(sid) || new Map();

        let sumGen = 0;
        let sumCoeffGen = 0;
        let conductAlreadyCounted = false;

        for (const s of subjectsList) {
          if (s.include_in_average === false) continue;
          const coeffSub = Number(s.coeff_bulletin ?? 0);
          if (!coeffSub || coeffSub <= 0) continue;

          const comps = compsMap.get(s.subject_id) || [];

          let subAvg: number | null = null;

          // priorité sous-matières si existantes et notées
          if (comps.length) {
            let sum = 0;
            let sumW = 0;

            for (const comp of comps) {
              const ccell = cm.get(comp.id);
              if (!ccell || ccell.sumCoeff <= 0) continue;

              const raw = ccell.sumWeighted / ccell.sumCoeff;
              if (!Number.isFinite(raw)) continue;

              const w = comp.coeff_in_subject ?? 1;
              if (!w || w <= 0) continue;

              sum += raw * w;
              sumW += w;
            }

            if (sumW > 0) subAvg = sum / sumW;
          }

          // fallback eval direct matière
          if (subAvg === null) {
            const cell = sm.get(s.subject_id);
            if (cell && cell.sumCoeff > 0) {
              subAvg = cell.sumWeighted / cell.sumCoeff;
            }
          }

          if (subAvg === null || subAvg === undefined) continue;
          if (!Number.isFinite(subAvg)) continue;

          if (conductSubjectIds.has(String(s.subject_id))) conductAlreadyCounted = true;

          sumGen += Number(subAvg) * coeffSub;
          sumCoeffGen += coeffSub;
        }

        // ✅ Injecter la conduite coef 1 (si non déjà comptée comme "matière")
        if (!conductAlreadyCounted && conductMap) {
          const c = conductMap.get(sid);
          if (c !== null && c !== undefined && Number.isFinite(Number(c))) {
            sumGen += Number(c) * 1;
            sumCoeffGen += 1;
          }
        }

        const g = sumCoeffGen > 0 ? cleanNumber(sumGen / sumCoeffGen, 4) : null;
        out.set(sid, g);
      }

      return out;
    };

    const annualAvgByStudent = new Map<string, number | null>();
    studentIds.forEach((sid) => annualAvgByStudent.set(sid, null));

    // ✅ calcule UNE fois par période (évite N_students × N_periods requêtes)
    const periodMaps: { w: number; map: Map<string, number | null> }[] = [];

    for (const p of periodsForYear) {
      const from = String(p.start_date);
      const to = String(p.end_date);
      const w =
        p.coeff === null || p.coeff === undefined ? 1 : Math.max(0, Number(p.coeff) || 0) || 1;

      const conductMapForPeriod = await fetchConductAverageMap(from, to);

      const map = await computeGeneralAvgMapForRange(
        from,
        to,
        annualSubjectsForReport,
        annualCompsBySubject,
        annualSubjectComponentById,
        conductMapForPeriod
      );
      periodMaps.push({ w, map });
    }

    for (const sid of studentIds) {
      let sum = 0;
      let sumW = 0;

      for (const pm of periodMaps) {
        const avg = pm.map.get(sid) ?? null;
        if (typeof avg === "number" && Number.isFinite(avg)) {
          sum += avg * pm.w;
          sumW += pm.w;
        }
      }

      const a = sumW > 0 ? cleanNumber(sum / sumW, 4) : null;
      annualAvgByStudent.set(sid, a);
    }

    const annualRankByStudent = buildRankMapFromAverageMap(annualAvgByStudent);

    for (const it of items) {
      const a = annualAvgByStudent.get(it.student_id) ?? null;
      const r = annualRankByStudent.get(it.student_id) ?? null;
      (it as any).annual_avg = a;
      (it as any).annual_rank = r;
    }
  } else {
    // cohérence: si pas dernier trimestre -> valeurs null
    for (const it of items) {
      (it as any).annual_avg = null;
      (it as any).annual_rank = null;
    }
  }

  // ✅ QR : URL courte /v/[code] (fallback token si besoin)
  const itemsWithQr = await addQrToItems(srvClient, items, {
    origin,
    institutionId,
    classId: classRow.id,
    classAcademicYear: classRow.academic_year ?? null,
    periodMeta: {
      from: periodMeta.from ?? null,
      to: periodMeta.to ?? null,
      code: periodMeta.code ?? null,
      label: periodMeta.label ?? null,
      short_label: periodMeta.short_label ?? null,
      academic_year: periodMeta.academic_year ?? null,
    },
  });

  // ✅ QR PNG server-side
  const itemsWithQrPng = await attachQrPng(itemsWithQr);

  return NextResponse.json({
    ok: true,
    qr: {
      enabled: qrEnabled,
      mode: qrMode,
      verify_path: BULLETIN_VERIFY_SHORT_PREFIX,
      legacy_verify_path: BULLETIN_VERIFY_LEGACY_PATH,
    },
    signatures: { enabled: bulletinSignaturesEnabled },
    class: {
      id: classRow.id,
      label: classRow.label || classRow.code || "Classe",
      code: classRow.code || null,
      academic_year: classRow.academic_year || null,
      level: classRow.level || null,
      bulletin_level: bulletinLevel,
      head_teacher: headTeacher
        ? {
            id: headTeacher.id,
            display_name: headTeacher.display_name || null,
            phone: headTeacher.phone || null,
            email: headTeacher.email || null,
          }
        : null,
    },
    period: periodResponse,
    subjects: subjectsForReport,
    subject_groups: subjectGroups,
    subject_components: subjectComponentsForReport,
    items: itemsWithQrPng,
  });
}
