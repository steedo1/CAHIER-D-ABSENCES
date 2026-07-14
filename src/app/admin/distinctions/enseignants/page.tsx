"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Award,
  BookOpen,
  CheckCircle2,
  Clock3,
  Crown,
  GraduationCap,
  Loader2,
  Printer,
  QrCode,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy,
  UserRoundCheck,
  XCircle,
} from "lucide-react";

type AcademicYear = { code: string; label?: string | null; is_current?: boolean | null };
type GradePeriod = { id: string; code?: string | null; label?: string | null; short_label?: string | null; start_date?: string | null; end_date?: string | null; is_active?: boolean | null };
type InstitutionMeta = { institution_name: string; institution_logo_url?: string; institution_region?: string; institution_head_name?: string; institution_head_title?: string; country_name?: string; country_motto?: string; ministry_name?: string; institution_code?: string };

type TeacherItem = {
  teacher_id: string;
  teacher_name: string;
  subject_names: string[];
  rank: number;
  score: number;
  status: "eligible" | "review" | "ineligible";
  review_reasons: string[];
  metrics: {
    planned_sessions: number;
    completed_sessions: number;
    justified_absence_sessions: number;
    attendance_rate: number;
    punctual_sessions: number;
    punctuality_rate: number;
    average_lateness_minutes: number;
    evaluations_total: number;
    evaluations_published: number;
    evaluation_publication_rate: number;
    textbook_assignments: number;
    textbook_expected_items: number;
    textbook_completed_items: number;
    textbook_completion_rate: number;
    digital_engagement_rate: number;
  };
};

type TeacherResponse = {
  ok: boolean;
  error?: string;
  institution_name?: string;
  academic_year?: string | null;
  from?: string;
  to?: string;
  criteria_warnings?: string[];
  items?: TeacherItem[];
};

type TeacherAward = {
  key: string;
  title: string;
  subtitle: string;
  teacher: TeacherItem;
  metricLabel: string;
  metricValue: string;
  icon: "crown" | "attendance" | "punctuality" | "evaluations" | "textbook" | "digital";
};

async function readJson<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String((json as any)?.message || (json as any)?.error || `Erreur HTTP ${response.status}`));
  return json as T;
}

const TEACHER_DISTINCTION_QR_CACHE = new Map<string, string>();
let teacherDistinctionQrLibPromise: Promise<any> | null = null;

function teacherVerificationKey(award: Pick<TeacherAward, "key">) {
  return `teacher:${award.key}`;
}

async function generateTeacherVerificationQr(code: string) {
  const cleanCode = String(code || "").trim();
  if (!cleanCode || typeof window === "undefined") return "";
  const url = `${window.location.origin}/v/distinction/${cleanCode}`;
  const cached = TEACHER_DISTINCTION_QR_CACHE.get(url);
  if (cached) return cached;
  if (!teacherDistinctionQrLibPromise) teacherDistinctionQrLibPromise = import("qrcode");
  const mod: any = await teacherDistinctionQrLibPromise;
  const toDataURL = mod?.toDataURL || mod?.default?.toDataURL;
  if (typeof toDataURL !== "function") return "";
  const dataUrl = await toDataURL(url, { width: 220, margin: 1, errorCorrectionLevel: "Q" });
  if (dataUrl) TEACHER_DISTINCTION_QR_CACHE.set(url, dataUrl);
  return dataUrl || "";
}

async function generateTeacherVerificationQrs(codes: Record<string, string>) {
  const entries = await Promise.all(
    Object.entries(codes).map(async ([key, code]) => [key, await generateTeacherVerificationQr(code)] as const),
  );
  return Object.fromEntries(entries.filter(([, value]) => Boolean(value)));
}

function safeText(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(1).replace(".", ",")} %` : "—";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(`${value}T12:00:00`));
  } catch {
    return value;
  }
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "EN";
}

function StatusBadge({ status }: { status: TeacherItem["status"] }) {
  if (status === "eligible") return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800"><CheckCircle2 className="h-3.5 w-3.5" /> Éligible</span>;
  if (status === "review") return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800"><AlertTriangle className="h-3.5 w-3.5" /> À vérifier</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800"><XCircle className="h-3.5 w-3.5" /> Non éligible</span>;
}

function AwardIcon({ kind, className = "h-10 w-10" }: { kind: TeacherAward["icon"]; className?: string }) {
  if (kind === "crown") return <Crown className={className} />;
  if (kind === "attendance") return <UserRoundCheck className={className} />;
  if (kind === "punctuality") return <Clock3 className={className} />;
  if (kind === "evaluations") return <GraduationCap className={className} />;
  if (kind === "textbook") return <BookOpen className={className} />;
  return <Sparkles className={className} />;
}

function OfficialHeader({ institution }: { institution: InstitutionMeta }) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-4 text-[11px] font-semibold uppercase leading-snug text-slate-700">
      <div><div>{safeText(institution.country_name, "République de Côte d’Ivoire")}</div><div className="mt-1 normal-case italic">{safeText(institution.country_motto, "Union · Discipline · Travail")}</div><div className="mt-3">{safeText(institution.ministry_name, "Ministère de l’Éducation Nationale")}</div></div>
      <div className="flex min-w-[110px] justify-center">{institution.institution_logo_url ? <img src={institution.institution_logo_url} alt="Logo" className="h-24 w-24 object-contain" /> : <div className="grid h-20 w-20 place-items-center rounded-full border-2 border-amber-500 bg-amber-50"><Trophy className="h-10 w-10 text-amber-700" /></div>}</div>
      <div className="text-right"><div>{safeText(institution.institution_region, "Direction régionale")}</div><div className="mt-3 text-[13px] font-black text-slate-900">{safeText(institution.institution_name, "Établissement")}</div>{institution.institution_code ? <div className="mt-1">Code : {institution.institution_code}</div> : null}</div>
    </div>
  );
}

function TeacherCertificate({
  institution,
  award,
  periodLabel,
  academicYear,
  verificationCode,
  verificationQr,
}: {
  institution: InstitutionMeta;
  award: TeacherAward;
  periodLabel: string;
  academicYear: string;
  verificationCode?: string;
  verificationQr?: string;
}) {
  const teacher = award.teacher;
  return (
    <section className="teacher-print-sheet relative mx-auto overflow-hidden bg-[#fffdf7] p-[13mm] text-slate-900 shadow-2xl print:shadow-none">
      <div className="absolute inset-[6mm] border-[3px] border-double border-amber-700" />
      <div className="absolute inset-[9mm] border border-amber-300" />
      <div className="absolute -right-20 top-36 h-72 w-72 rounded-full border-[34px] border-amber-100/70" />
      <div className="absolute -left-24 bottom-16 h-64 w-64 rounded-full border-[30px] border-blue-100/60" />
      <div className="relative z-10 flex h-full flex-col">
        <OfficialHeader institution={institution} />
        <div className="mt-7 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-2 text-xs font-black uppercase tracking-[0.24em] text-amber-300"><AwardIcon kind={award.icon} className="h-4 w-4" /> Distinction professionnelle</div>
          <h1 className="mt-4 font-serif text-4xl font-black uppercase tracking-[0.07em] text-slate-950">{award.title}</h1>
          <p className="mt-2 text-base font-bold text-amber-800">{award.subtitle}</p>
        </div>

        <div className="mx-auto mt-8 grid h-36 w-36 place-items-center rounded-full border-[8px] border-double border-amber-600 bg-gradient-to-br from-slate-950 to-blue-950 text-4xl font-black text-white shadow-xl">{initials(teacher.teacher_name)}</div>
        <div className="mt-6 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Décerné à</p>
          <h2 className="mt-2 font-serif text-[34px] font-black leading-tight text-slate-950">{teacher.teacher_name}</h2>
          <p className="mt-2 text-sm font-bold text-slate-600">{teacher.subject_names.join(" · ") || "Enseignant"}</p>
        </div>

        <div className="mx-auto mt-7 max-w-2xl rounded-[28px] border border-amber-200 bg-white/85 px-8 py-6 text-center shadow-sm">
          <p className="text-[15px] leading-relaxed text-slate-700">En reconnaissance de son professionnalisme, de sa régularité et de son engagement mesurable dans le suivi pédagogique et numérique des élèves.</p>
          <div className="mx-auto mt-5 inline-flex items-center gap-3 rounded-2xl bg-slate-950 px-6 py-3 text-white"><Star className="h-6 w-6 text-amber-400" /><div><div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-300">{award.metricLabel}</div><div className="text-2xl font-black">{award.metricValue}</div></div></div>
        </div>

        <div className="mt-7 grid grid-cols-5 gap-3 text-center text-xs">
          <div className="rounded-2xl border border-slate-200 bg-white p-3"><div className="font-black text-slate-950">{formatPercent(teacher.metrics.attendance_rate)}</div><div className="mt-1 text-[9px] font-bold uppercase text-slate-500">Assiduité</div></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3"><div className="font-black text-slate-950">{formatPercent(teacher.metrics.punctuality_rate)}</div><div className="mt-1 text-[9px] font-bold uppercase text-slate-500">Ponctualité</div></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3"><div className="font-black text-slate-950">{formatPercent(teacher.metrics.evaluation_publication_rate)}</div><div className="mt-1 text-[9px] font-bold uppercase text-slate-500">Évaluations</div></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3"><div className="font-black text-slate-950">{formatPercent(teacher.metrics.textbook_completion_rate)}</div><div className="mt-1 text-[9px] font-bold uppercase text-slate-500">Cahier de texte</div></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3"><div className="font-black text-slate-950">{teacher.score.toFixed(1)} /100</div><div className="mt-1 text-[9px] font-bold uppercase text-slate-500">Score global</div></div>
        </div>

        <div className="mt-auto grid grid-cols-[1fr_auto_1fr] items-end gap-7 pt-7 text-center">
          <div><div className="mx-auto h-14 w-48 border-b border-slate-500" /><p className="mt-2 text-[10px] font-black uppercase tracking-wide">Le responsable pédagogique</p></div>
          <div className="flex min-w-[92px] flex-col items-center justify-end">
            {verificationQr ? (
              <>
                <img src={verificationQr} alt="QR de vérification" className="h-[78px] w-[78px] rounded-md border border-slate-300 bg-white p-1" />
                <p className="mt-1 text-[8px] font-black uppercase tracking-wide text-slate-500">Vérifier l’authenticité</p>
                <p className="max-w-[92px] truncate text-[7px] font-semibold text-slate-400">{verificationCode}</p>
              </>
            ) : (
              <div className="grid h-[78px] w-[78px] place-items-center rounded-md border border-dashed border-slate-300 bg-white/70"><QrCode className="h-8 w-8 text-slate-300" /></div>
            )}
          </div>
          <div><div className="mx-auto flex h-14 w-52 items-end justify-center font-serif text-lg font-bold italic text-blue-950">{institution.institution_head_name || ""}</div><div className="mx-auto w-52 border-b border-slate-500" /><p className="mt-2 text-[10px] font-black uppercase tracking-wide">{safeText(institution.institution_head_title, "La Direction")}</p></div>
        </div>
        <div className="mt-6 flex items-center justify-between border-t border-amber-300 pt-3 text-[9px] font-semibold text-slate-500"><span>{periodLabel} · {academicYear}</span><span>www.mon-cahier.com</span><span>{new Intl.DateTimeFormat("fr-FR").format(new Date())}</span></div>
      </div>
    </section>
  );
}

export default function TeacherDistinctionsPage() {
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [periods, setPeriods] = useState<GradePeriod[]>([]);
  const [institution, setInstitution] = useState<InstitutionMeta>({ institution_name: "Établissement" });
  const [academicYear, setAcademicYear] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [items, setItems] = useState<TeacherItem[]>([]);
  const [criteriaWarnings, setCriteriaWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [publicationId, setPublicationId] = useState("");
  const [verificationCodes, setVerificationCodes] = useState<Record<string, string>>({});
  const [verificationQrs, setVerificationQrs] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [bootstrap, institutionData] = await Promise.all([
          readJson<any>(await fetch("/api/admin/notes/bootstrap", { cache: "no-store" })),
          readJson<InstitutionMeta>(await fetch("/api/admin/institution/settings", { cache: "no-store" })),
        ]);
        if (cancelled) return;
        const nextYears = Array.isArray(bootstrap.academic_years) ? bootstrap.academic_years : [];
        setYears(nextYears);
        setInstitution(institutionData);
        setAcademicYear(String(nextYears.find((year: AcademicYear) => year.is_current)?.code || nextYears[0]?.code || ""));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Chargement impossible");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!academicYear) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await readJson<any>(await fetch(`/api/admin/institution/grading-periods?academic_year=${encodeURIComponent(academicYear)}`, { cache: "no-store" }));
        if (cancelled) return;
        const next = (Array.isArray(data.items) ? data.items : []).filter((period: GradePeriod) => period.is_active !== false);
        setPeriods(next);
        setPeriodId(String(next[0]?.id || ""));
        setItems([]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Périodes indisponibles");
      }
    })();
    return () => { cancelled = true; };
  }, [academicYear]);

  const period = useMemo(() => periods.find((item) => item.id === periodId) || null, [periods, periodId]);

  async function generate() {
    setPublicationId("");
    setVerificationCodes({});
    setVerificationQrs({});
    if (!period?.start_date || !period?.end_date) {
      setError("La période sélectionnée doit avoir des dates complètes.");
      return;
    }
    setGenerating(true);
    setError("");
    setNotice("");
    setItems([]);
    setCriteriaWarnings([]);
    try {
      const params = new URLSearchParams({ academic_year: academicYear, from: period.start_date, to: period.end_date });
      const data = await readJson<TeacherResponse>(await fetch(`/api/admin/distinctions/teachers?${params.toString()}`, { cache: "no-store" }));
      setItems(data.items || []);
      setCriteriaWarnings(data.criteria_warnings || []);
      setNotice(`${data.items?.length || 0} enseignant(s) analysé(s) à partir des données disponibles dans la plateforme.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analyse impossible");
    } finally {
      setGenerating(false);
    }
  }

  const eligible = useMemo(() => items.filter((item) => item.status === "eligible"), [items]);
  const overall = useMemo(
    () => eligible.filter((teacher) => teacher.rank <= 3),
    [eligible],
  );

  const awards = useMemo<TeacherAward[]>(() => {
    if (!items.length) return [];
    const result: TeacherAward[] = [];

    overall.forEach((teacher) => {
      result.push({
        key: `overall-${teacher.teacher_id}`,
        title:
          teacher.rank === 1
            ? "Enseignant modèle"
            : `Mérite professionnel · ${teacher.rank}${teacher.rank === 1 ? "er" : "e"} prix`,
        subtitle: "Palmarès général des enseignants · rang non réattribué",
        teacher,
        metricLabel: "Score global",
        metricValue: `${teacher.score.toFixed(1)} / 100`,
        icon: teacher.rank === 1 ? "crown" : "digital",
      });
    });

    const specials: Array<{
      key: string;
      title: string;
      subtitle: string;
      metric: (teacher: TeacherItem) => number;
      label: string;
      icon: TeacherAward["icon"];
    }> = [
      { key: "attendance", title: "Prix de l’assiduité", subtitle: "Présence effective aux séances programmées", metric: (teacher) => teacher.metrics.attendance_rate, label: "Taux d’assiduité", icon: "attendance" },
      { key: "punctuality", title: "Prix de la ponctualité", subtitle: "Démarrage régulier des appels dans le créneau", metric: (teacher) => teacher.metrics.punctuality_rate, label: "Taux de ponctualité", icon: "punctuality" },
      { key: "evaluations", title: "Prix du suivi des évaluations", subtitle: "Évaluations publiées et suivi des résultats", metric: (teacher) => teacher.metrics.evaluation_publication_rate, label: "Publication des évaluations", icon: "evaluations" },
      { key: "textbook", title: "Prix du suivi pédagogique", subtitle: "Régularité du cahier de texte et des progressions", metric: (teacher) => teacher.metrics.textbook_completion_rate, label: "Progression renseignée", icon: "textbook" },
      { key: "digital", title: "Prix de l’engagement numérique", subtitle: "Utilisation régulière des outils Mon Cahier", metric: (teacher) => teacher.metrics.digital_engagement_rate, label: "Indice d’engagement", icon: "digital" },
    ];

    for (const special of specials) {
      const sorted = items
        .slice()
        .sort(
          (a, b) =>
            special.metric(b) - special.metric(a) ||
            b.score - a.score ||
            a.teacher_name.localeCompare(b.teacher_name, "fr"),
        );
      const leader = sorted[0];
      if (!leader || special.metric(leader) <= 0) continue;
      const topMetric = special.metric(leader);
      const leaders = sorted.filter(
        (teacher) => Math.abs(special.metric(teacher) - topMetric) < 0.0001,
      );
      const eligibleLeaders = leaders.filter((teacher) => teacher.status === "eligible");
      for (const teacher of eligibleLeaders) {
        result.push({
          key: `${special.key}-${teacher.teacher_id}`,
          title: special.title,
          subtitle: `${special.subtitle}${leaders.length > 1 ? " · Ex æquo" : ""}`,
          teacher,
          metricLabel: special.label,
          metricValue: formatPercent(special.metric(teacher)),
          icon: special.icon,
        });
      }
    }
    return result;
  }, [items, overall]);

  async function saveHistory() {
    if (!period || !awards.length) return null;
    if (publicationId && Object.keys(verificationCodes).length > 0) {
      return { publicationId, verificationCodes, verificationQrs };
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/distinctions/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "teachers",
          title: `Distinctions enseignants — ${safeText(period.label || period.short_label, "Période")}`,
          academic_year: academicYear,
          period_code: period.code || null,
          date_from: period.start_date || null,
          date_to: period.end_date || null,
          class_ids: [],
          recipient_count: new Set(awards.map((award) => award.teacher.teacher_id)).size,
          snapshot: {
            criteria_warnings: criteriaWarnings,
            awards: awards.map((award) => ({
              key: award.key,
              title: award.title,
              teacher_id: award.teacher.teacher_id,
              teacher_name: award.teacher.teacher_name,
              score: award.teacher.score,
              metric_label: award.metricLabel,
              metric_value: award.metricValue,
            })),
          },
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(json?.message || json?.error || "Enregistrement impossible"));
      const nextCodes = json?.verification_codes && typeof json.verification_codes === "object" ? json.verification_codes : {};
      const nextQrs = await generateTeacherVerificationQrs(nextCodes);
      const nextPublicationId = String(json?.item?.id || "");
      setPublicationId(nextPublicationId);
      setVerificationCodes(nextCodes);
      setVerificationQrs(nextQrs);
      setNotice("Palmarès enregistré et cartons enseignants sécurisés par QR de vérification.");
      return { publicationId: nextPublicationId, verificationCodes: nextCodes, verificationQrs: nextQrs };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function printSecuredCertificates() {
    if (!awards.length) return;
    const result = await saveHistory();
    if (!result) return;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    window.print();
  }

  if (loading) return <div className="grid min-h-[65vh] place-items-center"><div className="text-center"><Loader2 className="mx-auto h-10 w-10 animate-spin text-amber-600" /><p className="mt-3 font-semibold text-slate-600">Préparation des distinctions enseignants…</p></div></div>;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 lg:px-8">
      <style jsx global>{`
        .teacher-print-zone { display: none; }
        .teacher-print-sheet { width: 210mm; min-height: 297mm; }
        @media print {
          @page { size: A4 portrait; margin: 0; }
          body * { visibility: hidden !important; }
          .teacher-print-zone, .teacher-print-zone * { visibility: visible !important; }
          .teacher-print-zone { display: block !important; position: absolute !important; inset: 0 !important; width: 100% !important; background: white !important; }
          .teacher-print-sheet { width: 210mm !important; height: 297mm !important; break-after: page; page-break-after: always; box-shadow: none !important; }
          .teacher-print-sheet:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>
      <div className="mx-auto max-w-7xl">
        <section className="rounded-[32px] bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 px-6 py-7 text-white shadow-xl lg:px-9">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between"><div><div className="inline-flex items-center gap-2 rounded-full bg-amber-400/15 px-3 py-1 text-xs font-black uppercase tracking-[0.2em] text-amber-300 ring-1 ring-amber-300/20"><ShieldCheck className="h-4 w-4" /> Distinctions enseignants</div><h1 className="mt-4 text-3xl font-black tracking-tight lg:text-4xl">Mérite professionnel & engagement</h1><p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">Le palmarès repose sur des données observables : assiduité, ponctualité, évaluations, cahier de texte et engagement numérique. Les moyennes brutes des élèves ne sont pas utilisées pour éviter les comparaisons injustes.</p></div><div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-sm"><div className="text-xs font-black uppercase tracking-wide text-slate-400">Principe</div><div className="mt-1 font-bold">Mesurer, expliquer, puis valoriser</div><div className="mt-1 text-xs text-slate-400">Une activité insuffisante est signalée « À vérifier » et les rangs ne sont jamais réattribués.</div></div></div>
        </section>

        <section className="mt-6 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
          <div className="grid gap-4 md:grid-cols-3">
            <label><span className="text-xs font-black uppercase tracking-wide text-slate-500">Année scolaire</span><select value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-semibold text-slate-900">{years.map((year) => <option key={year.code} value={year.code}>{year.label || year.code}</option>)}</select></label>
            <label><span className="text-xs font-black uppercase tracking-wide text-slate-500">Période</span><select value={periodId} onChange={(event) => { setPeriodId(event.target.value); setItems([]); }} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-semibold text-slate-900">{periods.map((item) => <option key={item.id} value={item.id}>{item.label || item.short_label || item.code}</option>)}</select></label>
            <div className="flex items-end"><button type="button" onClick={generate} disabled={generating || !periodId} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 font-black text-white shadow-lg hover:bg-slate-800 disabled:opacity-50">{generating ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}{generating ? "Analyse en cours…" : "Calculer le palmarès"}</button></div>
          </div>
          {period ? <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-slate-500"><span className="rounded-full bg-slate-100 px-3 py-1">Du {formatDate(period.start_date)}</span><span className="rounded-full bg-slate-100 px-3 py-1">Au {formatDate(period.end_date)}</span></div> : null}
        </section>

        {error ? <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 font-semibold text-rose-800">{error}</div> : null}
        {notice ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-semibold text-emerald-800">{notice}</div> : null}
        {criteriaWarnings.length > 0 ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            <div className="flex items-center gap-2 font-black"><AlertTriangle className="h-4 w-4" /> Critères neutralisés automatiquement</div>
            <div className="mt-2">{criteriaWarnings.join(" · ")}</div>
          </div>
        ) : null}

        {items.length > 0 ? (
          <>
            <section className="mt-6 grid gap-4 md:grid-cols-4"><div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><Trophy className="h-5 w-5 text-slate-500" /><div className="mt-2 text-3xl font-black text-slate-950">{items.length}</div><div className="text-xs font-bold uppercase text-slate-500">Enseignants analysés</div></div><div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><CheckCircle2 className="h-5 w-5 text-emerald-700" /><div className="mt-2 text-3xl font-black text-emerald-950">{eligible.length}</div><div className="text-xs font-bold uppercase text-emerald-700">Éligibles</div></div><div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><AlertTriangle className="h-5 w-5 text-amber-700" /><div className="mt-2 text-3xl font-black text-amber-950">{items.filter((item) => item.status === "review").length}</div><div className="text-xs font-bold uppercase text-amber-700">À vérifier</div></div><div className="rounded-2xl border border-blue-200 bg-blue-50 p-4"><Award className="h-5 w-5 text-blue-700" /><div className="mt-2 text-3xl font-black text-blue-950">{awards.length}</div><div className="text-xs font-bold uppercase text-blue-700">Cartons préparés</div></div></section>

            <section className="mt-6 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-black text-slate-950">Palmarès calculé</h2><p className="mt-1 text-sm text-slate-500">Les raisons de vérification restent visibles avant toute impression.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void saveHistory()} disabled={saving || awards.length === 0} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-bold text-slate-800 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer</button><button type="button" onClick={() => void printSecuredCertificates()} disabled={saving || awards.length === 0} className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 font-black text-white shadow hover:bg-amber-700 disabled:opacity-50"><Printer className="h-4 w-4" /> Sécuriser et imprimer</button></div></div>

              <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200"><table className="min-w-full text-sm"><thead className="bg-slate-100 text-left text-xs font-black uppercase tracking-wide text-slate-600"><tr><th className="px-4 py-3">Rang</th><th className="px-4 py-3">Enseignant</th><th className="px-4 py-3">Score</th><th className="px-4 py-3">Assiduité</th><th className="px-4 py-3">Ponctualité</th><th className="px-4 py-3">Évaluations</th><th className="px-4 py-3">Cahier de texte</th><th className="px-4 py-3">Statut</th></tr></thead><tbody className="divide-y divide-slate-100">{items.map((teacher) => <tr key={teacher.teacher_id}><td className="px-4 py-3 font-black text-slate-950">{teacher.rank}</td><td className="px-4 py-3 font-bold text-slate-950">{teacher.teacher_name}<div className="mt-1 text-xs font-normal text-slate-500">{teacher.subject_names.join(" · ")}{teacher.review_reasons.length ? ` — ${teacher.review_reasons.join(" · ")}` : ""}</div></td><td className="px-4 py-3 text-lg font-black text-slate-950">{teacher.score.toFixed(1)}</td><td className="px-4 py-3 font-bold">{formatPercent(teacher.metrics.attendance_rate)}</td><td className="px-4 py-3 font-bold">{formatPercent(teacher.metrics.punctuality_rate)}</td><td className="px-4 py-3 font-bold">{formatPercent(teacher.metrics.evaluation_publication_rate)}</td><td className="px-4 py-3 font-bold">{formatPercent(teacher.metrics.textbook_completion_rate)}</td><td className="px-4 py-3"><StatusBadge status={teacher.status} /></td></tr>)}</tbody></table></div>
            </section>

            <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{awards.map((award) => <div key={award.key} className="rounded-[26px] border border-amber-200 bg-gradient-to-br from-white to-amber-50 p-5 shadow-sm"><div className="flex items-start gap-3"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-950 text-amber-300"><AwardIcon kind={award.icon} className="h-6 w-6" /></span><div><div className="font-black text-slate-950">{award.title}</div><div className="mt-1 text-xs text-slate-500">{award.subtitle}</div></div></div><div className="mt-4 text-lg font-black text-blue-950">{award.teacher.teacher_name}</div><div className="mt-2 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-900">{award.metricLabel} : {award.metricValue}</div></div>)}</section>
          </>
        ) : null}
      </div>

      <div className="teacher-print-zone">
        {awards.map((award) => {
          const verificationKey = teacherVerificationKey(award);
          return (
            <TeacherCertificate
              key={award.key}
              institution={institution}
              award={award}
              periodLabel={safeText(period?.label || period?.short_label, "Période")}
              academicYear={academicYear}
              verificationCode={verificationCodes[verificationKey]}
              verificationQr={verificationQrs[verificationKey]}
            />
          );
        })}
      </div>
    </main>
  );
}
