"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Award,
  BookOpen,
  CheckCircle2,
  Crown,
  FileClock,
  GraduationCap,
  Loader2,
  Medal,
  Printer,
  QrCode,
  RefreshCw,
  Save,
  School,
  Sparkles,
  Star,
  Trophy,
  Users,
  XCircle,
} from "lucide-react";
import {
  DISTINCTION_TIER_LABELS,
  evaluateStudentEligibility,
  normalizeDistinctionSettings,
  subjectBelongsToFamily,
  type DistinctionSettings,
  type DistinctionTier,
  type StudentPalmaresMode,
} from "@/lib/distinctions";

type SchoolClass = {
  id: string;
  label: string;
  level?: string | null;
  academic_year?: string | null;
};

type AcademicYear = {
  code: string;
  label?: string | null;
  is_current?: boolean | null;
};

type GradePeriod = {
  id: string;
  academic_year: string;
  code?: string | null;
  label?: string | null;
  short_label?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  order_index?: number | null;
  is_active?: boolean | null;
};

type InstitutionMeta = {
  institution_name: string;
  institution_logo_url?: string;
  institution_region?: string;
  institution_status?: string;
  institution_head_name?: string;
  institution_head_title?: string;
  country_name?: string;
  country_motto?: string;
  ministry_name?: string;
  institution_code?: string;
};

type BulletinSubject = {
  subject_id: string;
  subject_name: string;
  coeff_bulletin?: number | null;
  include_in_average?: boolean | null;
};

type BulletinItem = {
  student_id: string;
  full_name: string;
  matricule?: string | null;
  photo_url?: string | null;
  general_avg?: number | null;
  conduct_avg?: number | null;
  rank?: number | null;
  coverage_is_complete?: boolean | null;
  coverage_status?: string | null;
  per_subject?: Array<{
    subject_id: string;
    avg20?: number | null;
    is_nc?: boolean | null;
  }>;
};

type BulletinResponse = {
  ok: boolean;
  error?: string;
  class?: {
    id: string;
    label: string;
    level?: string | null;
    academic_year?: string | null;
  };
  period?: {
    code?: string | null;
    label?: string | null;
    short_label?: string | null;
  };
  subjects?: BulletinSubject[];
  items?: BulletinItem[];
};

type ConductItem = {
  student_id: string;
  total?: number | null;
  conduct_final_avg20?: number | null;
  absence_count?: number | null;
  tardy_count?: number | null;
  breakdown?: {
    assiduite?: number | null;
    tenue?: number | null;
    moralite?: number | null;
    discipline?: number | null;
  };
};

type ConductResponse = {
  items?: ConductItem[];
  error?: string;
};

type LoadedClass = {
  classInfo: SchoolClass;
  subjects: BulletinSubject[];
  students: Array<
    BulletinItem & {
      conductDetails?: ConductItem | null;
    }
  >;
};

type Candidate = {
  student_id: string;
  full_name: string;
  matricule?: string | null;
  photo_url?: string | null;
  class_id: string;
  class_label: string;
  class_level?: string | null;
  general_avg: number | null;
  ranking_avg: number | null;
  conduct_avg: number | null;
  official_rank: number | null;
  honour_rank: number | null;
  family_subject_count: number;
  absence_count: number | null;
  tardy_count: number | null;
  tier: DistinctionTier | null;
  status: "eligible" | "review" | "ineligible";
  reasons: string[];
};

const MODE_LABELS: Record<StudentPalmaresMode, string> = {
  individual: "Tableaux individuels",
  general: "Top 3 général",
  science: "Excellence scientifique",
  literature: "Excellence littéraire",
};

const MODE_DESCRIPTIONS: Record<StudentPalmaresMode, string> = {
  individual: "Tous les élèves remplissant automatiquement les règles de mérite et de conduite.",
  general: "Les élèves classés aux trois premières places et remplissant aussi les règles de conduite, sans réattribuer les rangs.",
  science: "Les trois premières places scientifiques de chaque classe, validées par la conduite et sans promotion artificielle.",
  literature: "Les trois premières places littéraires de chaque classe, validées par la conduite et sans promotion artificielle.",
};

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatAverage(value: number | null | undefined) {
  const parsed = numberOrNull(value);
  return parsed === null ? "—" : parsed.toFixed(2).replace(".", ",");
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(`${value}T12:00:00`));
  } catch {
    return value;
  }
}

const DISTINCTION_QR_CACHE = new Map<string, string>();
let distinctionQrLibPromise: Promise<any> | null = null;

function studentVerificationKey(mode: StudentPalmaresMode, candidate: Pick<Candidate, "class_id" | "student_id">) {
  return `student:students_${mode}:${candidate.class_id}:${candidate.student_id}`;
}

async function generateVerificationQr(code: string) {
  const cleanCode = String(code || "").trim();
  if (!cleanCode || typeof window === "undefined") return "";
  const url = `${window.location.origin}/v/distinction/${cleanCode}`;
  const cached = DISTINCTION_QR_CACHE.get(url);
  if (cached) return cached;
  if (!distinctionQrLibPromise) distinctionQrLibPromise = import("qrcode");
  const mod: any = await distinctionQrLibPromise;
  const toDataURL = mod?.toDataURL || mod?.default?.toDataURL;
  if (typeof toDataURL !== "function") return "";
  const dataUrl = await toDataURL(url, { width: 220, margin: 1, errorCorrectionLevel: "Q" });
  if (dataUrl) DISTINCTION_QR_CACHE.set(url, dataUrl);
  return dataUrl || "";
}

async function generateVerificationQrs(codes: Record<string, string>) {
  const entries = await Promise.all(
    Object.entries(codes).map(async ([key, code]) => [key, await generateVerificationQr(code)] as const),
  );
  return Object.fromEntries(entries.filter(([, value]) => Boolean(value)));
}

function safeText(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function tierShortLabel(tier: DistinctionTier | null) {
  if (tier === "excellence") return "Excellence";
  if (tier === "felicitations") return "Félicitations";
  if (tier === "encouragement") return "Encouragement";
  return "Tableau d’honneur";
}

function competitionRanks<T>(rows: T[], score: (row: T) => number | null) {
  const sorted = rows
    .map((row) => ({ row, value: numberOrNull(score(row)) }))
    .filter((entry): entry is { row: T; value: number } => entry.value !== null)
    .sort((a, b) => b.value - a.value);

  let previousValue: number | null = null;
  let previousRank = 0;
  return sorted.map((entry, index) => {
    const rank =
      previousValue !== null && Math.abs(entry.value - previousValue) < 0.0001
        ? previousRank
        : index + 1;
    previousValue = entry.value;
    previousRank = rank;
    return { row: entry.row, rank };
  });
}

async function readJson<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String((json as any)?.message || (json as any)?.error || `Erreur HTTP ${response.status}`));
  }
  return json as T;
}

function familyAverage(
  student: BulletinItem,
  subjects: BulletinSubject[],
  family: "science" | "literature",
  settings: DistinctionSettings,
) {
  const subjectMap = new Map(subjects.map((subject) => [String(subject.subject_id), subject]));
  let weighted = 0;
  let totalCoeff = 0;
  let count = 0;

  for (const cell of student.per_subject || []) {
    const subject = subjectMap.get(String(cell.subject_id));
    if (!subject) continue;
    if (subject.include_in_average === false || cell.is_nc === true) continue;
    if (!subjectBelongsToFamily(subject, family, settings.students)) continue;
    const average = numberOrNull(cell.avg20);
    if (average === null) continue;
    const coeff = Math.max(0, Number(subject.coeff_bulletin || 1)) || 1;
    weighted += average * coeff;
    totalCoeff += coeff;
    count += 1;
  }

  return {
    average: totalCoeff > 0 ? Math.round((weighted / totalCoeff) * 10000) / 10000 : null,
    count,
  };
}

function StatusBadge({ status }: { status: Candidate["status"] }) {
  if (status === "eligible") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">
        <CheckCircle2 className="h-3.5 w-3.5" /> Éligible
      </span>
    );
  }
  if (status === "review") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
        <AlertTriangle className="h-3.5 w-3.5" /> À vérifier
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800">
      <XCircle className="h-3.5 w-3.5" /> Non éligible
    </span>
  );
}

function StudentPortrait({ candidate, size = "large" }: { candidate: Candidate; size?: "small" | "large" }) {
  const classes = size === "large" ? "h-36 w-28" : "h-24 w-20";
  return candidate.photo_url ? (
    <img
      src={candidate.photo_url}
      alt={candidate.full_name}
      className={`${classes} rounded-2xl border-4 border-white object-cover shadow-xl ring-1 ring-slate-300`}
    />
  ) : (
    <div className={`${classes} grid place-items-center rounded-2xl border-4 border-white bg-gradient-to-br from-slate-100 to-slate-200 shadow-xl ring-1 ring-slate-300`}>
      <GraduationCap className={size === "large" ? "h-14 w-14 text-slate-400" : "h-9 w-9 text-slate-400"} />
    </div>
  );
}

function OfficialHeader({ institution }: { institution: InstitutionMeta }) {
  return (
    <div className="official-header grid grid-cols-[1fr_auto_1fr] items-start gap-4 text-[11px] font-semibold uppercase leading-snug text-slate-700">
      <div className="text-left">
        <div>{safeText(institution.country_name, "République de Côte d’Ivoire")}</div>
        <div className="mt-1 normal-case italic">{safeText(institution.country_motto, "Union · Discipline · Travail")}</div>
        <div className="mt-3">{safeText(institution.ministry_name, "Ministère de l’Éducation Nationale")}</div>
      </div>
      <div className="flex min-w-[110px] justify-center">
        {institution.institution_logo_url ? (
          <img src={institution.institution_logo_url} alt="Logo établissement" className="h-24 w-24 object-contain" />
        ) : (
          <div className="grid h-20 w-20 place-items-center rounded-full border-2 border-amber-500 bg-amber-50">
            <School className="h-10 w-10 text-amber-700" />
          </div>
        )}
      </div>
      <div className="text-right">
        <div>{safeText(institution.institution_region, "Direction régionale")}</div>
        <div className="mt-3 text-[13px] font-black text-slate-900">
          {safeText(institution.institution_name, "Établissement")}
        </div>
        {institution.institution_code ? <div className="mt-1">Code : {institution.institution_code}</div> : null}
      </div>
    </div>
  );
}

function CertificateFrame({
  institution,
  candidate,
  period,
  academicYear,
  verificationCode,
  verificationQr,
}: {
  institution: InstitutionMeta;
  candidate: Candidate;
  period: GradePeriod | null;
  academicYear: string;
  verificationCode?: string;
  verificationQr?: string;
}) {
  return (
    <section className="print-sheet certificate-sheet relative mx-auto overflow-hidden bg-[#fffdf7] p-[13mm] text-slate-900 shadow-2xl print:shadow-none">
      <div className="absolute inset-[6mm] border-[3px] border-double border-amber-700" />
      <div className="absolute inset-[9mm] border border-amber-300" />
      <div className="absolute left-[9mm] top-[9mm] h-16 w-16 border-l-4 border-t-4 border-slate-900" />
      <div className="absolute right-[9mm] top-[9mm] h-16 w-16 border-r-4 border-t-4 border-slate-900" />
      <div className="absolute bottom-[9mm] left-[9mm] h-16 w-16 border-b-4 border-l-4 border-slate-900" />
      <div className="absolute bottom-[9mm] right-[9mm] h-16 w-16 border-b-4 border-r-4 border-slate-900" />
      <div className="absolute -right-20 top-32 h-64 w-64 rounded-full border-[32px] border-amber-100/60" />
      <div className="absolute -left-20 bottom-20 h-56 w-56 rounded-full border-[28px] border-slate-100/80" />

      <div className="relative z-10 flex h-full flex-col">
        <OfficialHeader institution={institution} />

        <div className="mt-6 text-center">
          <div className="inline-flex items-center gap-3 rounded-full border border-amber-300 bg-amber-50 px-5 py-2 text-xs font-black uppercase tracking-[0.28em] text-amber-900">
            <Sparkles className="h-4 w-4" /> Mérite scolaire <Sparkles className="h-4 w-4" />
          </div>
          <h1 className="mt-4 font-serif text-4xl font-black uppercase tracking-[0.08em] text-slate-950">
            Tableau d’honneur
          </h1>
          <div className="mx-auto mt-3 h-1 w-40 rounded-full bg-gradient-to-r from-transparent via-amber-600 to-transparent" />
          <p className="mt-3 text-lg font-bold text-amber-800">{tierShortLabel(candidate.tier)}</p>
        </div>

        <div className="mt-7 grid grid-cols-[auto_1fr_auto] items-center gap-7 rounded-[32px] border border-amber-200 bg-white/80 px-7 py-6 shadow-sm">
          <StudentPortrait candidate={candidate} />
          <div className="text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Décerné à</p>
            <h2 className="mt-2 font-serif text-[32px] font-black leading-tight text-slate-950">{candidate.full_name}</h2>
            <p className="mt-3 text-lg font-bold text-slate-700">Classe de {candidate.class_label}</p>
            <p className="mt-5 text-[15px] leading-relaxed text-slate-600">
              En reconnaissance de ses résultats, de sa conduite exemplaire et de son engagement constant au cours de la période.
            </p>
          </div>
          <div className="grid h-32 w-32 place-items-center rounded-full border-[7px] border-double border-amber-600 bg-gradient-to-br from-amber-50 to-amber-100 text-center shadow-lg">
            <div>
              <Crown className="mx-auto h-8 w-8 text-amber-700" />
              <div className="mt-1 text-2xl font-black text-slate-950">{formatAverage(candidate.general_avg)}</div>
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Moyenne /20</div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Conduite</div>
            <div className="mt-1 text-xl font-black text-slate-950">{formatAverage(candidate.conduct_avg)} / 20</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Rang académique</div>
            <div className="mt-1 text-xl font-black text-slate-950">{candidate.official_rank ? `${candidate.official_rank}${candidate.official_rank === 1 ? "er" : "e"}` : "—"}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Période</div>
            <div className="mt-1 text-sm font-black text-slate-950">{safeText(period?.label || period?.short_label, "Période")}</div>
          </div>
        </div>

        <div className="mt-auto grid grid-cols-[1fr_auto_1fr] items-end gap-7 pt-7 text-center">
          <div>
            <div className="mx-auto h-16 w-44 border-b border-slate-500" />
            <p className="mt-2 text-xs font-black uppercase tracking-wide">Le professeur principal</p>
          </div>
          <div className="flex min-w-[92px] flex-col items-center justify-end">
            {verificationQr ? (
              <>
                <img src={verificationQr} alt="QR de vérification" className="h-[78px] w-[78px] rounded-md border border-slate-300 bg-white p-1" />
                <p className="mt-1 text-[8px] font-black uppercase tracking-wide text-slate-500">Vérifier l’authenticité</p>
                <p className="max-w-[92px] truncate text-[7px] font-semibold text-slate-400">{verificationCode}</p>
              </>
            ) : (
              <div className="grid h-[78px] w-[78px] place-items-center rounded-md border border-dashed border-slate-300 bg-white/70">
                <QrCode className="h-8 w-8 text-slate-300" />
              </div>
            )}
          </div>
          <div>
            <div className="mx-auto flex h-16 w-52 items-end justify-center font-serif text-xl font-bold italic text-blue-950">
              {institution.institution_head_name || ""}
            </div>
            <div className="mx-auto w-52 border-b border-slate-500" />
            <p className="mt-2 text-xs font-black uppercase tracking-wide">
              {safeText(institution.institution_head_title, "La Direction")}
            </p>
          </div>
        </div>

        <div className="mt-7 flex items-center justify-between border-t border-amber-300 pt-3 text-[10px] font-semibold text-slate-500">
          <span>Année scolaire {academicYear}</span>
          <span>www.mon-cahier.com</span>
          <span>Édité le {new Intl.DateTimeFormat("fr-FR").format(new Date())}</span>
        </div>
      </div>
    </section>
  );
}

function PodiumCard({
  candidate,
  position,
  mode,
  verificationCode,
  verificationQr,
}: {
  candidate: Candidate;
  position: number;
  mode: StudentPalmaresMode;
  verificationCode?: string;
  verificationQr?: string;
}) {
  const podiumClass = position === 1 ? "podium-first" : position === 2 ? "podium-second" : "podium-third";
  const MedalIcon = position === 1 ? Crown : position === 2 ? Medal : Award;
  const label = mode === "science" ? "Moyenne scientifique" : mode === "literature" ? "Moyenne littéraire" : "Moyenne générale";
  return (
    <div className={`podium-card ${podiumClass} relative flex min-h-[330px] flex-col items-center rounded-[28px] border bg-white px-5 pb-5 pt-7 text-center shadow-lg`}>
      <div className="absolute -top-6 grid h-14 w-14 place-items-center rounded-full border-4 border-white bg-slate-950 text-white shadow-lg">
        <span className="text-xl font-black">{position}</span>
      </div>
      <MedalIcon className="mt-3 h-10 w-10 text-amber-600" />
      <div className="mt-3"><StudentPortrait candidate={candidate} size="small" /></div>
      <h3 className="mt-4 text-lg font-black leading-tight text-slate-950">{candidate.full_name}</h3>
      <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500">{tierShortLabel(candidate.tier)}</p>
      <div className="mt-4 w-full rounded-2xl bg-slate-950 px-4 py-3 text-white">
        <div className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-300">{label}</div>
        <div className="mt-1 text-2xl font-black">{formatAverage(candidate.ranking_avg)} / 20</div>
      </div>
      <div className="mt-3 grid w-full grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-slate-100 px-2 py-2"><span className="block text-[9px] font-bold uppercase text-slate-500">Conduite</span><strong>{formatAverage(candidate.conduct_avg)}</strong></div>
        <div className="rounded-xl bg-slate-100 px-2 py-2"><span className="block text-[9px] font-bold uppercase text-slate-500">Rang officiel</span><strong>{candidate.official_rank || "—"}</strong></div>
      </div>
      {verificationQr ? (
        <div className="mt-3 flex w-full items-center justify-center gap-2 border-t border-slate-200 pt-2 text-left">
          <img src={verificationQr} alt="QR de vérification" className="h-11 w-11 rounded border border-slate-200 bg-white p-0.5" />
          <div><div className="text-[8px] font-black uppercase text-slate-500">Document authentique</div><div className="max-w-[115px] truncate text-[7px] font-semibold text-slate-400">{verificationCode}</div></div>
        </div>
      ) : null}
    </div>
  );
}

function PodiumSheet({
  institution,
  classLabel,
  candidates,
  period,
  academicYear,
  mode,
  verificationCodes = {},
  verificationQrs = {},
}: {
  institution: InstitutionMeta;
  classLabel: string;
  candidates: Candidate[];
  period: GradePeriod | null;
  academicYear: string;
  mode: StudentPalmaresMode;
  verificationCodes?: Record<string, string>;
  verificationQrs?: Record<string, string>;
}) {
  return (
    <section className="print-sheet podium-sheet relative mx-auto overflow-hidden bg-[#fffdf7] p-[12mm] text-slate-900 shadow-2xl print:shadow-none">
      <div className="absolute inset-[6mm] border-[3px] border-double border-amber-700" />
      <div className="absolute inset-[9mm] border border-amber-300" />
      <div className="absolute left-1/2 top-24 h-80 w-80 -translate-x-1/2 rounded-full bg-amber-100/50 blur-3xl" />
      <div className="relative z-10 flex h-full flex-col">
        <OfficialHeader institution={institution} />
        <div className="mt-4 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-[10px] font-black uppercase tracking-[0.24em] text-amber-300">
            <Trophy className="h-4 w-4" /> Palmarès d’excellence
          </div>
          <h1 className="mt-3 font-serif text-3xl font-black uppercase tracking-[0.08em] text-slate-950">{MODE_LABELS[mode]}</h1>
          <p className="mt-1 text-lg font-black text-amber-800">Classe de {classLabel}</p>
          <p className="mt-1 text-xs font-semibold text-slate-500">{safeText(period?.label || period?.short_label, "Période")} · Année scolaire {academicYear}</p>
        </div>

        <div className={`mx-auto mt-9 grid w-full max-w-5xl gap-5 ${candidates.length === 1 ? "grid-cols-1 max-w-sm" : candidates.length === 2 ? "grid-cols-2 max-w-2xl" : "grid-cols-3"}`}>
          {candidates.map((candidate) => {
            const verificationKey = studentVerificationKey(mode, candidate);
            return (
              <PodiumCard
                key={`${candidate.student_id}-${candidate.honour_rank}`}
                candidate={candidate}
                position={candidate.honour_rank || 1}
                mode={mode}
                verificationCode={verificationCodes[verificationKey]}
                verificationQr={verificationQrs[verificationKey]}
              />
            );
          })}
        </div>

        {candidates.length === 0 ? (
          <div className="mx-auto mt-16 max-w-xl rounded-3xl border border-dashed border-amber-400 bg-amber-50 px-8 py-10 text-center">
            <AlertTriangle className="mx-auto h-10 w-10 text-amber-700" />
            <p className="mt-3 text-lg font-black text-amber-950">Aucun lauréat ne remplit encore toutes les règles.</p>
          </div>
        ) : null}

        <div className="mt-auto grid grid-cols-2 items-end gap-20 pt-6 text-center">
          <div>
            <div className="mx-auto h-12 w-48 border-b border-slate-500" />
            <p className="mt-2 text-[10px] font-black uppercase tracking-wide">Le professeur principal</p>
          </div>
          <div>
            <div className="mx-auto flex h-12 w-52 items-end justify-center font-serif text-lg font-bold italic text-blue-950">{institution.institution_head_name || ""}</div>
            <div className="mx-auto w-52 border-b border-slate-500" />
            <p className="mt-2 text-[10px] font-black uppercase tracking-wide">{safeText(institution.institution_head_title, "La Direction")}</p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-amber-300 pt-3 text-[9px] font-semibold text-slate-500">
          <span>Le mérite académique est validé avec la conduite · Les rangs ne sont pas réattribués.</span>
          <span>www.mon-cahier.com</span>
          <span>{new Intl.DateTimeFormat("fr-FR").format(new Date())}</span>
        </div>
      </div>
    </section>
  );
}

export default function DistinctionsStudentsPage() {
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [periods, setPeriods] = useState<GradePeriod[]>([]);
  const [institution, setInstitution] = useState<InstitutionMeta>({ institution_name: "Établissement" });
  const [settings, setSettings] = useState<DistinctionSettings>(() => normalizeDistinctionSettings(null));
  const [settingsSourceLabel, setSettingsSourceLabel] = useState("Règles générales Mon Cahier");
  const [academicYear, setAcademicYear] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [level, setLevel] = useState("");
  const [classId, setClassId] = useState("");
  const [mode, setMode] = useState<StudentPalmaresMode>("individual");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadedClasses, setLoadedClasses] = useState<LoadedClass[]>([]);
  const [publicationId, setPublicationId] = useState("");
  const [verificationCodes, setVerificationCodes] = useState<Record<string, string>>({});
  const [verificationQrs, setVerificationQrs] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const [bootstrap, institutionData, settingsData] = await Promise.all([
          readJson<any>(await fetch("/api/admin/notes/bootstrap", { cache: "no-store" })),
          readJson<InstitutionMeta>(await fetch("/api/admin/institution/settings", { cache: "no-store" })),
          readJson<any>(await fetch("/api/admin/distinctions/settings", { cache: "no-store" })),
        ]);
        if (cancelled) return;
        const nextClasses = Array.isArray(bootstrap.classes) ? bootstrap.classes : [];
        const nextYears = Array.isArray(bootstrap.academic_years) ? bootstrap.academic_years : [];
        const currentYear = String(nextYears.find((year: AcademicYear) => year.is_current)?.code || nextYears[0]?.code || "");
        setClasses(nextClasses);
        setYears(nextYears);
        setInstitution(institutionData);
        setSettings(normalizeDistinctionSettings(settingsData.settings));
        setSettingsSourceLabel(String(settingsData.source_label || (settingsData.source === "institution" ? "Règles personnalisées de l’établissement" : "Règles générales Mon Cahier")));
        setAcademicYear(currentYear);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Chargement impossible");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!academicYear) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await readJson<any>(
          await fetch(`/api/admin/institution/grading-periods?academic_year=${encodeURIComponent(academicYear)}`, { cache: "no-store" }),
        );
        if (cancelled) return;
        const nextPeriods = (Array.isArray(data.items) ? data.items : []).filter((period: GradePeriod) => period.is_active !== false);
        setPeriods(nextPeriods);
        setPeriodId(String(nextPeriods[0]?.id || ""));
      } catch (err) {
        if (!cancelled) {
          setPeriods([]);
          setPeriodId("");
          setError(err instanceof Error ? err.message : "Périodes indisponibles");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [academicYear]);

  const yearClasses = useMemo(
    () => classes.filter((schoolClass) => !academicYear || String(schoolClass.academic_year || "") === academicYear),
    [classes, academicYear],
  );

  const levels = useMemo(
    () =>
      Array.from(new Set(yearClasses.map((schoolClass) => safeText(schoolClass.level)).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "fr", { numeric: true }),
      ),
    [yearClasses],
  );

  useEffect(() => {
    if (!levels.length) {
      setLevel("");
      return;
    }
    if (!levels.includes(level)) setLevel(levels[0]);
  }, [levels, level]);

  const levelClasses = useMemo(
    () =>
      yearClasses
        .filter((schoolClass) => !level || safeText(schoolClass.level) === level)
        .sort((a, b) => safeText(a.label).localeCompare(safeText(b.label), "fr", { numeric: true })),
    [yearClasses, level],
  );

  useEffect(() => {
    if (!levelClasses.length) {
      setClassId("");
      return;
    }
    if (mode !== "individual" && classId === "all") return;
    if (!levelClasses.some((schoolClass) => schoolClass.id === classId)) setClassId(levelClasses[0].id);
  }, [levelClasses, classId, mode]);

  const selectedPeriod = useMemo(() => periods.find((period) => period.id === periodId) || null, [periods, periodId]);

  async function fetchClassResult(schoolClass: SchoolClass): Promise<LoadedClass> {
    if (!selectedPeriod?.start_date || !selectedPeriod?.end_date) throw new Error("La période sélectionnée n’a pas de dates complètes.");
    const bulletinParams = new URLSearchParams({
      class_id: schoolClass.id,
      from: selectedPeriod.start_date,
      to: selectedPeriod.end_date,
      export_light: "1",
    });
    const conductParams = new URLSearchParams({
      class_id: schoolClass.id,
      from: selectedPeriod.start_date,
      to: selectedPeriod.end_date,
      academic_year: academicYear,
      period_code: safeText(selectedPeriod.code),
    });

    const [bulletin, conduct] = await Promise.all([
      readJson<BulletinResponse>(await fetch(`/api/admin/grades/bulletin?${bulletinParams.toString()}`, { cache: "no-store" })),
      readJson<ConductResponse>(await fetch(`/api/admin/conduite/averages?${conductParams.toString()}`, { cache: "no-store" })),
    ]);

    const conductByStudent = new Map((conduct.items || []).map((item) => [String(item.student_id), item]));
    return {
      classInfo: {
        id: schoolClass.id,
        label: bulletin.class?.label || schoolClass.label,
        level: bulletin.class?.level || schoolClass.level || null,
        academic_year: bulletin.class?.academic_year || schoolClass.academic_year || null,
      },
      subjects: bulletin.subjects || [],
      students: (bulletin.items || []).map((student) => ({
        ...student,
        conductDetails: conductByStudent.get(String(student.student_id)) || null,
      })),
    };
  }

  async function generate() {
    setPublicationId("");
    setVerificationCodes({});
    setVerificationQrs({});
    setError("");
    setNotice("");
    setLoadedClasses([]);
    if (!selectedPeriod?.start_date || !selectedPeriod?.end_date) {
      setError("Choisis une période possédant une date de début et une date de fin.");
      return;
    }

    const targetClasses =
      mode === "individual"
        ? levelClasses.filter((schoolClass) => schoolClass.id === classId)
        : classId === "all"
          ? levelClasses
          : levelClasses.filter((schoolClass) => schoolClass.id === classId);

    if (!targetClasses.length) {
      setError("Aucune classe ne correspond à cette sélection.");
      return;
    }

    setGenerating(true);
    try {
      const results: LoadedClass[] = [];
      for (let index = 0; index < targetClasses.length; index += 4) {
        const chunk = targetClasses.slice(index, index + 4);
        const rows = await Promise.all(chunk.map(fetchClassResult));
        results.push(...rows);
      }
      setLoadedClasses(results);
      setNotice(`${results.length} classe(s) analysée(s). Les bénéficiaires ont été déterminés automatiquement.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analyse impossible");
    } finally {
      setGenerating(false);
    }
  }

  const candidates = useMemo<Candidate[]>(() => {
    const rows: Candidate[] = [];
    for (const loaded of loadedClasses) {
      for (const student of loaded.students) {
        const conductDetails = student.conductDetails || null;
        const conduct = numberOrNull(
          conductDetails?.conduct_final_avg20 ?? conductDetails?.total ?? student.conduct_avg,
        );
        const general = numberOrNull(student.general_avg);
        let ranking = general;
        let familyCount = 0;
        if (mode === "science" || mode === "literature") {
          const family = familyAverage(student, loaded.subjects, mode, settings);
          ranking = family.average;
          familyCount = family.count;
        }

        const eligibility = evaluateStudentEligibility(
          {
            average: general,
            conduct,
            coverageComplete: student.coverage_is_complete,
            absenceCount: conductDetails?.absence_count ?? null,
          },
          settings.students,
        );

        const reasons = [...eligibility.reasons];
        let status = eligibility.status;
        if ((mode === "science" || mode === "literature") && familyCount < settings.students.min_family_subjects) {
          reasons.push(`Seulement ${familyCount} matière(s) exploitable(s) dans ce domaine`);
          status = "review";
        }

        rows.push({
          student_id: student.student_id,
          full_name: student.full_name,
          matricule: student.matricule || null,
          photo_url: student.photo_url || null,
          class_id: loaded.classInfo.id,
          class_label: loaded.classInfo.label,
          class_level: loaded.classInfo.level || null,
          general_avg: general,
          ranking_avg: ranking,
          conduct_avg: conduct,
          official_rank: numberOrNull(student.rank),
          honour_rank: null,
          family_subject_count: familyCount,
          absence_count: numberOrNull(conductDetails?.absence_count),
          tardy_count: numberOrNull(conductDetails?.tardy_count),
          tier: eligibility.tier,
          status,
          reasons,
        });
      }
    }
    return rows;
  }, [loadedClasses, mode, settings]);

  const rankedCandidates = useMemo(() => {
    if (mode === "individual") return candidates;

    const byClass = new Map<string, Candidate[]>();
    for (const candidate of candidates) {
      const current = byClass.get(candidate.class_id) || [];
      current.push(candidate);
      byClass.set(candidate.class_id, current);
    }

    const ranked: Candidate[] = [];
    for (const rows of byClass.values()) {
      if (mode === "general") {
        const withOfficialRanks = rows.filter((row) => numberOrNull(row.official_rank) !== null);
        if (withOfficialRanks.length > 0) {
          ranked.push(
            ...rows.map((row) => ({
              ...row,
              honour_rank: numberOrNull(row.official_rank),
            })),
          );
          continue;
        }
      }

      const rankable = rows.filter((row) => {
        if (numberOrNull(row.ranking_avg) === null) return false;
        if (mode === "science" || mode === "literature") {
          return row.family_subject_count >= settings.students.min_family_subjects;
        }
        return true;
      });
      const ranks = new Map(
        competitionRanks(rankable, (row) => row.ranking_avg).map((entry) => [
          entry.row.student_id,
          entry.rank,
        ]),
      );
      ranked.push(
        ...rows.map((row) => ({
          ...row,
          honour_rank: ranks.get(row.student_id) ?? null,
        })),
      );
    }
    return ranked;
  }, [candidates, mode, settings.students.min_family_subjects]);

  const winners = useMemo(() => {
    if (mode === "individual") {
      return candidates
        .filter((candidate) => candidate.status === "eligible")
        .sort(
          (a, b) =>
            a.class_label.localeCompare(b.class_label, "fr", { numeric: true }) ||
            Number(a.official_rank || 999) - Number(b.official_rank || 999),
        );
    }

    return rankedCandidates
      .filter(
        (candidate) =>
          candidate.status === "eligible" &&
          candidate.honour_rank !== null &&
          candidate.honour_rank <= 3,
      )
      .sort(
        (a, b) =>
          a.class_label.localeCompare(b.class_label, "fr", { numeric: true }) ||
          Number(a.honour_rank || 99) - Number(b.honour_rank || 99) ||
          Number(b.ranking_avg || 0) - Number(a.ranking_avg || 0),
      );
  }, [candidates, mode, rankedCandidates]);

  const winnerGroups = useMemo(() => {
    const groups = new Map<string, Candidate[]>();
    for (const winner of winners) {
      const current = groups.get(winner.class_id) || [];
      current.push(winner);
      groups.set(winner.class_id, current);
    }
    return Array.from(groups.entries()).map(([id, rows]) => ({
      id,
      classLabel: rows[0]?.class_label || "Classe",
      rows: rows.sort(
        (a, b) =>
          Number(a.honour_rank || 99) - Number(b.honour_rank || 99) ||
          Number(b.ranking_avg || 0) - Number(a.ranking_avg || 0),
      ),
    }));
  }, [winners]);

  const winnerPages = useMemo(
    () =>
      winnerGroups.flatMap((group) => {
        const pages: Array<{ id: string; classLabel: string; rows: Candidate[]; pageIndex: number }> = [];
        for (let index = 0; index < group.rows.length; index += 3) {
          pages.push({
            id: `${group.id}-${index / 3}`,
            classLabel: group.classLabel,
            rows: group.rows.slice(index, index + 3),
            pageIndex: index / 3,
          });
        }
        return pages;
      }),
    [winnerGroups],
  );

  const summary = useMemo(
    () => ({
      eligible: candidates.filter((candidate) => candidate.status === "eligible").length,
      review: candidates.filter((candidate) => candidate.status === "review").length,
      ineligible: candidates.filter((candidate) => candidate.status === "ineligible").length,
    }),
    [candidates],
  );

  async function saveHistory() {
    if (!winners.length || !selectedPeriod) return null;
    if (publicationId && Object.keys(verificationCodes).length > 0) {
      return { publicationId, verificationCodes, verificationQrs };
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const classIds = Array.from(new Set(winners.map((winner) => winner.class_id)));
      const response = await fetch("/api/admin/distinctions/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: `students_${mode}`,
          title: `${MODE_LABELS[mode]} — ${safeText(selectedPeriod.label || selectedPeriod.short_label, "Période")}`,
          academic_year: academicYear,
          period_code: selectedPeriod.code || null,
          date_from: selectedPeriod.start_date || null,
          date_to: selectedPeriod.end_date || null,
          class_ids: classIds,
          recipient_count: winners.length,
          snapshot: {
            mode,
            level,
            recipients: winners.map((winner) => ({
              student_id: winner.student_id,
              full_name: winner.full_name,
              class_id: winner.class_id,
              class_label: winner.class_label,
              general_avg: winner.general_avg,
              ranking_avg: winner.ranking_avg,
              conduct_avg: winner.conduct_avg,
              tier: winner.tier,
              honour_rank: winner.honour_rank,
              award_title:
                mode === "individual"
                  ? DISTINCTION_TIER_LABELS[winner.tier || "encouragement"]
                  : `${MODE_LABELS[mode]} · ${winner.honour_rank || "—"}${winner.honour_rank === 1 ? "er" : "e"} rang`,
            })),
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(data?.message || data?.error || "Enregistrement impossible"));
      const nextCodes = data?.verification_codes && typeof data.verification_codes === "object" ? data.verification_codes : {};
      const nextQrs = await generateVerificationQrs(nextCodes);
      const nextPublicationId = String(data?.item?.id || "");
      setPublicationId(nextPublicationId);
      setVerificationCodes(nextCodes);
      setVerificationQrs(nextQrs);
      setNotice("Palmarès enregistré et cartons sécurisés par QR de vérification.");
      return { publicationId: nextPublicationId, verificationCodes: nextCodes, verificationQrs: nextQrs };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function printSecuredCertificates() {
    if (!winners.length) return;
    const result = await saveHistory();
    if (!result) return;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    window.print();
  }

  if (loading) {
    return (
      <div className="grid min-h-[65vh] place-items-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-amber-600" />
          <p className="mt-3 font-semibold text-slate-600">Préparation du module Distinctions…</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 lg:px-8">
      <style jsx global>{`
        .distinctions-print-zone { display: none; }
        .certificate-sheet { width: 210mm; min-height: 297mm; page: certificate; }
        .podium-sheet { width: 297mm; min-height: 210mm; page: podium; }
        .podium-first { border-color: #d7a20c; transform: translateY(-12px); }
        .podium-second { border-color: #94a3b8; }
        .podium-third { border-color: #b87333; }
        @page certificate { size: A4 portrait; margin: 0; }
        @page podium { size: A4 landscape; margin: 0; }
        @media print {
          @page { margin: 0; }
          body { background: white !important; }
          body * { visibility: hidden !important; }
          .distinctions-print-zone, .distinctions-print-zone * { visibility: visible !important; }
          .distinctions-print-zone { display: block !important; position: absolute !important; inset: 0 !important; width: 100% !important; background: white !important; }
          .print-sheet { margin: 0 !important; box-shadow: none !important; break-after: page; page-break-after: always; }
          .certificate-sheet { width: 210mm !important; height: 297mm !important; }
          .podium-sheet { width: 297mm !important; height: 210mm !important; }
          .print-sheet:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>

      <div className="no-print mx-auto max-w-7xl">
        <section className="overflow-hidden rounded-[32px] bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 px-6 py-7 text-white shadow-xl lg:px-9">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-amber-400/15 px-3 py-1 text-xs font-black uppercase tracking-[0.2em] text-amber-300 ring-1 ring-amber-300/20">
                <Trophy className="h-4 w-4" /> Distinctions élèves
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight lg:text-4xl">Tableaux d’honneur & palmarès</h1>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">
                Mon Cahier identifie automatiquement les élèves méritants en combinant les résultats académiques, la conduite officielle et la complétude des notes.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-sm">
              <div className="text-xs font-black uppercase tracking-wide text-slate-400">Règles appliquées</div>
              <div className="mt-1 font-bold text-white">{settingsSourceLabel}</div>
              <div className="mt-1 text-xs text-slate-400">La conduite est obligatoire pour toute distinction.</div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {(Object.keys(MODE_LABELS) as StudentPalmaresMode[]).map((itemMode) => {
            const Icon = itemMode === "individual" ? Award : itemMode === "general" ? Trophy : itemMode === "science" ? Star : BookOpen;
            const active = mode === itemMode;
            return (
              <button
                key={itemMode}
                type="button"
                onClick={() => {
                  setMode(itemMode);
                  setLoadedClasses([]);
                  if (itemMode === "individual" && classId === "all") setClassId(levelClasses[0]?.id || "");
                }}
                className={`rounded-2xl border p-4 text-left transition ${active ? "border-amber-400 bg-amber-50 shadow-md ring-2 ring-amber-200" : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"}`}
              >
                <div className="flex items-center gap-3">
                  <span className={`grid h-10 w-10 place-items-center rounded-xl ${active ? "bg-amber-600 text-white" : "bg-slate-100 text-slate-600"}`}><Icon className="h-5 w-5" /></span>
                  <div>
                    <div className="font-black text-slate-950">{MODE_LABELS[itemMode]}</div>
                    <div className="mt-1 text-xs leading-snug text-slate-500">{MODE_DESCRIPTIONS[itemMode]}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </section>

        <section className="mt-6 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <label className="block">
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Année scolaire</span>
              <select value={academicYear} onChange={(event) => { setAcademicYear(event.target.value); setLoadedClasses([]); }} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-semibold text-slate-900">
                {years.map((year) => <option key={year.code} value={year.code}>{year.label || year.code}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Période</span>
              <select value={periodId} onChange={(event) => { setPeriodId(event.target.value); setLoadedClasses([]); }} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-semibold text-slate-900">
                {periods.map((period) => <option key={period.id} value={period.id}>{period.label || period.short_label || period.code}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Niveau</span>
              <select value={level} onChange={(event) => { setLevel(event.target.value); setLoadedClasses([]); }} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-semibold text-slate-900">
                {levels.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">Classe</span>
              <select value={classId} onChange={(event) => { setClassId(event.target.value); setLoadedClasses([]); }} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-semibold text-slate-900">
                {mode !== "individual" ? <option value="all">Toutes les classes du niveau</option> : null}
                {levelClasses.map((schoolClass) => <option key={schoolClass.id} value={schoolClass.id}>{schoolClass.label}</option>)}
              </select>
            </label>
            <div className="flex items-end">
              <button type="button" onClick={generate} disabled={generating || !periodId || !classId} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 font-black text-white shadow-lg transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                {generating ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
                {generating ? "Analyse en cours…" : "Analyser et générer"}
              </button>
            </div>
          </div>
          {selectedPeriod ? (
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
              <span className="rounded-full bg-slate-100 px-3 py-1">Du {formatDate(selectedPeriod.start_date)}</span>
              <span className="rounded-full bg-slate-100 px-3 py-1">Au {formatDate(selectedPeriod.end_date)}</span>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">Les rangs non éligibles ne sont jamais réattribués</span>
            </div>
          ) : null}
        </section>

        {error ? <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 font-semibold text-rose-800">{error}</div> : null}
        {notice ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-semibold text-emerald-800">{notice}</div> : null}

        {loadedClasses.length > 0 ? (
          <>
            <section className="mt-6 grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><Users className="h-5 w-5 text-slate-500" /><div className="mt-2 text-3xl font-black text-slate-950">{candidates.length}</div><div className="text-xs font-bold uppercase text-slate-500">Élèves analysés</div></div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><CheckCircle2 className="h-5 w-5 text-emerald-700" /><div className="mt-2 text-3xl font-black text-emerald-950">{summary.eligible}</div><div className="text-xs font-bold uppercase text-emerald-700">Éligibles</div></div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><AlertTriangle className="h-5 w-5 text-amber-700" /><div className="mt-2 text-3xl font-black text-amber-950">{summary.review}</div><div className="text-xs font-bold uppercase text-amber-700">À vérifier</div></div>
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4"><XCircle className="h-5 w-5 text-rose-700" /><div className="mt-2 text-3xl font-black text-rose-950">{summary.ineligible}</div><div className="text-xs font-bold uppercase text-rose-700">Non éligibles</div></div>
            </section>

            <section className="mt-6 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-black text-slate-950">Bénéficiaires prêts à imprimer</h2>
                  <p className="mt-1 text-sm text-slate-500">{winners.length} élève(s) retenu(s) automatiquement pour {MODE_LABELS[mode].toLowerCase()}.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void saveHistory()} disabled={saving || winners.length === 0} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer
                  </button>
                  <button type="button" onClick={() => void printSecuredCertificates()} disabled={saving || winners.length === 0} className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 font-black text-white shadow hover:bg-amber-700 disabled:opacity-50">
                    <Printer className="h-4 w-4" /> Sécuriser et imprimer
                  </button>
                </div>
              </div>

              <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-100 text-left text-xs font-black uppercase tracking-wide text-slate-600">
                    <tr><th className="px-4 py-3">Élève</th><th className="px-4 py-3">Classe</th><th className="px-4 py-3">Moyenne</th><th className="px-4 py-3">Rang du palmarès</th><th className="px-4 py-3">Conduite</th><th className="px-4 py-3">Distinction</th><th className="px-4 py-3">Statut</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(mode === "individual" ? candidates : rankedCandidates)
                      .slice()
                      .sort((a, b) => a.class_label.localeCompare(b.class_label, "fr", { numeric: true }) || Number(b.ranking_avg || -1) - Number(a.ranking_avg || -1))
                      .map((candidate) => (
                        <tr key={`${candidate.class_id}-${candidate.student_id}`} className={candidate.status === "eligible" ? "bg-white" : "bg-slate-50/70"}>
                          <td className="px-4 py-3 font-bold text-slate-950">{candidate.full_name}<div className="mt-1 text-xs font-normal text-slate-500">{candidate.reasons.join(" · ")}</div></td>
                          <td className="px-4 py-3 font-semibold text-slate-700">{candidate.class_label}</td>
                          <td className="px-4 py-3 font-black text-slate-900">{formatAverage(candidate.ranking_avg)}</td>
                          <td className="px-4 py-3 font-black text-slate-900">{mode === "individual" ? "—" : candidate.honour_rank ? `${candidate.honour_rank}${candidate.honour_rank === 1 ? "er" : "e"}` : "—"}</td>
                          <td className="px-4 py-3 font-black text-slate-900">{formatAverage(candidate.conduct_avg)}</td>
                          <td className="px-4 py-3 text-xs font-bold text-amber-800">{candidate.tier ? DISTINCTION_TIER_LABELS[candidate.tier] : "—"}</td>
                          <td className="px-4 py-3"><StatusBadge status={candidate.status} /></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mt-6 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3"><FileClock className="h-5 w-5 text-amber-700" /><div><h2 className="font-black text-slate-950">Aperçu d’impression</h2><p className="text-xs text-slate-500">Le rendu final utilise le format A4 portrait pour les tableaux individuels et paysage pour les podiums.</p></div></div>
              <div className="mt-5 overflow-auto rounded-2xl bg-slate-200 p-4">
                <div className="origin-top-left scale-[0.48] lg:scale-[0.58]" style={{ width: mode === "individual" ? "210mm" : "297mm", height: mode === "individual" ? "150mm" : "122mm" }}>
                  {mode === "individual" && winners[0] ? (
                    <CertificateFrame
                      institution={institution}
                      candidate={winners[0]}
                      period={selectedPeriod}
                      academicYear={academicYear}
                      verificationCode={verificationCodes[studentVerificationKey(mode, winners[0])]}
                      verificationQr={verificationQrs[studentVerificationKey(mode, winners[0])]}
                    />
                  ) : winnerPages[0] ? (
                    <PodiumSheet
                      institution={institution}
                      classLabel={winnerPages[0].classLabel}
                      candidates={winnerPages[0].rows}
                      period={selectedPeriod}
                      academicYear={academicYear}
                      mode={mode}
                      verificationCodes={verificationCodes}
                      verificationQrs={verificationQrs}
                    />
                  ) : null}
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>

      <div className="distinctions-print-zone">
        {mode === "individual"
          ? winners.map((candidate) => {
              const verificationKey = studentVerificationKey(mode, candidate);
              return (
                <CertificateFrame
                  key={`${candidate.class_id}-${candidate.student_id}`}
                  institution={institution}
                  candidate={candidate}
                  period={selectedPeriod}
                  academicYear={academicYear}
                  verificationCode={verificationCodes[verificationKey]}
                  verificationQr={verificationQrs[verificationKey]}
                />
              );
            })
          : winnerPages.map((group) => (
              <PodiumSheet
                key={group.id}
                institution={institution}
                classLabel={group.classLabel}
                candidates={group.rows}
                period={selectedPeriod}
                academicYear={academicYear}
                mode={mode}
                verificationCodes={verificationCodes}
                verificationQrs={verificationQrs}
              />
            ))}
      </div>
    </main>
  );
}
