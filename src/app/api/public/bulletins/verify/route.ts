// src/app/api/public/bulletins/verify/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { verifyBulletinQR } from "@/lib/bulletin-qr";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Active les logs QR: DEBUG_BULLETIN_QR=1 (ou true) */
const QR_DEBUG =
  (process.env.DEBUG_BULLETIN_QR || "").toLowerCase() === "1" ||
  (process.env.DEBUG_BULLETIN_QR || "").toLowerCase() === "true" ||
  (process.env.DEBUG_BULLETIN_QR || "").toLowerCase() === "yes";

function qrLog(...args: any[]) {
  if (!QR_DEBUG) return;
  console.log("[QR_VERIFY]", ...args);
}

function tokenFingerprint(token: string) {
  if (!token) return null;
  try {
    return crypto.createHash("sha256").update(token).digest("hex").slice(0, 12);
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now();

  const token = req.nextUrl.searchParams.get("t") || "";
  const fp = tokenFingerprint(token);

  qrLog("incoming", {
    path: req.nextUrl.pathname,
    has_t: !!token,
    t_len: token.length,
    t_fp: fp,
    origin: req.nextUrl.origin,
  });

  const payload = verifyBulletinQR(token);

  qrLog("verifyBulletinQR", {
    ok: !!payload,
    t_fp: fp,
    // on log uniquement des ids + meta, jamais le token
    payload: payload
      ? {
          v: (payload as any).v,
          instId: (payload as any).instId,
          classId: (payload as any).classId,
          studentId: (payload as any).studentId,
          academicYear: (payload as any).academicYear ?? null,
          periodFrom: (payload as any).periodFrom ?? null,
          periodTo: (payload as any).periodTo ?? null,
          periodLabel:
            (payload as any).termLabel ??
            (payload as any).periodLabel ??
            null,
          iat: (payload as any).iat,
        }
      : null,
  });

  if (!payload) {
    qrLog("reject invalid_qr", {
      t_fp: fp,
      elapsed_ms: Date.now() - startedAt,
    });
    return NextResponse.json({ ok: false, error: "invalid_qr" }, { status: 400 });
  }

  try {
    const srv = getSupabaseServiceClient() as unknown as SupabaseClient;

    qrLog("db lookup start", { t_fp: fp });

    // On renvoie MINIMUM (anti-fuite)
    const [{ data: inst, error: instErr }, { data: cls, error: clsErr }, { data: stu, error: stuErr }] =
      await Promise.all([
        srv.from("institutions").select("id, name, code").eq("id", (payload as any).instId).maybeSingle(),
        srv.from("classes").select("id, name, level").eq("id", (payload as any).classId).maybeSingle(),
        srv.from("students").select("id, full_name, matricule").eq("id", (payload as any).studentId).maybeSingle(),
      ]);

    qrLog("db lookup results", {
      t_fp: fp,
      inst_ok: !!inst,
      cls_ok: !!cls,
      stu_ok: !!stu,
      inst_err: instErr ? { code: (instErr as any).code, message: (instErr as any).message } : null,
      cls_err: clsErr ? { code: (clsErr as any).code, message: (clsErr as any).message } : null,
      stu_err: stuErr ? { code: (stuErr as any).code, message: (stuErr as any).message } : null,
      elapsed_ms: Date.now() - startedAt,
    });

    const termLabel =
      (payload as any).termLabel ??
      (payload as any).periodLabel ??
      null;

    return NextResponse.json({
      ok: true,
      data: {
        institution: inst ? { id: inst.id, name: inst.name, code: (inst as any).code ?? null } : null,
        class: cls ? { id: cls.id, name: (cls as any).name ?? null, level: (cls as any).level ?? null } : null,
        student: stu ? { id: stu.id, full_name: (stu as any).full_name ?? null, matricule: (stu as any).matricule ?? null } : null,
        academic_year: (payload as any).academicYear ?? null,
        term_label: termLabel,
        issued_at: (payload as any).iat,
      },
    });
  } catch (err: any) {
    qrLog("server_error", {
      t_fp: fp,
      message: err?.message || String(err),
      elapsed_ms: Date.now() - startedAt,
    });
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
