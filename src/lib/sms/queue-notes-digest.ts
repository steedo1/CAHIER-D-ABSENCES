// src/lib/sms/queue-notes-digest.ts

import type { SupabaseClient } from "@supabase/supabase-js";
import { triggerSmsDispatch } from "@/lib/sms-dispatch";

export type NotesDigestQueueItem = {
  subject: string;
  score: number | string;
  scale?: number | string | null;
};

const SMS_BODY_SOFT_LIMIT = 280;

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toSmsSafeText(value: unknown) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-");
}

function abbreviateInstitutionName(value: unknown, maxLength = 26) {
  let name = toSmsSafeText(value);
  if (!name) return "";

  const replacements: Array<[RegExp, string]> = [
    [/\bLYCEE\b/gi, "Lyc."],
    [/\bCOLLEGE\b/gi, "Coll."],
    [/\bECOLE\b/gi, "Ecol."],
    [/\bGROUPE\b/gi, "Grp."],
    [/\bSCOLAIRE\b/gi, "Scol."],
    [/\bMODERNE\b/gi, "Mod."],
    [/\bPRIMAIRE\b/gi, "Prim."],
    [/\bSECONDAIRE\b/gi, "Sec."],
    [/\bTECHNIQUE\b/gi, "Tech."],
    [/\bPROFESSIONNELLE?\b/gi, "Prof."],
    [/\bCATHOLIQUE\b/gi, "Cath."],
    [/\bPROTESTANTE?\b/gi, "Prot."],
    [/\bMUNICIPALE?\b/gi, "Mun."],
    [/\bPRIVEE?\b/gi, "Priv."],
    [/\bPUBLIQUE\b/gi, "Publ."],
    [/\bINTERNATIONAL(E)?\b/gi, "Intl."],
    [/\bEXCELLENCE\b/gi, "Exc."],
    [/\bINSTITUT\b/gi, "Inst."],
    [/\bACADEMIE\b/gi, "Acad."],
    [/\bENSEIGNEMENT\b/gi, "Ens."],
  ];

  for (const [pattern, replacement] of replacements) {
    name = name.replace(pattern, replacement);
  }

  name = cleanText(name);

  if (name.length <= maxLength) return name;

  return `${name.slice(0, maxLength - 1).trimEnd()}.`;
}

function abbreviateSubjectName(value: unknown, maxLength = 14) {
  let subject = toSmsSafeText(value);
  if (!subject) return "";

  const replacements: Array<[RegExp, string]> = [
    [/^MATHEMATIQUES$/i, "Maths"],
    [/^MATHEMATIQUE$/i, "Maths"],
    [/^MATHS?$/i, "Maths"],

    [/^PHYSIQUE\s*-\s*CHIMIE$/i, "PC"],
    [/^PHYSIQUE\s+CHIMIE$/i, "PC"],
    [/^PHYSIQUE\/CHIMIE$/i, "PC"],
    [/^PC$/i, "PC"],

    [/^SCIENCES?\s+DE\s+LA\s+VIE\s+ET\s+DE\s+LA\s+TERRE$/i, "SVT"],
    [/^SCIENCES?\s+DE\s+LA\s+VIE\s+ET\s+TERRE$/i, "SVT"],
    [/^SVT$/i, "SVT"],

    [/^HISTOIRE\s*-\s*GEOGRAPHIE$/i, "HG"],
    [/^HISTOIRE\s+GEOGRAPHIE$/i, "HG"],
    [/^HISTOIRE\/GEOGRAPHIE$/i, "HG"],
    [/^HG$/i, "HG"],

    [/^FRANCAIS$/i, "Fr"],
    [/^ANGLAIS$/i, "Angl"],
    [/^ALLEMAND$/i, "All"],
    [/^ESPAGNOL$/i, "Esp"],
    [/^PHILOSOPHIE$/i, "Philo"],
    [/^INFORMATIQUE$/i, "Info"],
    [/^TIC$/i, "TIC"],
    [/^EPS$/i, "EPS"],

    [/^EDUCATION\s+CIVIQUE\s+ET\s+MORALE$/i, "ECM"],
    [/^ECM$/i, "ECM"],

    [/^SCIENCES?\s+ECONOMIQUES?\s+ET\s+SOCIALES?$/i, "SES"],
    [/^SES$/i, "SES"],

    [/^COMPTABILITE$/i, "Compta"],
    [/^ECONOMIE$/i, "Eco"],
    [/^DESSIN$/i, "Dess."],
    [/^MUSIQUE$/i, "Mus."],
    [/^ARTS?\s+PLASTIQUES?$/i, "Arts"],
    [/^CONDUITE\s+DE\s+PROJET$/i, "Proj."],
  ];

  for (const [pattern, replacement] of replacements) {
    if (pattern.test(subject)) {
      subject = replacement;
      break;
    }
  }

  subject = cleanText(subject);

  if (subject.length <= maxLength) return subject;

  return `${subject.slice(0, maxLength - 1).trimEnd()}.`;
}

function formatNote(item: NotesDigestQueueItem) {
  const subject = abbreviateSubjectName(item.subject);
  const score = toSmsSafeText(item.score);
  const scale =
    item.scale === null || item.scale === undefined
      ? ""
      : toSmsSafeText(item.scale);

  if (!subject || !score) return "";

  return scale ? `${subject} ${score}/${scale}` : `${subject} ${score}`;
}

function buildSmsBody(opts: {
  studentName: string;
  institutionName?: string | null;
  items: NotesDigestQueueItem[];
  maxLength?: number;
}) {
  const student = toSmsSafeText(opts.studentName);
  const institution = abbreviateInstitutionName(opts.institutionName);
  const maxLength = opts.maxLength ?? SMS_BODY_SOFT_LIMIT;

  const notes = opts.items.map(formatNote).filter(Boolean);
  const prefix = `Mon Cahier: ${student}`;
  const suffix = institution ? `. Etab: ${institution}.` : ".";

  if (notes.length === 0) {
    return `${prefix}${suffix}`.replace(/\s+/g, " ").trim();
  }

  let kept: string[] = [];

  for (let i = 0; i < notes.length; i += 1) {
    const nextKept = [...kept, notes[i]];
    const remaining = notes.length - nextKept.length;
    const extra = remaining > 0 ? `; +${remaining} autres` : "";
    const candidate = `${prefix} - ${nextKept.join("; ")}${extra}${suffix}`;

    if (candidate.length <= maxLength) {
      kept = nextKept;
      continue;
    }

    break;
  }

  if (kept.length === 0) {
    const fallback = `${prefix} - +${notes.length} autres${suffix}`;
    if (fallback.length <= maxLength) {
      return fallback.replace(/\s+/g, " ").trim();
    }

    const minimal = `${prefix}${suffix}`;
    if (minimal.length <= maxLength) {
      return minimal.replace(/\s+/g, " ").trim();
    }

    return `${minimal.slice(0, maxLength - 1).trimEnd()}.`
      .replace(/\s+/g, " ")
      .trim();
  }

  const remaining = notes.length - kept.length;
  const extra = remaining > 0 ? `; +${remaining} autres` : "";

  return `${prefix} - ${kept.join("; ")}${extra}${suffix}`
    .replace(/\s+/g, " ")
    .trim();
}

export async function enqueueNotesDigestSms(opts: {
  srv: SupabaseClient;
  req?: Request;
  institutionId: string;
  studentId: string;
  studentName: string;
  classId?: string | null;
  classLabel?: string | null;
  institutionName?: string | null;
  periodLabel?: string | null;
  average?: number | string | null;
  items: NotesDigestQueueItem[];
  profileId?: string | null;
  parentId?: string | null;
  dispatch?: boolean;
}) {
  const {
    srv,
    req,
    institutionId,
    studentId,
    studentName,
    classId,
    classLabel,
    institutionName,
    periodLabel,
    average,
    items,
    profileId,
    parentId,
    dispatch = true,
  } = opts;

  if (!institutionId) throw new Error("institutionId manquant.");
  if (!studentId) throw new Error("studentId manquant.");
  if (!cleanText(studentName)) throw new Error("studentName manquant.");
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Aucune note a envoyer.");
  }

  const normalizedItems: NotesDigestQueueItem[] = items
    .map((x) => ({
      subject: cleanText(x.subject),
      score: cleanText(x.score),
      scale:
        x.scale === null || x.scale === undefined ? 20 : cleanText(x.scale),
    }))
    .filter((x) => x.subject && cleanText(x.score));

  if (normalizedItems.length === 0) {
    throw new Error("Aucune note valide a envoyer.");
  }

  const payload = {
    kind: "notes_digest",
    event: "notes_digest",
    student: {
      id: studentId,
      name: cleanText(studentName),
    },
    class:
      classId || classLabel
        ? {
            id: classId || null,
            label: classLabel || null,
          }
        : null,
    institution: institutionName
      ? {
          id: institutionId,
          name: cleanText(institutionName),
        }
      : {
          id: institutionId,
        },
    period_label: periodLabel || null,
    average: average ?? null,
    items: normalizedItems,
  };

  const title = `Mon Cahier - ${cleanText(studentName)}`;
  const body = buildSmsBody({
    studentName,
    institutionName,
    items: normalizedItems,
    maxLength: SMS_BODY_SOFT_LIMIT,
  });

  const { data, error } = await srv
    .from("notifications_queue")
    .insert({
      institution_id: institutionId,
      student_id: studentId,
      parent_id: parentId || null,
      profile_id: profileId || null,
      channels: ["sms"],
      title,
      body,
      payload,
      status: "pending",
      attempts: 0,
      meta: {
        source: "notes_digest",
      },
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(
      `Insertion notifications_queue impossible: ${error.message}`
    );
  }

  if (dispatch) {
    await triggerSmsDispatch({
      req,
      reason: "notes_digest",
      timeoutMs: 5000,
      retries: 2,
    });
  }

  return data;
}