import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { normalizePhone, canonicalPrefix, sanitize } from "@/lib/phone";

/**
 * Génère des candidats de connexion à partir d'un numéro saisi :
 *  - n1 : normalisation standard (peut enlever le 0 local)
 *  - n2 : préfixe pays + numéro tel que saisi (conserve le 0 local)
 * On tente n1 puis n2.
 */
function phoneCandidates(raw: string, country?: string): string[] {
  const candidates: string[] = [];

  // Normalisation standard
  const norm = country && typeof country === "string" && country.trim()
    ? normalizePhone(raw, { defaultCountryAlpha2: country.trim().toUpperCase() })
    : normalizePhone(raw);
  if (norm) candidates.push(norm);

  // Variante "conserver le 0" : +225 + digits bruts (sans espaces/signes)
  const pref = canonicalPrefix(undefined); // lit ENV, défaut +225
  const digitsOnly = sanitize(raw).replace(/^\+/, ""); // garde le 0 de tête
  if (digitsOnly) {
    const keep0 = pref + digitsOnly;
    const len = keep0.replace(/^\+/, "").length;
    if (len >= 6 && len <= 15 && !candidates.includes(keep0)) candidates.push(keep0);
  }

  return candidates;
}

export async function POST(req: Request) {
  try {
    const { email, phone, password, country } = await req.json();

    if (!password) {
      return NextResponse.json(
        { ok: false, error: "PASSWORD_REQUIRED" },
        { status: 400 }
      );
    }

    const supabase = await getSupabaseServerClient();

    // Mode email
    if (email) {
      const resp = await supabase.auth.signInWithPassword({
        email: String(email).trim(),
        password,
      });
      if (resp.error) {
        return NextResponse.json({ ok: false, error: resp.error.message }, { status: 401 });
      }
      return NextResponse.json({ ok: true });
    }

    // Mode téléphone
    if (!phone) {
      return NextResponse.json(
        { ok: false, error: "EMAIL_OR_PHONE_REQUIRED" },
        { status: 400 }
      );
    }

    const tries = phoneCandidates(String(phone), typeof country === "string" ? country : undefined);
    if (tries.length === 0) {
      return NextResponse.json({ ok: false, error: "PHONE_INVALID" }, { status: 400 });
    }

    let lastErr: any = null;
    for (const candidate of tries) {
      const resp = await supabase.auth.signInWithPassword({
        phone: candidate,
        password,
      });
      if (!resp.error) {
        // Cookies HttpOnly posés par le client serveur
        return NextResponse.json({ ok: true });
      }
      lastErr = resp.error;
    }

    return NextResponse.json(
      { ok: false, error: lastErr?.message || "INVALID_LOGIN" },
      { status: 401 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "UNKNOWN_ERROR" },
      { status: 500 }
    );
  }
}
