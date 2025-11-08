// src/app/api/admin/teachers/import/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { normalizePhone } from "@/lib/phone";

// Assure un runtime Node (accès process.env, service role, etc.)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ======================================================================
   Helpers
====================================================================== */

// Mot de passe temporaire (8 car.) lisible
function genTempPassword() {
  const C = "bcdfghjkmnpqrstvwxyz";
  const V = "aeiou";
  const D = "0123456789";
  const p =
    C[Math.floor(Math.random() * C.length)] +
    C[Math.floor(Math.random() * C.length)] +
    C[Math.floor(Math.random() * C.length)] +
    V[Math.floor(Math.random() * V.length)] +
    V[Math.floor(Math.random() * V.length)] +
    V[Math.floor(Math.random() * V.length)] +
    D[Math.floor(Math.random() * D.length)] +
    D[Math.floor(Math.random() * D.length)];
  return p;
}

/** CSV parser basique (séparateur auto ; , ou tab + guillemets) */
function parseCSV(raw: string) {
  const firstLine = (raw.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "");
  const sep =
    firstLine.includes("\t")
      ? "\t"
      : firstLine.split(";").length > firstLine.split(",").length
      ? ";"
      : ",";

  const rows: string[][] = [];
  let i = 0, f = "", inQ = false, line: string[] = [];
  const pushField = () => { line.push(f); f = ""; };
  const pushLine = () => { rows.push(line); line = []; };
  const s = raw.replace(/\r\n/g, "\n");
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      if (inQ && s[i + 1] === '"') { f += '"'; i += 2; continue; }
      inQ = !inQ; i++; continue;
    }
    if (!inQ && c === sep) { pushField(); i++; continue; }
    if (!inQ && c === "\n") { pushField(); pushLine(); i++; continue; }
    f += c; i++;
  }
  pushField();
  if (line.length > 1 || line[0].trim() !== "") pushLine();
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

function normalizeHeader(h: string) {
  return h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

/** Parse CSV enseignants → { display_name, email, phone, subjects[] }[] */
function parseTeachersCsvFlexible(raw: string) {
  const rows = parseCSV(raw);
  if (!rows.length) return [];

  const H = rows[0].map(normalizeHeader);
  const idx = {
    name: H.findIndex((h) => /\b(nom|name|display|affiche|affichee|affiché|display_name)\b/i.test(h)),
    email: H.findIndex((h) => /\b(mail|e[- ]?mail|email)\b/i.test(h)),
    phone: H.findIndex((h) => /\b(tel|telephone|phone|portable|gsm|mobile)\b/i.test(h)),
    subjects: H.findIndex((h) => /\b(subjects?|disciplines?|matieres?)\b/i.test(h)),
  };

  const body = rows.slice(1).map((cols) => {
    let display_name = (idx.name! >= 0 ? cols[idx.name!] : "")?.trim() || "";
    const email = (idx.email! >= 0 ? cols[idx.email!] : "")?.trim() || "";
    const phone = (idx.phone! >= 0 ? cols[idx.phone!] : "")?.trim() || "";
    const rawSubjects = (idx.subjects! >= 0 ? cols[idx.subjects!] : "")?.trim();

    if (!display_name) {
      if (email) display_name = email.split("@")[0];
      else if (phone) display_name = phone;
    }

    const subjects = rawSubjects
      ? rawSubjects.split(/[;,/|]/).map((x) => x.trim()).filter(Boolean)
      : [];
    return { display_name, email, phone, subjects };
  });

  return body.filter((r) => r.display_name || r.email || r.phone);
}

/* ======================================================================
   Normalisation & alias matières (tolérant sur sigles)
====================================================================== */

const unaccent = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const norm = (s: string) => unaccent(String(s || "")).toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Table canonique (Enseignement général) */
const SUBJECTS_CANON: Array<{ code: string; name: string; aliases: string[] }> = [
  { code: "ANGL",   name: "Anglais",                         aliases: ["anglais", "english", "ang", "angl", "lv1anglais"] },
  { code: "FRAN",   name: "Français",                        aliases: ["francais", "fr"] },
  { code: "HISTGEO",name: "Histoire-Géographie",             aliases: ["hg", "h-g", "histgeo", "hist-geo", "histoiregeographie", "histoiregeo"] },
  { code: "MATH",   name: "Mathématiques",                   aliases: ["math", "maths", "mathematiques", "mathematique"] },
  { code: "P-C",    name: "Physique-Chimie",                 aliases: ["pc", "p.c", "p-c", "physiquechimie", "physique-chimie", "physchim", "physchimie"] },
  { code: "SVT",    name: "Sciences de la Vie et de la Terre", aliases: ["svt", "s.v.t", "sciencevieetterre", "sciencesdelavieetdelaterre"] },
  { code: "PHILO",  name: "Philosophie",                      aliases: ["philo"] },
  { code: "EPS",    name: "Éducation Physique et Sportive",  aliases: ["eps", "e.p.s", "sport", "educationphysique"] },
  { code: "EDHC",   name: "Éducation aux Droits de l’Homme et à la Citoyenneté", aliases: ["edhc", "e.d.h.c", "citoyennete", "droitsdelhomme"] },
  { code: "ARTPL",  name: "Arts plastiques",                  aliases: ["ap", "a-p", "a.p", "artsplastiques", "dessin", "arts"] },
  { code: "MUSIQ",  name: "Éducation musicale",               aliases: ["mus", "musique", "educationmusicale", "music"] },
  { code: "ALL",    name: "Allemand (LV2)",                   aliases: ["allemand", "lv2all", "all", "a.l.l", "lv2allemand"] },
  { code: "ESP",    name: "Espagnol (LV2)",                   aliases: ["esp", "espagnol", "lv2esp", "lv2espagnol", "e.s.p"] },
];

/** Retourne un { code?, name } canonisé à partir d'un libellé/sigle quelconque */
function canonicalizeSubject(raw: string): { code?: string; name: string } {
  const n = norm(raw || "");
  for (const s of SUBJECTS_CANON) {
    if (norm(s.code) === n || norm(s.name) === n) return { code: s.code, name: s.name };
    for (const a of s.aliases) if (norm(a) === n) return { code: s.code, name: s.name };
  }
  // Inconnu : renvoyer tel quel (création libre)
  return { name: (raw || "").trim() };
}

/* ======================================================================
   Route
====================================================================== */
export async function POST(req: NextRequest) {
  const supa = await getSupabaseServerClient(); // user-scoped (RLS)
  const srv = getSupabaseServiceClient();       // service (bypass RLS)

  // 1) Qui importe ?
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me, error: meErr } = await supa
    .from("profiles").select("institution_id").eq("id", user.id).maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });

  const institution_id_raw = (me?.institution_id as string) || null;
  if (!institution_id_raw) return NextResponse.json({ error: "no_institution" }, { status: 400 });
  const institution_id: string = institution_id_raw;

  // 2) Lecture payload
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "");
  const csv = String(body?.csv || "");
  const defaultCountryAlpha2: string | undefined =
    typeof body?.country === "string" && body.country.trim()
      ? String(body.country).trim()
      : undefined;

  // mot de passe déterministe si fourni, sinon fallback env, sinon aléatoire
  const defaultPasswordOrRandom = () =>
    String(body?.default_password || process.env.DEFAULT_TEMP_PASSWORD || "") || genTempPassword();

  if (!csv.trim()) return NextResponse.json({ error: "csv_empty" }, { status: 400 });

  const parsed = parseTeachersCsvFlexible(csv);

  // Preview
  if (action === "preview") {
    return NextResponse.json({
      preview: parsed.slice(0, 300).map((r) => ({
        display_name: r.display_name || "",
        email: r.email || null,
        phone: normalizePhone((r.phone ?? ""), defaultCountryAlpha2) || "",
        subjects: r.subjects || [],
      })),
    });
  }
  if (action !== "commit") {
    return NextResponse.json({ error: "bad_action" }, { status: 400 });
  }

  // 3) Commit
  let created = 0, updated = 0, skipped_no_phone = 0, failed = 0, subjects_added = 0;

  const results: Array<{
    display_name: string;
    phone: string;
    email?: string | null;
    temp_password?: string;
    status: "created" | "updated" | "skipped" | "failed";
    error?: string;
  }> = [];

  // Cache local pour les matières (clé canonique → institution_subjects.id)
  const knownSubjects = new Map<string, string>();

  /** Assure la matière côté référentiel + côté établissement */
  async function ensureSubject(instId: string, rawLabel: string): Promise<{
    institution_subject_id: string;
    subject_id: string | null;
    label: string;
  }> {
    const raw = (rawLabel || "").trim();
    if (!raw) return { institution_subject_id: "", subject_id: null, label: "" };

    const { code, name } = canonicalizeSubject(raw);
    const cacheKey = norm(name);
    if (knownSubjects.has(cacheKey)) {
      return { institution_subject_id: knownSubjects.get(cacheKey)!, subject_id: null, label: raw };
    }

    // (A) Résoudre/Créer la matière référentielle (subjects)
    let subject_id: string | null = null;
    if (code) {
      const { data: byCode } = await srv.from("subjects").select("id").eq("code", code).maybeSingle();
      if (byCode?.id) subject_id = String(byCode.id);
    }
    if (!subject_id) {
      const { data: byName } = await srv.from("subjects").select("id").ilike("name", name).maybeSingle();
      if (byName?.id) subject_id = String(byName.id);
    }
    if (!subject_id) {
      // créer la matière
      let finalCode =
        (code || name).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 12) || "SUBJ";
      let createdOk = false;
      for (let attempt = 0; attempt < 2 && !createdOk; attempt++) {
        const { data: createdSubj, error: sErr } = await srv
          .from("subjects")
          .insert({ code: finalCode, name })
          .select("id")
          .maybeSingle();
        if (createdSubj?.id) {
          subject_id = String(createdSubj.id);
          createdOk = true;
        } else if (sErr) {
          // collision de code → tente un suffixe court
          finalCode = (finalCode + "-" + Math.random().toString(36).slice(2, 5)).slice(0, 12);
        }
      }
      if (!subject_id) subject_id = null;
    }

    // (B) Retrouver une ligne établissement existante (libellé exact d’abord)
    const { data: exactFound } = await srv
      .from("institution_subjects")
      .select("id")
      .eq("institution_id", instId)
      .ilike("custom_name", raw)
      .limit(1)
      .maybeSingle();

    if (exactFound?.id) {
      knownSubjects.set(cacheKey, exactFound.id as string);
      return { institution_subject_id: String(exactFound.id), subject_id, label: raw };
    }

    // sinon par (instId, subject_id)
    if (subject_id) {
      const { data: byRef } = await srv
        .from("institution_subjects")
        .select("id, custom_name")
        .eq("institution_id", instId)
        .eq("subject_id", subject_id)
        .maybeSingle();
      if (byRef?.id) {
        knownSubjects.set(cacheKey, byRef.id as string);
        return { institution_subject_id: String(byRef.id), subject_id, label: raw };
      }
    }

    // (C) Créer la ligne établissement avec le libellé EXACT saisi
    const { data: createdRow, error } = await srv
      .from("institution_subjects")
      .insert({ institution_id: instId, custom_name: raw, subject_id })
      .select("id")
      .maybeSingle();

    if (!error && createdRow?.id) {
      subjects_added++;
      knownSubjects.set(cacheKey, createdRow.id as string);
      return { institution_subject_id: String(createdRow.id), subject_id, label: raw };
    }
    return { institution_subject_id: "", subject_id, label: raw };
  }

  async function ensureTeacherRole(instId: string, profile_id: string) {
    await srv
      .from("user_roles")
      .upsert([{ profile_id, role: "teacher", institution_id: instId }], {
        onConflict: "profile_id,role,institution_id",
      })
      .select("profile_id")
      .maybeSingle();
  }

  for (const row of parsed) {
    try {
      const display_name = (row.display_name || "").trim();
      const email = (row.email || "").trim() || null;
      const phoneNorm = normalizePhone((row.phone ?? ""), defaultCountryAlpha2) || "";

      if (!phoneNorm) {
        skipped_no_phone++;
        results.push({ display_name, phone: "", email, status: "skipped" });
        continue;
      }

      // 3.1 Cherche un profil existant (tel puis email)
      const { data: existingByPhone } = await srv
        .from("profiles")
        .select("id, institution_id, phone, email, display_name")
        .eq("phone", phoneNorm)
        .limit(1)
        .maybeSingle();

      let existing = existingByPhone;
      if (!existing && email) {
        const { data: existingByEmail } = await srv
          .from("profiles")
          .select("id, institution_id, phone, email, display_name")
          .eq("email", email)
          .limit(1)
          .maybeSingle();
        existing = existingByEmail || null;
      }

      let profile_id: string | null = existing?.id || null;
      let temp_password: string | undefined = undefined;

      if (!existing) {
        // 3.2 Création auth + profil
        const password = defaultPasswordOrRandom();
        const { data: createdUser, error: cuErr } = await srv.auth.admin.createUser({
          phone: phoneNorm,
          phone_confirm: true,
          email: email || undefined,
          email_confirm: !!email,
          password,
          user_metadata: { display_name },
        });

        if (!createdUser?.user?.id) {
          // Fallback : re-lookup dans auth.users (doublon déjà existant)
          const { data: auByPhone } = await srv
            .from("auth.users" as any)
            .select("id")
            .eq("phone", phoneNorm)
            .maybeSingle();
          const { data: auByEmail } =
            !auByPhone && email
              ? await srv.from("auth.users" as any).select("id").eq("email", email).maybeSingle()
              : { data: null as any };

          if (auByPhone?.id || auByEmail?.id) {
            profile_id = String(auByPhone?.id || auByEmail?.id);

            // assure le profil (UPSERT)
            await srv
              .from("profiles")
              .upsert(
                {
                  id: profile_id,
                  display_name: display_name || null,
                  phone: phoneNorm,
                  email,
                  institution_id,
                },
                { onConflict: "id" }
              );

            await ensureTeacherRole(institution_id, profile_id as string);
            updated++;
          } else {
            failed++;
            results.push({
              display_name,
              phone: phoneNorm,
              email,
              status: "failed",
              error: cuErr?.message || "create_user_failed",
            });
            continue;
          }
        } else {
          profile_id = createdUser.user.id;
          const pid = profile_id as string;

          temp_password = password;

          // crée/écrase proprement la ligne profil
          await srv
            .from("profiles")
            .upsert(
              {
                id: pid,
                display_name: display_name || null,
                phone: phoneNorm,
                email,
                institution_id,
              },
              { onConflict: "id" }
            );

          await ensureTeacherRole(institution_id, pid);
          created++;
        }
      } else {
        // 3.3 Mise à jour du profil existant
        profile_id = existing.id;
        const pid = profile_id as string;

        await srv
          .from("profiles")
          .update({
            display_name: display_name || existing.display_name || null,
            phone: phoneNorm,
            email: email ?? existing.email ?? null,
            institution_id,
          })
          .eq("id", pid);

        await ensureTeacherRole(institution_id, pid);
        updated++;
      }

      // 3.4 Assurer les matières (tolérant : sigles & alias OK) + liaison teacher_subjects
      for (const subj of row.subjects || []) {
        if (!subj) continue;
        const { subject_id } = await ensureSubject(institution_id, subj);
        if (profile_id && subject_id) {
          try {
            await srv
              .from("teacher_subjects")
              .upsert(
                { profile_id, subject_id, institution_id },
                { onConflict: "profile_id,subject_id,institution_id" }
              );
          } catch {
            // silencieux
          }
        }
      }

      results.push({
        display_name,
        phone: phoneNorm,
        email,
        temp_password,
        status: existing ? "updated" : temp_password ? "created" : "updated",
      });
    } catch (e: any) {
      results.push({
        display_name: row.display_name || "",
        phone: normalizePhone((row.phone ?? ""), defaultCountryAlpha2) || "",
        email: row.email || null,
        status: "failed",
        error: e?.message || "unknown_error",
      });
      failed++;
    }
  }

  return NextResponse.json({
    ok: true,
    created,
    updated,
    skipped_no_phone,
    failed,
    subjects_added,
    results, // ↩ contient temp_password quand un compte vient d'être créé
  });
}
