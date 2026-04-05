import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

function isValidDateOnly(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function normalize(v: any) {
  return String(v ?? "").trim();
}

function diffDays(start: string, end: string) {
  const a = new Date(start + "T00:00:00");
  const b = new Date(end + "T00:00:00");
  return Math.floor((b.getTime() - a.getTime()) / 86400000) + 1;
}

async function getContext() {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Non authentifié", status: 401 };
  }

  // 🔥 DIRECT (validé)
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, institution_id, display_name")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return { error: "Profil introuvable", status: 400 };
  }

  // 🔥 rôle strict
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("profile_id", profile.id)
    .eq("institution_id", profile.institution_id);

  const isTeacher = (roles ?? []).some(r => r.role === "teacher");

  if (!isTeacher) {
    return { error: "Accès refusé", status: 403 };
  }

  return {
    supabase,
    user,
    profile,
  };
}

export async function POST(req: NextRequest) {
  const ctx = await getContext();

  if ("error" in ctx) {
    return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status });
  }

  const { supabase, user, profile } = ctx;

  const body = await req.json().catch(() => null);

  if (!body) {
    return NextResponse.json({ ok: false, error: "Corps invalide" }, { status: 400 });
  }

  const start = normalize(body.start_date);
  const end = normalize(body.end_date);
  const reason = normalize(body.reason_code);
  const details = normalize(body.details);

  if (!start || !end || !isValidDateOnly(start) || !isValidDateOnly(end)) {
    return NextResponse.json({ ok: false, error: "Dates invalides" }, { status: 400 });
  }

  if (new Date(end) < new Date(start)) {
    return NextResponse.json({ ok: false, error: "Période invalide" }, { status: 400 });
  }

  if (!reason) {
    return NextResponse.json({ ok: false, error: "Motif requis" }, { status: 400 });
  }

  if (!details || details.length < 8) {
    return NextResponse.json({ ok: false, error: "Détails insuffisants" }, { status: 400 });
  }

  const days = diffDays(start, end);

  // 🔥 vérification signature
  const { data: signature } = await supabase
    .from("teacher_signatures")
    .select("id")
    .eq("teacher_id", profile.id)
    .eq("institution_id", profile.institution_id)
    .maybeSingle();

  if (!signature) {
    return NextResponse.json(
      { ok: false, error: "Signature requise avant envoi" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("teacher_absence_requests")
    .insert({
      institution_id: profile.institution_id,
      teacher_user_id: user.id,
      teacher_profile_id: profile.id,
      start_date: start,
      end_date: end,
      reason_code: reason,
      reason_label: body.reason_label || reason,
      details,
      requested_days: days,
      signed: true,
      source: "teacher_portal",
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    item: data,
    message: "Demande envoyée avec succès",
  });
}

export async function GET() {
  const ctx = await getContext();

  if ("error" in ctx) {
    return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status });
  }

  const { supabase, profile } = ctx;

  const { data, error } = await supabase
    .from("teacher_absence_requests")
    .select("*")
    .eq("teacher_profile_id", profile.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, items: data });
}