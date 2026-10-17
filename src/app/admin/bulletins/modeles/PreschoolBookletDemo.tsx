"use client";

import type { BulletinVariant } from "@/components/bulletins/FrancoArabicBulletin";

const FRENCH = [
  { domain: "Langage et communication", competence: "Comprendre une consigne simple", level: "Acquis", comment: "Réagit de façon adaptée aux consignes" },
  { domain: "Découverte du monde", competence: "Identifier des formes et des objets", level: "En cours d’acquisition", comment: "Progresse avec accompagnement" },
  { domain: "Expression artistique", competence: "Participer aux activités de dessin", level: "Acquis", comment: "Participe avec plaisir" },
];
const ARABIC = [
  { domain: "Langue arabe", competence: "Reconnaître des lettres étudiées", level: "En cours d’acquisition", comment: "Reconnaît plusieurs lettres" },
  { domain: "Expression orale", competence: "Reproduire des mots ou expressions", level: "Acquis", comment: "S’exprime avec confiance" },
  { domain: "Éveil religieux", competence: "Participer aux activités de découverte", level: "À observer", comment: "Observation à poursuivre" },
];

/** Fictional competency booklet, with no numeric mark, coefficient or rank. */
export default function PreschoolBookletDemo({
  variant, schoolName, schoolCode, hasArabic,
}: {
  variant: BulletinVariant; schoolName: string; schoolCode: string; hasArabic: boolean;
}) {
  const groups = (variant === "combined" && hasArabic)
    ? [{ id: "french", label: "Enseignement français", rows: FRENCH },
       { id: "arabic", label: "Enseignement arabe", rows: ARABIC }]
    : (variant === "arabic" && hasArabic
      ? [{ id: "arabic", label: "Enseignement arabe", rows: ARABIC }]
      : [{ id: "french", label: hasArabic ? "Enseignement français" : "Maternelle", rows: FRENCH }]);
  return <article className="fa-report-print-root mx-auto bg-white p-10 text-slate-900 shadow-sm"
    style={{ width: "210mm", minHeight: "297mm", boxSizing: "border-box" }}>
    <div className="border-b-4 border-emerald-800 pb-5 text-center">
      <p className="text-sm font-semibold">République de Côte d’Ivoire · Union – Discipline – Travail</p>
      <h1 className="mt-4 text-2xl font-black">{schoolName}</h1>
      <p className="text-sm">Code : {schoolCode}</p>
      <h2 className="mt-4 text-xl font-bold">Livret d’observation des compétences — Maternelle</h2>
      <p className="mt-1">Année scolaire 2026–2027 · Période : exemple</p>
    </div>
    <div className="my-5 rounded-xl border border-slate-300 p-4 text-sm">
      <strong>Élève fictif : Amina ÉLÈVE EXEMPLE</strong>
      <p>Classe : Maternelle · Matricule : DÉMO-2026-001</p>
    </div>
    {groups.map(group => <section key={group.id} className="mb-7">
      <h3 className="mb-3 rounded-lg bg-emerald-800 p-3 text-lg font-bold text-white">{group.label}</h3>
      <table className="w-full border-collapse text-left text-sm">
        <thead><tr className="bg-slate-100">
          <th className="border p-2">Domaine</th><th className="border p-2">Compétence</th>
          <th className="border p-2">Progression</th><th className="border p-2">Observation</th>
        </tr></thead>
        <tbody>{group.rows.map(row => <tr key={row.competence}>
          <td className="border p-2">{row.domain}</td>
          <td className="border p-2">{row.competence}</td>
          <td className="border p-2">{row.level}</td>
          <td className="border p-2">{row.comment}</td>
        </tr>)}</tbody>
      </table>
      <p className="mt-3 text-xs text-slate-600">Appréciation de l’enseignant : exemples d’observations de développement.</p>
    </section>)}
    <div className="mt-10 flex justify-between border-t pt-7 text-sm">
      <span>Visa de l’enseignant</span><span>Visa de la direction</span>
    </div>
    <p className="mt-16 text-center text-xs font-semibold text-amber-900">MAQUETTE — ÉLÈVE ET OBSERVATIONS FICTIFS · NON OFFICIEL</p>
  </article>;
}
