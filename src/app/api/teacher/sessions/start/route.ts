// src/app/api/teacher/sessions/start/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  class_id?: string;
  subject_id?: string | null; // côté front = subjects.id (canonique) ou anciennement institution_subjects.id
  started_at?: string;
  expected_minutes?: number | null;
};

async function getAuthUser() {
  const supa = await getSupabaseServerClient();
  const { data, error } = await supa.auth.getUser();
  if (error || !data?.user) {
    return { user: null, error: "Non authentifié" as string | null };
  }
  return { user: data.user, error: null as string | null };
}

/* ───────── helpers horaires ───────── */
/** HH:MM:SS -> minutes depuis minuit */
function hmsToMin(hms: string | null | undefined) {
  const s = String(hms || "00:00:00").slice(0, 8);
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}
/** "HH:MM" -> minutes depuis minuit */
function hmToMin(hm: string) {
  const [h, m] = hm.split(":").map((n) => parseInt(n, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}
/** Donne l’heure locale HH:MM et weekday (0=dimanche..6=samedi) dans un tz donné */
function localHMAndWeekday(iso: string, tz: string) {
  const d = new Date(iso);
  const fmtHM = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const fmtWD = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  });
  const hm = fmtHM.format(d); // "HH:MM"
  const wdStr = fmtWD.format(d).toLowerCase(); // "sun".."sat"
  const map: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };
  return { hm, weekday: map[wdStr] ?? 0 };
}

export async function POST(req: NextRequest) {
  try {
    const { user, error: authError } = await getAuthUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Body;

    const class_id = body.class_id ?? null;
    const raw_subject_id = body.subject_id ?? null;
    const raw_started_at = body.started_at ?? null;
    const expected_minutes = body.expected_minutes ?? null;

    if (!class_id || !raw_subject_id || !raw_started_at) {
      return NextResponse.json(
        { error: "Paramètres manquants (classe / matière / horaire)." },
        { status: 400 }
      );
    }

    // Normalisation de started_at → ISO cohérent
    let startedDate = new Date(raw_started_at);
    if (isNaN(startedDate.getTime())) {
      startedDate = new Date();
    }
    const started_at = startedDate.toISOString();

    const svc = getSupabaseServiceClient();

    /* 1) Récupérer la classe pour avoir institution_id + label */
    const { data: cls, error: clsErr } = await svc
      .from("classes")
      .select("id, label, institution_id")
      .eq("id", class_id)
      .maybeSingle();

    if (clsErr || !cls) {
      return NextResponse.json(
        { error: "Classe introuvable pour démarrer la séance." },
        { status: 400 }
      );
    }

    /* 2) Résoudre subject_id → institution_subjects.id (instSubjectId) */

    let instSubjectId: string | null = null;

    // 2.a) D’abord, on regarde si raw_subject_id est déjà un institution_subjects.id
    const { data: asInst, error: asInstErr } = await svc
      .from("institution_subjects")
      .select("id")
      .eq("id", raw_subject_id)
      .maybeSingle();

    if (asInst && !asInstErr) {
      instSubjectId = asInst.id;
    } else {
      // 2.b) Sinon, on interprète raw_subject_id comme un subjects.id canonique
      const { data: viaCanonical, error: viaCanonicalErr } = await svc
        .from("institution_subjects")
        .select("id")
        .eq("institution_id", cls.institution_id)
        .eq("subject_id", raw_subject_id)
        .eq("is_active", true)
        .maybeSingle();

      if (viaCanonical && !viaCanonicalErr) {
        instSubjectId = viaCanonical.id;
      }
    }

    if (!instSubjectId) {
      return NextResponse.json(
        {
          error:
            "La matière sélectionnée n’est pas correctement affectée à cet établissement. " +
            "Vérifiez les disciplines dans les paramètres de l’établissement.",
        },
        { status: 400 }
      );
    }

    /* 2bis) Déterminer le créneau courant (période) et réutiliser une séance
             existante si le prof a déjà une séance ouverte sur ce créneau
             pour cette classe + matière. */

    // a) récupérer le fuseau de l’établissement
    const { data: inst, error: instErr } = await svc
      .from("institutions")
      .select("tz")
      .eq("id", cls.institution_id)
      .maybeSingle();

    if (instErr) {
      return NextResponse.json({ error: instErr.message }, { status: 400 });
    }

    const tz = String(inst?.tz || "Africa/Abidjan");

    // heure locale de début (HH:MM) + jour (0..6)
    const { hm: startedHM, weekday } = localHMAndWeekday(started_at, tz);
    const startMin = hmToMin(startedHM);

    // b) créneaux du jour
    const { data: periods, error: pErr } = await svc
      .from("institution_periods")
      .select("weekday, period_no, start_time, end_time")
      .eq("institution_id", cls.institution_id)
      .eq("weekday", weekday)
      .order("period_no", { ascending: true });

    if (pErr) {
      return NextResponse.json({ error: pErr.message }, { status: 400 });
    }

    let currentPeriod: { startMin: number; endMin: number } | null = null;

    if (Array.isArray(periods) && periods.length) {
      const expanded = periods.map((p: any) => ({
        startMin: hmsToMin(p.start_time),
        endMin: hmsToMin(p.end_time),
      }));

      const cur =
        expanded.find((p) => startMin >= p.startMin && startMin < p.endMin) ??
        [...expanded].reverse().find((p) => startMin >= p.startMin) ??
        null;

      if (cur) {
        currentPeriod = { startMin: cur.startMin, endMin: cur.endMin };
      }
    }

    // c) si on connaît le créneau, on cherche une séance déjà ouverte
    let reuseSessionId: string | null = null;

    if (currentPeriod) {
      const dayStart = new Date(started_at);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(started_at);
      dayEnd.setUTCHours(23, 59, 59, 999);

      const { data: sameDaySessions, error: sessErr } = await svc
        .from("teacher_sessions")
        .select("id, started_at")
        .eq("class_id", class_id)
        .eq("subject_id", instSubjectId)
        .eq("teacher_id", user.id)
        .is("ended_at", null)
        .gte("started_at", dayStart.toISOString())
        .lte("started_at", dayEnd.toISOString());

      if (sessErr) {
        return NextResponse.json({ error: sessErr.message }, { status: 400 });
      }

      if (sameDaySessions && sameDaySessions.length) {
        for (const s of sameDaySessions as any[]) {
          const { hm } = localHMAndWeekday(String(s.started_at), tz);
          const m = hmToMin(hm);
          if (m >= currentPeriod.startMin && m < currentPeriod.endMin) {
            reuseSessionId = s.id as string;
            break;
          }
        }
      }
    }

    // d) Si une séance existe déjà sur ce créneau : on la réutilise
    if (reuseSessionId) {
      const { data: session, error: sErr } = await svc
        .from("teacher_sessions")
        .select(
          `
        id,
        class_id,
        subject_id,
        started_at,
        expected_minutes,
        classes!inner (
          label
        ),
        institution_subjects!teacher_sessions_subject_id_fkey (
          id,
          subject:subjects (
            id,
            name
          )
        )
      `
        )
        .eq("id", reuseSessionId)
        .maybeSingle();

      if (sErr || !session) {
        return NextResponse.json(
          { error: "Échec de la récupération de la séance existante." },
          { status: 500 }
        );
      }

      const item = {
        id: session.id as string,
        class_id: session.class_id as string,
        class_label:
          (session.classes && (session.classes as any).label) || cls.label || "",
        // On renvoie côté front le subject_id CANONIQUE si on le connaît,
        // sinon on renvoie ce qui était dans le body (fall-back).
        subject_id:
          (session.institution_subjects &&
            (session.institution_subjects as any).subject?.id) ||
          raw_subject_id,
        subject_name:
          (session.institution_subjects &&
            (session.institution_subjects as any).subject?.name) || null,
        started_at: session.started_at as string,
        expected_minutes: session.expected_minutes as number | null,
      };

      return NextResponse.json({ item }, { status: 200 });
    }

    /* 3) Insérer la séance dans teacher_sessions
          → institution_id + created_by obligatoires */
    const { data: session, error: insErr } = await svc
      .from("teacher_sessions")
      .insert({
        institution_id: cls.institution_id, // ✅ NOT NULL
        class_id,
        subject_id: instSubjectId, // ✅ FK vers institution_subjects.id
        teacher_id: user.id,
        created_by: user.id, // ✅ NOT NULL (nouveau)
        started_at,
        expected_minutes,
      })
      .select(
        `
        id,
        class_id,
        subject_id,
        started_at,
        expected_minutes,
        classes!inner (
          label
        ),
        institution_subjects!teacher_sessions_subject_id_fkey (
          id,
          subject:subjects (
            id,
            name
          )
        )
      `
      )
      .maybeSingle();

    if (insErr || !session) {
      const pgCode = (insErr as any)?.code;
      const msg = (insErr as any)?.message || "";

      if (pgCode === "23503" && msg.includes("teacher_sessions_subject_id_fkey")) {
        return NextResponse.json(
          {
            error:
              "Impossible de démarrer la séance : la matière n’est pas liée aux disciplines de l’établissement.",
          },
          { status: 400 }
        );
      }

      console.error("[teacher/sessions/start] insert error", insErr);
      return NextResponse.json(
        { error: "Échec du démarrage de la séance." },
        { status: 500 }
      );
    }

    /* 4) Normalisation de la réponse pour le front (OpenSession) */

    const item = {
      id: session.id as string,
      class_id: session.class_id as string,
      class_label:
        (session.classes && (session.classes as any).label) || cls.label || "",
      // On renvoie côté front le subject_id CANONIQUE si on le connaît,
      // sinon on renvoie ce qui était dans le body (fall-back).
      subject_id:
        (session.institution_subjects &&
          (session.institution_subjects as any).subject?.id) || raw_subject_id,
      subject_name:
        (session.institution_subjects &&
          (session.institution_subjects as any).subject?.name) || null,
      started_at: session.started_at as string,
      expected_minutes: session.expected_minutes as number | null,
    };

    return NextResponse.json({ item }, { status: 200 });
  } catch (e: any) {
    console.error("[teacher/sessions/start] fatal error", e);
    return NextResponse.json(
      { error: "Erreur inattendue lors du démarrage de la séance." },
      { status: 500 }
    );
  }
}
