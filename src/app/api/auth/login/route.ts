// src/app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { normalizePhone } from "@/lib/phone"; // attend (raw: string, defaultCountryAlpha2?: string)

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

    let error: any = null;

    if (email) {
      const resp = await supabase.auth.signInWithPassword({
        email: String(email).trim(),
        password,
      });
      error = resp.error;
    } else if (phone) {
      const phoneNorm = normalizePhone(
        String(phone),
        typeof country === "string" && country ? country : undefined
      );

      if (!phoneNorm) {
        return NextResponse.json(
          { ok: false, error: "PHONE_INVALID" },
          { status: 400 }
        );
      }

      const resp = await supabase.auth.signInWithPassword({
        phone: phoneNorm,
        password,
      });
      error = resp.error;
    } else {
      return NextResponse.json(
        { ok: false, error: "EMAIL_OR_PHONE_REQUIRED" },
        { status: 400 }
      );
    }

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 401 }
      );
    }

    // Cookies HttpOnly posés via le client serveur
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "UNKNOWN_ERROR" },
      { status: 500 }
    );
  }
}


