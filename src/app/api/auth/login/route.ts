// src/app/api/auth/login/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { normalizePhone, canonicalPrefix, sanitize } from "@/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Génère des candidats de connexion à partir d'un numéro saisi :
 *  - n1 : normalisation standard (peut enlever le 0 local)
 *  - n2 : préfixe pays + numéro tel que saisi (conserve le 0 local)
 * On tente n1 puis n2.
 */
function phoneCandidates(raw: string, country?: string): string[] {
  const candidates: string[] = [];

  const norm =
    country && typeof country === "string" && country.trim()
      ? normalizePhone(raw, { defaultCountryAlpha2: country.trim().toUpperCase() })
      : normalizePhone(raw);
  if (norm) candidates.push(norm);

  const pref = canonicalPrefix(undefined); // lit ENV, défaut +225
  const digitsOnly = sanitize(raw).replace(/^\+/, "");
  if (digitsOnly) {
    const keep0 = pref + digitsOnly;
    const len = keep0.replace(/^\+/, "").length;
    if (len >= 6 && len <= 15 && !candidates.includes(keep0)) candidates.push(keep0);
  }

  return candidates;
}

export async function POST(req: NextRequest) {
  try {
    const { email, phone, password, country } = await req.json();

    if (!password) {
      return NextResponse.json(
        { ok: false, error: "PASSWORD_REQUIRED" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const supabase = await getSupabaseServerClient();

    if (email) {
      const resp = await supabase.auth.signInWithPassword({
        email: String(email).trim(),
        password,
      });

      if (resp.error) {
        return NextResponse.json(
          { ok: false, error: resp.error.message },
          { status: 401, headers: { "Cache-Control": "no-store" } }
        );
      }

      return NextResponse.json(
        { ok: true },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!phone) {
      return NextResponse.json(
        { ok: false, error: "EMAIL_OR_PHONE_REQUIRED" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const tries = phoneCandidates(String(phone), typeof country === "string" ? country : undefined);
    if (tries.length === 0) {
      return NextResponse.json(
        { ok: false, error: "PHONE_INVALID" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    let lastErr: any = null;
    for (const candidate of tries) {
      const resp = await supabase.auth.signInWithPassword({
        phone: candidate,
        password,
      });
      if (!resp.error) {
        return NextResponse.json(
          { ok: true },
          { status: 200, headers: { "Cache-Control": "no-store" } }
        );
      }
      lastErr = resp.error;
    }

    return NextResponse.json(
      { ok: false, error: lastErr?.message || "INVALID_LOGIN" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "UNKNOWN_ERROR" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
