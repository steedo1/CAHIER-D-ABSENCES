"use client";

import { useState } from "react";
import type { SchoolCycle, TeachingTrack } from "@/lib/school-cycles";
import PreschoolBookletDemo from "./PreschoolBookletDemo";
import "./print.css";
import Link from "next/link";
import FrancoArabicBulletin, {
  type BulletinDocument,
  type BulletinVariant,
} from "@/components/bulletins/FrancoArabicBulletin";

/**
 * Fictitious A4-only preview. Does not query, mutate, or claim real grades.
 * The same student identity is reused in all variants.
 */
const demo: BulletinDocument = {
  school: {
    name: "Établissement de démonstration",
    code: "EXEMPLE",
    subtitle: "Maquette de bulletin pour école franco-arabe",
    city: "Côte d’Ivoire",
  },
  student: {
    id: "demo-student",
    firstName: "Amina",
    lastName: "ÉLÈVE EXEMPLE",
    matricule: "DÉMO-2026-001",
    birthDate: "01/01/2016",
  },
  french: {
    track: "french",
    cycle: "Primaire",
    level: "CM1",
    className: "CM1",
    year: "2026–2027",
    period: "1er trimestre",
    denominator: 20,
    subjects: [
      { id: "f-math", name: "Mathématiques", coefficient: 3, average: 15, classAverage: 12.4, observation: "Très bon travail" },
      { id: "f-french", name: "Français", coefficient: 3, average: 14, classAverage: 12.1, observation: "Bon ensemble" },
      { id: "f-reading", name: "Lecture", coefficient: 2, average: 16, classAverage: 13.2, observation: "Très bien" },
      { id: "f-environment", name: "Étude du milieu", coefficient: 2, average: 13, classAverage: 11.8, observation: "Résultats encourageants" },
      { id: "f-writing", name: "Écriture", coefficient: 1, average: 15, classAverage: 12.7, observation: "Soigné" },
    ],
    generalAverage: 14.55,
    rank: 3,
    classSize: 28,
    absences: "0 jour",
    lates: "0",
    appreciation: "Très bon trimestre. Travail sérieux et régulier. Continue tes efforts.",
    directorName: "Direction de l’enseignement français",
  },
  arabic: {
    track: "arabic",
    cycle: "Primaire",
    level: "CM1",
    className: "CM1",
    year: "2026–2027",
    period: "1er trimestre",
    denominator: 20,
    subjects: [
      { id: "a-quran", name: "Coran", arabicName: "القرآن الكريم", coefficient: 4, average: 16, classAverage: 13.7, observation: "Très bon niveau" },
      { id: "a-language", name: "Langue arabe", arabicName: "اللغة العربية", coefficient: 3, average: 15, classAverage: 12.6, observation: "Bien" },
      { id: "a-tajweed", name: "Tadjwid", arabicName: "التجويد", coefficient: 2, average: 17, classAverage: 14.1, observation: "Très bien" },
      { id: "a-fiqh", name: "Fiqh", arabicName: "الفقه", coefficient: 2, average: 14, classAverage: 12, observation: "Encourageant" },
      { id: "a-hadith", name: "Hadith", arabicName: "الحديث", coefficient: 1, average: 18, classAverage: 13.9, observation: "Excellent" },
    ],
    generalAverage: 15.75,
    rank: 2,
    classSize: 28,
    absences: "0 jour",
    lates: "0",
    appreciation: "Excellent engagement dans l’étude de l’arabe et des disciplines religieuses.",
    directorName: "Direction de l’enseignement arabe",
  },
  sample: true,
};

const options: { id: BulletinVariant; label: string }[] = [
  { id: "french", label: "Bulletin français" },
  { id: "arabic", label: "Bulletin arabe" },
  { id: "combined", label: "Document regroupé" },
];

export default function DemoBulletinClient({
  hasArabic, schoolName, schoolCode, enabledCycles,
}: { hasArabic: boolean; schoolName: string; schoolCode: string; enabledCycles: SchoolCycle[] }) {
  const [variant, setVariant] = useState<BulletinVariant>(hasArabic ? "combined" : "ordinary");
  const [cycle, setCycle] = useState<SchoolCycle>(enabledCycles.includes("primary") ? "primary" : enabledCycles[0] || "secondary");
  const label = cycle === "secondary" ? "Secondaire" : "Primaire";
  const preview: BulletinDocument = {
    ...demo,
    school: {
      ...demo.school,
      name: schoolName,
      code: schoolCode,
      subtitle: hasArabic ? "Maquette pédagogique franco-arabe" : "Maquette pédagogique primaire",
    },
    french: demo.french ? {
      ...demo.french,
      cycle: label, level: cycle === "secondary" ? "6ème" : "CM1",
      className: cycle === "secondary" ? "6ème" : "CM1",
      subjects: demo.french.subjects.map(subject => ({
        ...subject, coefficient: cycle === "secondary" ? subject.coefficient : null,
      })),
      directorName: hasArabic ? demo.french.directorName : "Direction de l’établissement",
    } : undefined,
    arabic: demo.arabic ? {
      ...demo.arabic,
      cycle: label, level: cycle === "secondary" ? "6ème" : "CM1",
      className: cycle === "secondary" ? "6ème" : "CM1",
      subjects: demo.arabic.subjects.map(subject => ({
        ...subject, coefficient: cycle === "secondary" ? subject.coefficient : null,
      })),
    } : undefined,
  };
  const visibleOptions = hasArabic ? options : [{ id: "ordinary" as BulletinVariant, label: "Bulletin de notes" }];
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 rounded-2xl border bg-white p-5 shadow-sm print:hidden">
        <Link href="/admin/parametres?tab=bulletin-models" className="text-sm font-semibold text-emerald-800">
          ← Retour aux paramètres des bulletins
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Maquettes de bulletins A4</h1>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          {hasArabic
            ? "Bulletins français, arabe et regroupé ; les résultats ne sont jamais fusionnés."
            : "Bulletin ordinaire, sans étiquette « Programme français ». Aucun enseignement arabe n'est ajouté."
          } Toutes les données de démonstration présentées ci-dessous sont fictives.
          Le primaire présente des barèmes sans coefficients et le préscolaire un livret de compétences.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <label className="flex items-center gap-2 text-sm font-semibold">
            Cycle
            <select value={cycle} onChange={event => setCycle(event.target.value as SchoolCycle)}
              className="rounded-lg border px-3 py-2">
              {enabledCycles.map(item => <option value={item} key={item}>
                {item === "preschool" ? "Préscolaire" : item === "primary" ? "Primaire" : "Secondaire"}
              </option>)}
            </select>
          </label>
          {visibleOptions.map(option => (
            <button key={option.id} type="button"
              aria-pressed={variant === option.id}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${variant === option.id
                ? "bg-emerald-800 text-white"
                : "border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"}`}
              onClick={() => setVariant(option.id)}>
              {option.label}
            </button>
          ))}
          <button type="button" onClick={() => window.print()}
            className="ml-auto rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white">
            Imprimer / Enregistrer en PDF
          </button>
        </div>
      </div>
      <div className="w-full overflow-x-auto pb-8 print:overflow-visible print:p-0">
        {cycle === "preschool"
          ? <PreschoolBookletDemo variant={variant} schoolName={schoolName} schoolCode={schoolCode} hasArabic={hasArabic} />
          : <FrancoArabicBulletin model={preview} variant={variant} printRoot />}
      </div>
    </div>
  );
}
