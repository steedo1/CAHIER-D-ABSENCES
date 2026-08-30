"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Printer, RotateCcw } from "lucide-react";

type Student = {
  id: string;
  matricule: string | null;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  class_id: string | null;
  class_label: string | null;
  level: string | null;
  gender: string | null;
  birthdate: string | null;
  lv2: string | null;
  is_boarder: boolean | null;
  is_affecte: boolean | null;
  is_scholarship: boolean | null;
  regime: string | null;
};

type Institution = {
  institution_name?: string | null;
  name?: string | null;
  institution_logo_url?: string | null;
  institution_phone?: string | null;
  institution_email?: string | null;
  institution_region?: string | null;
  institution_postal_address?: string | null;
  institution_status?: string | null;
  country_name?: string | null;
  country_motto?: string | null;
  ministry_name?: string | null;
  institution_code?: string | null;
};

type Choice = "all" | "yes" | "no";
type SexChoice = "all" | "F" | "M";
type Lv2Choice = "all" | "allemand" | "espagnol";

const MON_CAHIER_EXPORT_SIGNATURE =
  "Mon Cahier — La plateforme complète de gestion scolaire | www.mon-cahier.com";

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function norm(value: unknown) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function sex(value: unknown): "F" | "M" | null {
  const v = norm(value);
  if (!v) return null;
  if (v.startsWith("f")) return "F";
  if (v.startsWith("m") || v.startsWith("h") || v.startsWith("g")) return "M";
  return null;
}

function lv2(value: unknown): "allemand" | "espagnol" | null {
  const v = norm(value);
  if (!v) return null;
  if (v.includes("allem") || v === "all") return "allemand";
  if (v.includes("esp") || v === "esp") return "espagnol";
  return null;
}

function ageOf(value: string | null | undefined) {
  const raw = clean(value).slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const now = new Date();
  let age = now.getFullYear() - year;
  const beforeBirthday =
    now.getMonth() + 1 < month ||
    (now.getMonth() + 1 === month && now.getDate() < day);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

function boolMatches(value: boolean | null, choice: Choice) {
  if (choice === "all") return true;
  return choice === "yes" ? value === true : value === false;
}

function labelBool(value: boolean | null, yes: string, no: string) {
  if (value === true) return yes;
  if (value === false) return no;
  return "—";
}

function displayLevel(value: string | null | undefined) {
  return clean(value) || "—";
}

function sortedUnique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map(clean).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "fr", { sensitivity: "base", numeric: true }),
  );
}

function filterLabel(args: {
  level: string;
  boarding: Choice;
  affectation: Choice;
  scholarship: Choice;
  gender: SexChoice;
  language: Lv2Choice;
  minAge: string;
  maxAge: string;
}) {
  const out: string[] = [];
  if (args.level !== "all") out.push(args.level);
  if (args.boarding === "yes") out.push("Interne");
  if (args.boarding === "no") out.push("Externe");
  if (args.affectation === "yes") out.push("Affecté");
  if (args.affectation === "no") out.push("Non affecté");
  if (args.scholarship === "yes") out.push("Boursier");
  if (args.scholarship === "no") out.push("Non boursier");
  if (args.gender === "F") out.push("Filles");
  if (args.gender === "M") out.push("Garçons");
  if (args.language === "allemand") out.push("Allemand");
  if (args.language === "espagnol") out.push("Espagnol");
  if (args.minAge && args.maxAge) out.push(`${args.minAge}–${args.maxAge} ans`);
  else if (args.minAge) out.push(`≥ ${args.minAge} ans`);
  else if (args.maxAge) out.push(`≤ ${args.maxAge} ans`);
  return out.join(" · ") || "Tous les élèves";
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10"
      >
        {children}
      </select>
    </label>
  );
}

export default function GeneralStatisticsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [institution, setInstitution] = useState<Institution>({});
  const [academicYear, setAcademicYear] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [level, setLevel] = useState("all");
  const [boarding, setBoarding] = useState<Choice>("all");
  const [affectation, setAffectation] = useState<Choice>("all");
  const [scholarship, setScholarship] = useState<Choice>("all");
  const [gender, setGender] = useState<SexChoice>("all");
  const [language, setLanguage] = useState<Lv2Choice>("all");
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [statsRes, institutionRes] = await Promise.all([
          fetch("/api/admin/statistiques-generales", { cache: "no-store" }),
          fetch("/api/admin/institution/settings", { cache: "no-store" }),
        ]);

        const statsJson = await statsRes.json().catch(() => ({}));
        const institutionJson = await institutionRes.json().catch(() => ({}));

        if (!statsRes.ok) {
          throw new Error(statsJson?.error || "Impossible de charger les statistiques.");
        }
        if (!institutionRes.ok) {
          throw new Error(institutionJson?.error || "Impossible de charger l’établissement.");
        }

        if (!cancelled) {
          setStudents(Array.isArray(statsJson?.items) ? statsJson.items : []);
          setAcademicYear(clean(statsJson?.academic_year));
          setInstitution(institutionJson || {});
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Erreur de chargement.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const levels = useMemo(() => sortedUnique(students.map((student) => student.level)), [students]);

  const filtered = useMemo(() => {
    const min = minAge === "" ? null : Number(minAge);
    const max = maxAge === "" ? null : Number(maxAge);

    return students.filter((student) => {
      if (level !== "all" && clean(student.level) !== level) return false;
      if (!boolMatches(student.is_boarder, boarding)) return false;
      if (!boolMatches(student.is_affecte, affectation)) return false;
      if (!boolMatches(student.is_scholarship, scholarship)) return false;
      if (gender !== "all" && sex(student.gender) !== gender) return false;
      if (language !== "all" && lv2(student.lv2) !== language) return false;

      if (min !== null || max !== null) {
        const age = ageOf(student.birthdate);
        if (age === null) return false;
        if (min !== null && Number.isFinite(min) && age < min) return false;
        if (max !== null && Number.isFinite(max) && age > max) return false;
      }
      return true;
    });
  }, [students, level, boarding, affectation, scholarship, gender, language, minAge, maxAge]);

  const totals = useMemo(() => {
    let girls = 0;
    let boys = 0;
    for (const student of filtered) {
      const value = sex(student.gender);
      if (value === "F") girls += 1;
      if (value === "M") boys += 1;
    }
    return { girls, boys };
  }, [filtered]);

  const criteria = useMemo(
    () =>
      filterLabel({
        level,
        boarding,
        affectation,
        scholarship,
        gender,
        language,
        minAge,
        maxAge,
      }),
    [level, boarding, affectation, scholarship, gender, language, minAge, maxAge],
  );

  function reset() {
    setLevel("all");
    setBoarding("all");
    setAffectation("all");
    setScholarship("all");
    setGender("all");
    setLanguage("all");
    setMinAge("");
    setMaxAge("");
  }

  const institutionName =
    clean(institution.institution_name) || clean(institution.name) || "Établissement scolaire";

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 md:p-7">
        <div className="mx-auto max-w-7xl animate-pulse space-y-4">
          <div className="h-14 rounded-2xl bg-slate-200" />
          <div className="h-32 rounded-2xl bg-slate-200" />
          <div className="h-72 rounded-2xl bg-slate-200" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 md:p-7">
        <div className="mx-auto max-w-3xl rounded-2xl border border-rose-200 bg-white p-6 text-sm font-semibold text-rose-700 shadow-sm">
          {error}
        </div>
      </div>
    );
  }

  return (
    <>
      <style jsx global>{`
        .stats-print-sheet { display: none; }
        @page { size: A4 landscape; margin: 6mm; }
        @media print {
          body { background: white !important; }
          body * { visibility: hidden !important; }
          .stats-print-sheet,
          .stats-print-sheet * { visibility: visible !important; }
          .stats-print-sheet {
            display: block !important;
            position: absolute !important;
            inset: 0 auto auto 0 !important;
            width: 100% !important;
            background: white !important;
            color: #0f172a !important;
            font-family: Arial, Helvetica, sans-serif !important;
          }
          .stats-print-sheet table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          .stats-print-sheet thead { display: table-header-group; }
          .stats-print-sheet tr { break-inside: avoid; page-break-inside: avoid; }
          .stats-print-sheet th,
          .stats-print-sheet td { border: 1px solid #64748b; padding: 3.2px 4px; vertical-align: middle; }
          .stats-print-sheet th { background: #f1f5f9 !important; font-size: 8.5px; text-transform: uppercase; }
          .stats-print-sheet td { font-size: 8.7px; }
          .stats-print-sheet .official-header {
            display: grid;
            grid-template-columns: minmax(0, 37%) minmax(0, 36%) minmax(0, 27%);
            gap: 6px;
            align-items: center;
            margin-bottom: 7px;
          }
          .stats-print-sheet .school-block { display: flex; align-items: center; gap: 8px; min-width: 0; }
          .stats-print-sheet .school-logo { width: 42px; height: 42px; object-fit: contain; flex: 0 0 auto; }
          .stats-print-sheet .school-name { font-size: 11.5px; font-weight: 900; line-height: 1.1; text-transform: uppercase; }
          .stats-print-sheet .school-meta { margin-top: 2px; font-size: 8.3px; line-height: 1.25; color: #334155; }
          .stats-print-sheet .list-title {
            border: 1.5px solid #0f172a;
            padding: 7px 8px;
            font-size: 12px;
            font-weight: 900;
            text-align: center;
            text-transform: uppercase;
          }
          .stats-print-sheet .right-meta { font-size: 8.8px; line-height: 1.45; text-align: right; font-weight: 700; }
          .stats-print-sheet .criteria-line {
            margin: 0 0 6px;
            padding: 4px 6px;
            border: 1px solid #cbd5e1;
            background: #f8fafc !important;
            font-size: 8.8px;
            font-weight: 700;
          }
          .stats-print-sheet .sheet-footer {
            display: grid;
            grid-template-columns: 1fr 1.45fr 1fr;
            align-items: end;
            gap: 12px;
            margin-top: 9px;
            padding-top: 6px;
            border-top: 1px solid #cbd5e1;
            font-size: 9.6px;
            color: #334155;
          }
          .stats-print-sheet .export-brand-footer { text-align: center; line-height: 1.25; font-weight: 700; }
        }
      `}</style>

      <div className="min-h-screen bg-slate-50 p-4 md:p-7">
        <div className="mx-auto max-w-7xl space-y-4">
          <header className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                <BarChart3 className="h-5 w-5" />
              </span>
              <div>
                <h1 className="text-xl font-black text-slate-950">Statistiques générales</h1>
                <div className="mt-0.5 text-sm font-semibold text-slate-500">
                  {filtered.length} élève{filtered.length > 1 ? "s" : ""}
                  {academicYear ? ` · ${academicYear}` : ""}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={reset}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                <RotateCcw className="h-4 w-4" />
                Réinitialiser
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                disabled={filtered.length === 0}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Printer className="h-4 w-4" />
                Imprimer
              </button>
            </div>
          </header>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
              <Select label="Niveau" value={level} onChange={setLevel}>
                <option value="all">Tous</option>
                {levels.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </Select>

              <Select label="Régime" value={boarding} onChange={(value) => setBoarding(value as Choice)}>
                <option value="all">Tous</option>
                <option value="yes">Interne</option>
                <option value="no">Externe</option>
              </Select>

              <Select label="Affectation" value={affectation} onChange={(value) => setAffectation(value as Choice)}>
                <option value="all">Tous</option>
                <option value="yes">Affecté</option>
                <option value="no">Non affecté</option>
              </Select>

              <Select label="Bourse" value={scholarship} onChange={(value) => setScholarship(value as Choice)}>
                <option value="all">Tous</option>
                <option value="yes">Boursier</option>
                <option value="no">Non boursier</option>
              </Select>

              <Select label="Sexe" value={gender} onChange={(value) => setGender(value as SexChoice)}>
                <option value="all">Tous</option>
                <option value="F">Fille</option>
                <option value="M">Garçon</option>
              </Select>

              <Select label="LV2" value={language} onChange={(value) => setLanguage(value as Lv2Choice)}>
                <option value="all">Toutes</option>
                <option value="allemand">Allemand</option>
                <option value="espagnol">Espagnol</option>
              </Select>

              <label className="block min-w-0">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Âge min</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={minAge}
                  onChange={(event) => setMinAge(event.target.value)}
                  placeholder="—"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10"
                />
              </label>

              <label className="block min-w-0">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Âge max</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={maxAge}
                  onChange={(event) => setMaxAge(event.target.value)}
                  placeholder="—"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10"
                />
              </label>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="truncate text-sm font-bold text-slate-700">{criteria}</div>
              <div className="ml-3 shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
                {filtered.length}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[980px] w-full border-collapse text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5">N°</th>
                    <th className="px-3 py-2.5">Matricule</th>
                    <th className="px-3 py-2.5">Nom et prénoms</th>
                    <th className="px-3 py-2.5">Classe</th>
                    <th className="px-3 py-2.5 text-center">Sexe</th>
                    <th className="px-3 py-2.5 text-center">Âge</th>
                    <th className="px-3 py-2.5">Régime</th>
                    <th className="px-3 py-2.5">Affectation</th>
                    <th className="px-3 py-2.5">Bourse</th>
                    <th className="px-3 py-2.5">LV2</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.length ? (
                    filtered.map((student, index) => (
                      <tr key={student.id} className="hover:bg-slate-50/70">
                        <td className="px-3 py-2.5 font-semibold text-slate-500">{index + 1}</td>
                        <td className="px-3 py-2.5 font-semibold text-slate-700">{student.matricule || "—"}</td>
                        <td className="px-3 py-2.5 font-bold text-slate-950">{student.full_name}</td>
                        <td className="px-3 py-2.5 text-slate-700">{student.class_label || "—"}</td>
                        <td className="px-3 py-2.5 text-center text-slate-700">{sex(student.gender) || "—"}</td>
                        <td className="px-3 py-2.5 text-center text-slate-700">{ageOf(student.birthdate) ?? "—"}</td>
                        <td className="px-3 py-2.5 text-slate-700">{labelBool(student.is_boarder, "Interne", "Externe")}</td>
                        <td className="px-3 py-2.5 text-slate-700">{labelBool(student.is_affecte, "Affecté", "Non affecté")}</td>
                        <td className="px-3 py-2.5 text-slate-700">{labelBool(student.is_scholarship, "Boursier", "Non boursier")}</td>
                        <td className="px-3 py-2.5 text-slate-700">{lv2(student.lv2) === "allemand" ? "Allemand" : lv2(student.lv2) === "espagnol" ? "Espagnol" : student.lv2 || "—"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={10} className="px-4 py-12 text-center text-sm font-semibold text-slate-400">
                        Aucun élève pour ces filtres.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      <section className="stats-print-sheet">
        <header className="official-header">
          <div className="school-block">
            {clean(institution.institution_logo_url) ? (
              <img className="school-logo" src={clean(institution.institution_logo_url)} alt="Logo de l’établissement" />
            ) : null}
            <div>
              <div className="school-name">{institutionName}</div>
              <div className="school-meta">
                {clean(institution.institution_code) ? <div>Code : {institution.institution_code}</div> : null}
                {clean(institution.institution_phone) ? <div>Tél. : {institution.institution_phone}</div> : null}
                {clean(institution.institution_email) ? <div>{institution.institution_email}</div> : null}
              </div>
            </div>
          </div>

          <div className="list-title">STATISTIQUES GÉNÉRALES</div>

          <div className="right-meta">
            {clean(institution.country_name) ? <div>{institution.country_name}</div> : null}
            {clean(institution.country_motto) ? <div>{institution.country_motto}</div> : null}
            {clean(institution.ministry_name) ? <div>{institution.ministry_name}</div> : null}
            <div>Année scolaire : {academicYear || "—"}</div>
            <div>Niveau : {level === "all" ? "Tous" : displayLevel(level)}</div>
            <div>Effectif : {filtered.length}</div>
          </div>
        </header>

        <div className="criteria-line">Critères : {criteria}</div>

        <table>
          <colgroup>
            <col style={{ width: "4%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "27%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "9%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>N°</th>
              <th>Matricule</th>
              <th>Nom et prénoms</th>
              <th>Classe</th>
              <th>Sexe</th>
              <th>Âge</th>
              <th>Régime</th>
              <th>Affectation</th>
              <th>Bourse</th>
              <th>LV2</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((student, index) => (
              <tr key={`print-${student.id}`}>
                <td style={{ textAlign: "center" }}>{index + 1}</td>
                <td>{student.matricule || "—"}</td>
                <td style={{ fontWeight: 700 }}>{student.full_name}</td>
                <td>{student.class_label || "—"}</td>
                <td style={{ textAlign: "center" }}>{sex(student.gender) || "—"}</td>
                <td style={{ textAlign: "center" }}>{ageOf(student.birthdate) ?? "—"}</td>
                <td>{labelBool(student.is_boarder, "Interne", "Externe")}</td>
                <td>{labelBool(student.is_affecte, "Affecté", "Non affecté")}</td>
                <td>{labelBool(student.is_scholarship, "Boursier", "Non boursier")}</td>
                <td>{lv2(student.lv2) === "allemand" ? "Allemand" : lv2(student.lv2) === "espagnol" ? "Espagnol" : student.lv2 || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <footer className="sheet-footer">
          <div>Filles : {totals.girls} &nbsp;|&nbsp; Garçons : {totals.boys}</div>
          <div className="export-brand-footer">{MON_CAHIER_EXPORT_SIGNATURE}</div>
          <div aria-hidden="true" />
        </footer>
      </section>
    </>
  );
}
