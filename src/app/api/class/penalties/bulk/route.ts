// src/app/api/class/penalties/bulk/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED = ["discipline", "tenue", "moralite"] as const;
type Rubric = (typeof ALLOWED)[number];

function coerceRubric(x: unknown): Rubric {
  let s = String(x ?? "").normalize("NFKC").toLowerCase().trim();
  if (s.includes("moralit")) s = "moralite";
  if (s.includes("disciplin")) s = "discipline";
  if (s.includes("tenue")) s = "tenue";
  return (ALLOWED.includes(s as any) ? s : "discipline") as Rubric;
}

type Item = { student_id: string; points: number; reason?: string | null };

function uniq<T>(arr: T[]) { return Array.from(new Set((arr || []).filter(Boolean))) as T[]; }
function buildPhoneVariants(raw: string) {
  const t = String(raw || "").trim();
  const digits = t.replace(/\D/g, "");
  if (!digits) return { variants: [] as string[] };
  const cc = "225";
  const local10 = digits.slice(-10);
  const localNo0 = local10.replace(/^0/, "");
  const variants = uniq<string>([
    t, t.replace(/\s+/g, ""),
    digits, `+${digits}`,
    `+${cc}${local10}`, `+${cc}${localNo0}`,
    `00${cc}${local10}`, `00${cc}${localNo0}`,
    `${cc}${local10}`, `${cc}${localNo0}`,
    local10, `0${localNo0}`,
  ]);
  return { variants };
}

/** Essaie de résoudre:
 *  - subjectCanonicalId (→ subjects.id ou null)
 *  - subjectDisplayName (custom_name de l'établissement sinon subjects.name)
 *  - teacherProfileId unique via class_teachers (actif au moment t)
 */
async function resolveContext(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  class_id: string,
  subject_any: string | null,         // peut être institution_subjects.id OU subjects.id
  atIso: string
): Promise<{
  subjectCanonicalId: string | null;
  subjectDisplayName: string | null;
  teacherProfileId: string | null;    // prof unique pour (classe, matière) sinon null
}> {
  let subjectCanonicalId: string | null = null;
  let subjectDisplayName: string | null = null;

  // 1) Tenter institution_subjects par id
  let instSubj: any = null;
  if (subject_any) {
    const { data: isRow } = await srv
      .from("institution_subjects")
      .select("id, custom_name, subject_id")
      .eq("id", subject_any)
      .maybeSingle();
    instSubj = isRow ?? null;
  }

  // 2) Si institution_subjects trouvé → canonical = subjects.id ; display = custom_name || subjects.name
  if (instSubj?.subject_id) {
    subjectCanonicalId = instSubj.subject_id as string;
    // récupérer nom du subject si besoin
    const { data: sRow } = await srv
      .from("subjects")
      .select("id,name,code,subject_key")
      .eq("id", instSubj.subject_id)
      .maybeSingle();
    subjectDisplayName =
      (instSubj.custom_name as string | null)
      ?? (sRow?.name || sRow?.code || sRow?.subject_key || null);
  }

  // 3) Sinon tenter directement subjects.id
  if (!subjectCanonicalId && subject_any) {
    const { data: sRow } = await srv
      .from("subjects")
      .select("id,name,code,subject_key")
      .eq("id", subject_any)
      .maybeSingle();
    if (sRow?.id) {
      subjectCanonicalId = sRow.id as string;
      subjectDisplayName = sRow.name || sRow.code || sRow.subject_key || null;
    }
  }

  // 4) Si toujours aucun displayName mais on avait instSubj → prendre custom_name
  if (!subjectDisplayName && instSubj?.custom_name) {
    subjectDisplayName = String(instSubj.custom_name);
  }

  // 5) Chercher le prof actif pour cette classe/matière.
  //    ⚠ class_teachers.subject_id peut contenir un subjects.id OU un institution_subjects.id selon les données.
  const candidates: string[] = uniq<string>([
    subject_any || "",
    subjectCanonicalId || "",
  ]).filter(Boolean);

  let teacherProfileId: string | null = null;
  if (candidates.length) {
    const { data: aff } = await srv
      .from("class_teachers")
      .select("teacher_id, subject_id, start_date, end_date")
      .eq("class_id", class_id)
      .in("subject_id", candidates)
      .lte("start_date", atIso)
      .or(`end_date.is.null,end_date.gt.${atIso}`);

    const profs = uniq<string>((aff || []).map(a => a.teacher_id).filter(Boolean) as string[]);
    if (profs.length === 1) teacherProfileId = profs[0]!;
  }

  return { subjectCanonicalId, subjectDisplayName, teacherProfileId };
}

export async function POST(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient(); // RLS
    const srv  = getSupabaseServiceClient();      // service

    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as {
      class_id: string;
      rubric: Rubric | string;
      items: Item[];
      subject_id?: string | null;    // peut être institution_subjects.id OU subjects.id
    };

    const class_id = String(body?.class_id || "").trim();
    const rubric: Rubric = coerceRubric(body?.rubric);
    const items: Item[] = Array.isArray(body?.items) ? body.items : [];
    const subject_any = body?.subject_id ? String(body.subject_id).trim() : null;

    if (!class_id) return NextResponse.json({ error: "class_id_required" }, { status: 400 });
    if (items.length === 0) return NextResponse.json({ error: "empty_items" }, { status: 400 });

    // Auth téléphone de classe
    let phone = String(user.phone || "").trim();
    if (!phone) {
      const { data: au, error: auErr } = await srv.schema("auth").from("users").select("phone").eq("id", user.id).maybeSingle();
      if (auErr) return NextResponse.json({ error: auErr.message }, { status: 400 });
      phone = String(au?.phone || "").trim();
    }
    if (!phone) return NextResponse.json({ error: "no_phone" }, { status: 400 });

    const { variants } = buildPhoneVariants(phone);

    // Vérif classe + institution
    const { data: cls, error: clsErr } = await srv
      .from("classes")
      .select("id,label,institution_id,class_phone_e164")
      .eq("id", class_id)
      .in("class_phone_e164", variants.length ? variants : ["__no_match__"])
      .maybeSingle();

    if (clsErr) return NextResponse.json({ error: clsErr.message }, { status: 400 });
    if (!cls) return NextResponse.json({ error: "forbidden_not_class_device" }, { status: 403 });

    const nowIso = new Date().toISOString();

    // Résolution matière + prof
    const { subjectCanonicalId, subjectDisplayName, teacherProfileId } =
      await resolveContext(srv, class_id, subject_any, nowIso);

    // Filtrer items valides (élève inscrit dans la classe — optionnel: on peut rajouter le check enrollments)
    const clean = items
      .filter(Boolean)
      .map((it) => ({
        student_id: String(it.student_id || "").trim(),
        points: Math.max(0, Number(it.points || 0)),
        reason: (it.reason ?? "").toString().trim() || null,
      }))
      .filter((it) => it.student_id && it.points > 0);

    if (clean.length === 0) {
      return NextResponse.json({ error: "no_valid_items" }, { status: 400 });
    }

    // Attribution :
    // - si prof identifié → auteur = prof, label "Enseignant", et on met la matière dans author_subject_name
    // - sinon → auteur = user (compte classe), label "Administration"
    const author_role_label = teacherProfileId ? "Enseignant" : "Administration";
    const author_profile_id = teacherProfileId ?? null;
    const author_id = teacherProfileId ?? user.id; // on crédite le prof si trouvé, sinon le compte classe

    // IMPORTANT: subject_id (FK → subjects.id) POSÉ UNIQUEMENT SI ON A LE CANONICAL (subjects.id)
    const rows = clean.map((it) => ({
      institution_id: cls.institution_id,
      class_id,
      subject_id: subjectCanonicalId ?? null,       // ✅ jamais un id d'institution_subjects ici
      student_id: it.student_id,
      rubric,
      points: it.points,
      reason: it.reason,
      author_id,
      author_profile_id,                            // aide la lecture côté /children/penalties
      author_role_label,                            // direct pour le front
      author_subject_name: subjectDisplayName ?? null, // “prof de Mathématiques”
      occurred_at: nowIso,
      created_at: nowIso,
    }));

    const { data: inserted, error } = await srv
      .from("conduct_penalties")
      .insert(rows)
      .select("id");

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true, inserted: inserted?.length || rows.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "penalties_failed" }, { status: 400 });
  }
}
