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

  // ✅ IMPORTANT (offline-friendly) :
  // - actual_call_at : heure réelle du clic "Démarrer l'appel" côté client
  // - si non envoyé, on prendra started_at (mieux que "now serveur" en offline)
  actual_call_at?: string | null;

  expected_minutes?: number | null;

  // optionnels (debug / compat)
  client_session_id?: string | null;
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
function pad2(n: number) {
  return String(n).padStart(2, "0");
}

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

/** minutes -> HH:MM */
function minToHM(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

/** parts date/heure dans un timezone (utilisé pour convertir proprement local -> UTC) */
function partsInTZ(d: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p = fmt.formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    hour: parseInt(get("hour"), 10),
    minute: parseInt(get("minute"), 10),
    second: parseInt(get("second"), 10),
  };
}

/**
 * Convertit une date/heure *locale* (dans tz) vers un Date UTC
 * (petit algo d’ajustement d’offset, sans dépendance externe)
 */
function zonedToUTC(
  y: number,
  mo: number,
  d: number,
  hh: number,
  mm: number,
  ss: number,
  tz: string
) {
  // 1) guess : on suppose que les composantes sont UTC
  let guess = new Date(Date.UTC(y, mo - 1, d, hh, mm, ss));

  // 2) on regarde ce que ce "guess" donne en tz, puis on ajuste
  for (let i = 0; i < 2; i++) {
    const got = partsInTZ(guess, tz);
    const gotUTC = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second);
    const wantUTC = Date.UTC(y, mo - 1, d, hh, mm, ss);
    const diffMs = gotUTC - wantUTC;
    if (diffMs === 0) break;
    guess = new Date(guess.getTime() - diffMs);
  }

  return guess;
}

/** Donne Y-M-D local + HH:MM local + ISO weekday (1=Mon..7=Sun) dans tz */
function localYMDHMAndISODow(iso: string, tz: string) {
  const d = new Date(iso);

  const fmtYMD = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
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

  const ymdParts = fmtYMD.formatToParts(d);
  const y = parseInt(ymdParts.find((p) => p.type === "year")?.value || "1970", 10);
  const mo = parseInt(ymdParts.find((p) => p.type === "month")?.value || "1", 10);
  const da = parseInt(ymdParts.find((p) => p.type === "day")?.value || "1", 10);

  const hm = fmtHM.format(d); // "HH:MM"

  const wdStr = fmtWD.format(d).toLowerCase(); // "mon".."sun"
  const mapISO: Record<string, number> = {
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
    sun: 7,
  };

  return { y, mo, da, hm, isodow: mapISO[wdStr] ?? 1 };
}

function pickBestSession(rows: any[]) {
  // meilleur = celui avec actual_call_at non-null le plus tôt, sinon created_at le plus tôt
  const toMs = (v: any) => {
    const t = v ? new Date(String(v)).getTime() : NaN;
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };

  return [...rows].sort((a, b) => {
    const aHas = !!a.actual_call_at;
    const bHas = !!b.actual_call_at;
    if (aHas !== bHas) return aHas ? -1 : 1;
    const ac = toMs(a.actual_call_at);
    const bc = toMs(b.actual_call_at);
    if (ac !== bc) return ac - bc;
    const aCreated = toMs(a.created_at);
    const bCreated = toMs(b.created_at);
    if (aCreated !== bCreated) return aCreated - bCreated;
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

/* ✅ OFFLINE: choisir une heure d'appel "effective" fiable */
function pickEffectiveCallAt(body: Body, started_at_in: string, nowISO: string) {
  const now = new Date(nowISO).getTime();

  const candidates = [
    body.actual_call_at ?? null, // priorité
    started_at_in ?? null,       // fallback (utile si le front ne passe pas actual_call_at)
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    const t = new Date(c).getTime();
    if (!Number.isFinite(t)) continue;

    // anti-futur: max +10 minutes (horloge device un peu en avance)
    if (t > now + 10 * 60 * 1000) continue;

    // anti-très-ancien: max 7 jours (offline long)
    if (t < now - 7 * 24 * 60 * 60 * 1000) continue;

    return new Date(t).toISOString();
  }

  return nowISO;
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
    const expected_minutes_body = body.expected_minutes ?? null;

    if (!class_id || !raw_subject_id || !raw_started_at) {
      return NextResponse.json(
        { error: "Paramètres manquants (classe / matière / horaire)." },
        { status: 400 }
      );
    }

    // Normalisation de started_at → ISO cohérent (sert à déterminer le créneau)
    let startedDate = new Date(raw_started_at);
    if (isNaN(startedDate.getTime())) {
      startedDate = new Date();
    }
    const started_at_in = startedDate.toISOString();

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

    // 2.a) raw_subject_id est déjà un institution_subjects.id ?
    const { data: asInst, error: asInstErr } = await svc
      .from("institution_subjects")
      .select("id")
      .eq("id", raw_subject_id)
      .maybeSingle();

    if (asInst && !asInstErr) {
      instSubjectId = asInst.id;
    } else {
      // 2.b) sinon raw_subject_id = subjects.id canonique
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

    /* 3) Déterminer le créneau (période) + rendre START idempotent (1 prof = 1 séance / créneau) */

    // a) fuseau de l’établissement
    const { data: inst, error: instErr } = await svc
      .from("institutions")
      .select("tz")
      .eq("id", cls.institution_id)
      .maybeSingle();

    if (instErr) {
      return NextResponse.json({ error: instErr.message }, { status: 400 });
    }

    const tz = String(inst?.tz || "Africa/Abidjan");

    // date locale + heure locale + weekday ISO (1..7)
    const { y, mo, da, hm: startedHM, isodow } = localYMDHMAndISODow(started_at_in, tz);
    const startMin = hmToMin(startedHM);

    // b) périodes du jour
    const { data: periods, error: pErr } = await svc
      .from("institution_periods")
      .select("weekday, period_no, start_time, end_time")
      .eq("institution_id", cls.institution_id)
      .eq("weekday", isodow)
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

      if (cur && cur.endMin > cur.startMin) {
        currentPeriod = { startMin: cur.startMin, endMin: cur.endMin };
      }
    }

    // c) bornes du créneau (UTC) + started_at canonique = début du créneau
    const slotStartMin = currentPeriod?.startMin ?? startMin;
    const slotEndMin =
      currentPeriod?.endMin ?? (startMin + Math.max(1, expected_minutes_body ?? 60));

    const slotStartHM = minToHM(slotStartMin);
    const slotEndHM = minToHM(Math.min(slotEndMin, 24 * 60));

    const [sH, sM] = slotStartHM.split(":").map((n) => parseInt(n, 10));
    const [eH, eM] = slotEndHM.split(":").map((n) => parseInt(n, 10));

    const slotStartUTC = zonedToUTC(y, mo, da, sH, sM, 0, tz);
    const slotEndUTC = zonedToUTC(y, mo, da, eH, eM, 0, tz);

    const started_at = slotStartUTC.toISOString(); // ✅ canonique (créneau)
    const resolved_expected_minutes =
      expected_minutes_body ??
      (currentPeriod ? Math.max(1, currentPeriod.endMin - currentPeriod.startMin) : 60);

    const nowISO = new Date().toISOString();

    // ✅ OFFLINE-FRIENDLY: on conserve l'heure effective du clic (ou started_at_in)
    const effectiveCallAt = pickEffectiveCallAt(body, started_at_in, nowISO);

    // d) “UPSERT logique” : si une séance existe DÉJÀ dans ce créneau pour ce prof → on réutilise
    // IMPORTANT: on ne filtre PLUS par class_id ni subject_id ici
    const { data: sameSlot, error: slotErr } = await svc
      .from("teacher_sessions")
      .select("id, started_at, actual_call_at, created_at, ended_at, status, expected_minutes")
      .eq("institution_id", cls.institution_id)
      .eq("teacher_id", user.id)
      .gte("started_at", slotStartUTC.toISOString())
      .lt("started_at", slotEndUTC.toISOString());

    if (slotErr) {
      return NextResponse.json({ error: slotErr.message }, { status: 400 });
    }

    const fetchOne = async (id: string) => {
      const { data, error } = await svc
        .from("teacher_sessions")
        .select(
          `
          id,
          class_id,
          subject_id,
          started_at,
          actual_call_at,
          expected_minutes,
          classes!inner ( label ),
          institution_subjects!teacher_sessions_subject_id_fkey (
            id,
            subject:subjects ( id, name )
          )
        `
        )
        .eq("id", id)
        .maybeSingle();

      if (error || !data) return null;
      return data;
    };

    if (sameSlot && sameSlot.length) {
      const best = pickBestSession(sameSlot as any[]);
      const reuseSessionId = String(best.id);

      // On met à jour la ligne “canonique” pour refléter la demande courante
      // (sans écraser actual_call_at si déjà défini — on garde le 1er clic / 1ère info)
      const patch: any = {
        class_id,
        subject_id: instSubjectId,
        started_at, // canonique (= début de créneau)
        expected_minutes: resolved_expected_minutes,
      };
      if (!best.actual_call_at) patch.actual_call_at = effectiveCallAt;

      const { error: upErr } = await svc.from("teacher_sessions").update(patch).eq("id", reuseSessionId);

      if (upErr) {
        // même si update échoue, on tente de renvoyer la séance existante
        console.error("[teacher/sessions/start] reuse update error", upErr);
      }

      const session = await fetchOne(reuseSessionId);
      if (!session) {
        return NextResponse.json(
          { error: "Échec de la récupération de la séance existante." },
          { status: 500 }
        );
      }

      const item = {
        id: session.id as string,
        class_id: session.class_id as string,
        class_label: (session.classes && (session.classes as any).label) || cls.label || "",
        subject_id:
          (session.institution_subjects && (session.institution_subjects as any).subject?.id) ||
          raw_subject_id,
        subject_name:
          (session.institution_subjects && (session.institution_subjects as any).subject?.name) ||
          null,
        started_at: session.started_at as string, // début de créneau
        actual_call_at: (session as any).actual_call_at as string | null, // ✅ heure effective
        expected_minutes: session.expected_minutes as number | null,
      };

      return NextResponse.json({ item }, { status: 200 });
    }

    /* 4) Sinon: on crée la séance (started_at CANONIQUE, actual_call_at EFFECTIF) */
    const { data: session, error: insErr } = await svc
      .from("teacher_sessions")
      .insert({
        institution_id: cls.institution_id,
        class_id,
        subject_id: instSubjectId,
        teacher_id: user.id,
        created_by: user.id,
        started_at, // début de créneau
        expected_minutes: resolved_expected_minutes,
        actual_call_at: effectiveCallAt, // ✅ heure effective (offline-friendly)
      })
      .select(
        `
        id,
        class_id,
        subject_id,
        started_at,
        actual_call_at,
        expected_minutes,
        classes!inner ( label ),
        institution_subjects!teacher_sessions_subject_id_fkey (
          id,
          subject:subjects ( id, name )
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

      // En cas de race condition (unique future) : relire et renvoyer
      if (pgCode === "23505") {
        const { data: retry, error: rErr } = await svc
          .from("teacher_sessions")
          .select("id, started_at, actual_call_at, created_at, ended_at, status")
          .eq("institution_id", cls.institution_id)
          .eq("teacher_id", user.id)
          .gte("started_at", slotStartUTC.toISOString())
          .lt("started_at", slotEndUTC.toISOString());

        if (!rErr && retry && retry.length) {
          const best = pickBestSession(retry as any[]);
          const s2 = await fetchOne(String(best.id));
          if (s2) {
            const item = {
              id: s2.id as string,
              class_id: s2.class_id as string,
              class_label: (s2.classes && (s2.classes as any).label) || cls.label || "",
              subject_id:
                (s2.institution_subjects && (s2.institution_subjects as any).subject?.id) ||
                raw_subject_id,
              subject_name:
                (s2.institution_subjects && (s2.institution_subjects as any).subject?.name) ||
                null,
              started_at: s2.started_at as string,
              actual_call_at: (s2 as any).actual_call_at as string | null,
              expected_minutes: s2.expected_minutes as number | null,
            };
            return NextResponse.json({ item }, { status: 200 });
          }
        }
      }

      console.error("[teacher/sessions/start] insert error", insErr);
      return NextResponse.json({ error: "Échec du démarrage de la séance." }, { status: 500 });
    }

    const item = {
      id: session.id as string,
      class_id: session.class_id as string,
      class_label: (session.classes && (session.classes as any).label) || cls.label || "",
      subject_id:
        (session.institution_subjects && (session.institution_subjects as any).subject?.id) ||
        raw_subject_id,
      subject_name:
        (session.institution_subjects && (session.institution_subjects as any).subject?.name) ||
        null,
      started_at: session.started_at as string, // créneau
      actual_call_at: (session as any).actual_call_at as string | null, // ✅ heure effective
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
