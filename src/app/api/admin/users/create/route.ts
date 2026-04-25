//src/app/api/admin/users/create/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { normalizePhone } from "@/lib/phone";

const DEFAULT_TEMP_PASSWORD = process.env.DEFAULT_TEMP_PASSWORD || "Pass2025";

function slug(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isUuid(v: string | null | undefined): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    String(v || "")
  );
}

function normalizeSubjectText(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

const SUBJECT_ALIAS_TO_CANONICAL: Record<string, string> = {
  math: "mathematiques",
  maths: "mathematiques",
  mathematique: "mathematiques",
  mathematiques: "mathematiques",

  francais: "francais",
  fr: "francais",
  french: "francais",

  anglais: "anglais",
  ang: "anglais",
  english: "anglais",

  allemand: "allemand",
  all: "allemand",
  allemandlv2: "allemand",

  espagnol: "espagnol",
  esp: "espagnol",
  espagnollv2: "espagnol",

  histoiregeographie: "histoiregeographie",
  histoiregeo: "histoiregeographie",
  histgeo: "histoiregeographie",
  hg: "histoiregeographie",
  hgeo: "histoiregeographie",
  histoire: "histoiregeographie",
  geographie: "histoiregeographie",

  physiquechimie: "physiquechimie",
  physique: "physiquechimie",
  chimie: "physiquechimie",
  pc: "physiquechimie",
  pch: "physiquechimie",

  svt: "svt",
  sciencenaturelle: "svt",
  sciencesnaturelles: "svt",
  sciencesdelavieetdelaterre: "svt",
  sciencesvieetterre: "svt",
  sciencevieetterre: "svt",

  eps: "eps",
  sport: "eps",
  educationphysique: "eps",
  educationphysiqueetsportive: "eps",

  edhc: "edhc",
  edh: "edhc",
  educationcivique: "edhc",
  educationauxdroitshumainsetalacitoyennete: "edhc",

  philosophie: "philosophie",
  philo: "philosophie",

  // ✅ Musique reste une discipline séparée.
  musique: "musique",
  music: "musique",
  educationmusicale: "musique",
  edmusicale: "musique",
  chant: "musique",

  // ✅ Arts plastiques / Dessin restent une discipline séparée de Musique.
  art: "artsplastiques",
  arts: "artsplastiques",
  artplastique: "artsplastiques",
  artplastiques: "artsplastiques",
  artsplastique: "artsplastiques",
  artsplastiques: "artsplastiques",
  dessin: "artsplastiques",
  dessins: "artsplastiques",
  educationartistique: "artsplastiques",
  artsvisuels: "artsplastiques",
};

function canonicalSubjectKey(value: string | null | undefined) {
  const raw = normalizeSubjectText(value);
  return SUBJECT_ALIAS_TO_CANONICAL[raw] || raw;
}

type BodyRole = "teacher" | "parent" | "admin" | "educator";

type SubjectLite = {
  id: string;
  name: string | null;
  code: string | null;
};

export async function POST(req: NextRequest) {
  const supaSrv = getSupabaseServiceClient(); // service (no RLS)
  const supa = await getSupabaseServerClient(); // user-scoped (RLS)

  // Qui appelle ?
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Etablissement courant de l'admin
  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return NextResponse.json({ error: meErr.message }, { status: 400 });
  }

  const inst = (me?.institution_id as string) || null;

  if (!inst) {
    return NextResponse.json({ error: "no_institution" }, { status: 400 });
  }

  // Payload
  const body = await req.json().catch(() => ({} as any));
  const role = body?.role as BodyRole;
  const emailRaw = (body?.email ?? null) as string | null;
  const display_name = (body?.display_name ?? null) as string | null;

  // ✅ subject_id canonique optionnel.
  // Si présent, il est prioritaire pour éviter les doublons.
  const subjectIdRaw =
    typeof body?.subject_id === "string" && body.subject_id.trim()
      ? String(body.subject_id).trim()
      : null;

  const subjectName = (body?.subject ?? null) as string | null;

  const country =
    typeof body?.country === "string" && body.country.trim()
      ? String(body.country).trim()
      : undefined;

  const phone =
    normalizePhone(body?.phone ?? null, {
      defaultCountryAlpha2: country,
    }) || null;

  const email = emailRaw ? emailRaw.trim().toLowerCase() : null;

  if (!role) {
    return NextResponse.json({ error: "role_required" }, { status: 400 });
  }

  // Règle produit : le parent doit avoir un téléphone
  if (role === "parent" && !phone) {
    return NextResponse.json({ error: "phone_required" }, { status: 400 });
  }

  // 🔒 Discipline OBLIGATOIRE pour les enseignants :
  // soit subject_id, soit nom de discipline.
  if (
    role === "teacher" &&
    !(
      (subjectIdRaw && isUuid(subjectIdRaw)) ||
      (subjectName && subjectName.trim())
    )
  ) {
    return NextResponse.json({ error: "subject_required" }, { status: 400 });
  }

  // 1) Résoudre / créer l'utilisateur (idempotent)
  let uid: string | null = null;

  // a) profiles -> id
  if (phone) {
    const { data } = await supaSrv
      .from("profiles")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    if (data?.id) {
      uid = String(data.id);
      try {
        await supaSrv.auth.admin.updateUserById(uid, {
          password: DEFAULT_TEMP_PASSWORD,
        });
      } catch {}
    }
  }

  if (!uid && email) {
    const { data } = await supaSrv
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (data?.id) {
      uid = String(data.id);
      try {
        await supaSrv.auth.admin.updateUserById(uid, {
          password: DEFAULT_TEMP_PASSWORD,
        });
      } catch {}
    }
  }

  // helper : auth.users lookup
  const findInAuth = async () => {
    if (phone) {
      const { data } = await supaSrv
        .from("auth.users")
        .select("id")
        .eq("phone", phone)
        .maybeSingle();

      if (data?.id) return String(data.id);
    }

    if (email) {
      const { data } = await supaSrv
        .from("auth.users")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      if (data?.id) return String(data.id);
    }

    return null;
  };

  // b) auth.users -> id (si pas trouvé via profiles)
  if (!uid) {
    uid = await findInAuth();

    if (uid) {
      try {
        await supaSrv.auth.admin.updateUserById(uid, {
          password: DEFAULT_TEMP_PASSWORD,
        });
      } catch {}
    }
  }

  // c) créer si toujours introuvable (avec fallback)
  if (!uid) {
    const { data: created, error: cErr } = await supaSrv.auth.admin.createUser({
      email: email || undefined,
      phone: phone || undefined,
      password: DEFAULT_TEMP_PASSWORD, // mdp initial
      email_confirm: !!email,
      phone_confirm: !!phone,
      user_metadata: { display_name, phone, email },
    });

    if (created?.user?.id) {
      uid = String(created.user.id);
    } else {
      // fallback : re-lookup
      uid = await findInAuth();

      if (!uid) {
        return NextResponse.json(
          { error: cErr?.message ?? "createUser_failed" },
          { status: 400 }
        );
      }

      try {
        await supaSrv.auth.admin.updateUserById(uid, {
          password: DEFAULT_TEMP_PASSWORD,
        });
      } catch {}
    }
  }

  // 2) Upsert profil SANS écraser institution_id
  const { data: existingProfile } = await supaSrv
    .from("profiles")
    .select("id,institution_id,display_name,email,phone")
    .eq("id", uid)
    .maybeSingle();

  if (!existingProfile) {
    const { error: pInsErr } = await supaSrv.from("profiles").insert({
      id: uid,
      institution_id: inst,
      display_name: display_name || null,
      email: email ?? null,
      phone: phone ?? null,
    });

    if (pInsErr) {
      return NextResponse.json({ error: pInsErr.message }, { status: 400 });
    }
  } else {
    const { error: pUpdErr } = await supaSrv
      .from("profiles")
      .update({
        display_name: display_name ?? existingProfile.display_name ?? null,
        email: email ?? existingProfile.email ?? null,
        phone: phone ?? existingProfile.phone ?? null,
      })
      .eq("id", uid);

    if (pUpdErr) {
      return NextResponse.json({ error: pUpdErr.message }, { status: 400 });
    }
  }

  // 3) Upsert du rôle (idempotent)
  const { error: rErr } = await supaSrv
    .from("user_roles")
    .upsert(
      { profile_id: uid, institution_id: inst, role },
      { onConflict: "profile_id,institution_id,role" }
    );

  if (rErr) {
    return NextResponse.json({ error: rErr.message }, { status: 400 });
  }

  // 4) Matière REQUISE (enseignant)
  if (role === "teacher") {
    const rawName = String(subjectName || "").trim();

    let subject_id: string | undefined;
    let canonicalSubjectName = rawName;
    let canonicalSubjectCode: string | null = null;

    // ✅ Priorité 1 : subject_id envoyé par le front.
    if (subjectIdRaw && isUuid(subjectIdRaw)) {
      const { data: subjById, error: subjByIdErr } = await supaSrv
        .from("subjects")
        .select("id,name,code")
        .eq("id", subjectIdRaw)
        .maybeSingle();

      if (subjByIdErr) {
        return NextResponse.json(
          { error: subjByIdErr.message },
          { status: 400 }
        );
      }

      if (!subjById?.id) {
        return NextResponse.json(
          { error: "subject_not_found" },
          { status: 400 }
        );
      }

      subject_id = String(subjById.id);
      canonicalSubjectName = String(subjById.name || rawName || "Discipline");
      canonicalSubjectCode = subjById.code ? String(subjById.code) : null;
    }

    // ✅ Priorité 2 : résolution intelligente par nom / alias.
    if (!subject_id && rawName) {
      const wantedCanonical = canonicalSubjectKey(rawName);
      const wantedRaw = normalizeSubjectText(rawName);

      const { data: allSubjects } = await supaSrv
        .from("subjects")
        .select("id,name,code")
        .limit(1000);

      const rows = (Array.isArray(allSubjects)
        ? allSubjects
        : []) as SubjectLite[];

      const found =
        rows.find((s) => canonicalSubjectKey(s.name) === wantedCanonical) ||
        rows.find((s) => normalizeSubjectText(s.name) === wantedRaw) ||
        rows.find((s) => normalizeSubjectText(s.code) === wantedRaw) ||
        null;

      if (found?.id) {
        subject_id = String(found.id);
        canonicalSubjectName = String(found.name || rawName);
        canonicalSubjectCode = found.code ? String(found.code) : null;
      }
    }

    // ✅ Priorité 3 : fallback historique exact ilike.
    if (!subject_id && rawName) {
      const { data: subj1 } = await supaSrv
        .from("subjects")
        .select("id,name,code")
        .ilike("name", rawName)
        .maybeSingle();

      if (subj1?.id) {
        subject_id = String(subj1.id);
        canonicalSubjectName = String(subj1.name || rawName);
        canonicalSubjectCode = subj1.code ? String(subj1.code) : null;
      }
    }

    // ✅ Priorité 4 : création uniquement si la discipline n’existe vraiment pas.
    if (!subject_id && rawName) {
      const name = rawName;
      const code = slug(name).slice(0, 12).toUpperCase();

      const { data: createdSubj } = await supaSrv
        .from("subjects")
        .insert({ code, name })
        .select("id,name,code")
        .maybeSingle();

      subject_id = (createdSubj?.id as string) || undefined;
      canonicalSubjectName = String(createdSubj?.name || name);
      canonicalSubjectCode = createdSubj?.code ? String(createdSubj.code) : code;

      if (!subject_id) {
        // Dernière tentative : collision sur code
        const { data: subjByCode } = await supaSrv
          .from("subjects")
          .select("id,name,code")
          .eq("code", code)
          .maybeSingle();

        subject_id = (subjByCode?.id as string) || undefined;
        canonicalSubjectName = String(subjByCode?.name || name);
        canonicalSubjectCode = subjByCode?.code
          ? String(subjByCode.code)
          : code;
      }
    }

    if (!subject_id) {
      return NextResponse.json(
        { error: "subject_create_failed" },
        { status: 400 }
      );
    }

    await supaSrv
      .from("institution_subjects")
      .upsert(
        {
          institution_id: inst,
          subject_id,
          custom_name: null,
          is_active: true,
        },
        { onConflict: "institution_id,subject_id" }
      );

    try {
      await supaSrv
        .from("teacher_subjects")
        .upsert(
          {
            profile_id: uid,
            subject_id,
            institution_id: inst,
            teacher_name: display_name ?? null, // dénormalisé si colonnes dispo
            subject_name: canonicalSubjectName,
          },
          { onConflict: "profile_id,subject_id,institution_id" }
        );
    } catch (e) {
      // ne bloque pas la création
      console.warn("teacher_subjects upsert skipped:", (e as any)?.message);
    }

    return NextResponse.json({
      ok: true,
      user_id: uid,
      subject_id,
      subject_name: canonicalSubjectName,
      subject_code: canonicalSubjectCode,
    });
  }

  return NextResponse.json({ ok: true, user_id: uid });
}