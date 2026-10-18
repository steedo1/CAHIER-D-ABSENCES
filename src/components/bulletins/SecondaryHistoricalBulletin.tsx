import type { BulletinDocument, BulletinProgram } from "./FrancoArabicBulletin";

/**
 * Secondary franco-Arabic reports use the historical Mon Cahier A4 visual
 * structure (official heading, identity, discipline table, results and visas).
 * Values are copied verbatim from each server-calculated teaching program.
 * No merging of French/Arabic grades, no client-side mean/rank calculation,
 * and no fabricated official QR, signature or document number.
 */
function score(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "NC";
}
function label(value: string | null | undefined): string {
  return typeof value === "string" && value.trim() ? value : "—";
}
function ranking(rank: number | null | undefined, size: number | null | undefined): string {
  return rank == null ? "NC" : String(rank) + (size != null ? " / " + size : "");
}
export default function SecondaryHistoricalBulletin({
  model, program, schoolLogoUrl,
}: {
  model: BulletinDocument; program: BulletinProgram; schoolLogoUrl?: string | null;
}) {
  const french = program.track === "french";
  const history = program.historicalSecondary;
  const logo = model.school.logoUrl || schoolLogoUrl;
  const title = french ? "ENSEIGNEMENT FRANÇAIS" : "ENSEIGNEMENT ARABE";
  const director = program.directorName || model.school.generalDirectorName;
  const rows = program.subjects;
  return <article
    className="secondary-historical-sheet print-page print-break relative mx-auto box-border bg-white p-[4mm] text-black shadow-lg print:shadow-none"
    style={{ width: "210mm", minHeight: "297mm", fontFamily: "Arial, Helvetica, sans-serif" }}
    aria-label={"Bulletin trimestriel historique - " + title}>
    <div className="mb-1 border border-black p-1 text-center text-[9px] font-bold uppercase">
      APERÇU — BULLETIN NON ÉMIS
    </div>
    <header className="mb-1 border border-black p-1">
      <div className="grid grid-cols-3 items-start gap-2 text-[9px]">
        <div className="text-center">
          <div className="font-bold uppercase">RÉPUBLIQUE DE CÔTE D’IVOIRE</div>
          <div>Union - Discipline - Travail</div>
          <div className="mt-1 font-semibold">MINISTÈRE DE L’ÉDUCATION NATIONALE</div>
        </div>
        <div className="text-center">
          <h1 className="text-[13px] font-bold uppercase leading-tight">BULLETIN TRIMESTRIEL DE NOTES</h1>
          <div className="font-semibold">{label(program.period)}</div>
          <div className="mt-1 text-[9px] font-bold">{title}</div>
        </div>
        <div className="text-right">
          <div>Année scolaire</div>
          <div className="font-bold">{label(program.year)}</div>
          <div className="mt-1">Code : <strong>{label(model.school.code)}</strong></div>
        </div>
      </div>
      <div className="mt-1 grid grid-cols-[110px_1fr_110px] items-center gap-2">
        <div className="flex h-[82px] w-[110px] items-center justify-center overflow-hidden p-1">
          {logo
            ? <img src={logo} alt="Logo de l’établissement" className="max-h-full max-w-full object-contain" />
            : <span className="text-[9px] text-slate-500">Logo non renseigné</span>}
        </div>
        <div className="text-center text-[15px] font-bold uppercase leading-tight">
          {label(model.school.name)}
        </div>
        <div />
      </div>
    </header>
    <section className="mb-1 border border-black p-2 text-[10px]" aria-label="Identité de l’élève">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <div><strong>Nom & prénom(s) : </strong>{label([model.student.lastName, model.student.firstName].filter(Boolean).join(" "))}</div>
          <div><strong>Matricule : </strong>{label(model.student.matricule)}</div>
        </div>
        <div>
          <div><strong>Classe : </strong>{label(program.className)}</div>
          <div><strong>Niveau : </strong>{label(program.level)}</div>
        </div>
        <div>
          <div><strong>Né(e) le : </strong>{label(model.student.birthDate)}</div>
          <div><strong>Effectif : </strong>{program.classSize ?? "—"}</div>
        </div>
      </div>
    </section>
    <table className="w-full border-collapse border border-black text-[10px] leading-tight">
      <thead>
        <tr className="bg-slate-100">
          {["DISCIPLINES", "Moy.", "Coef.", "Rang", "Appréciations", "Professeurs"].map(col =>
            <th key={col} className="border border-black p-1 text-left">{col}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map(subject => <tbody key={subject.id}>
          <tr>
            <td className="border border-black p-1 font-semibold" dir="auto">{subject.name}</td>
            <td className="border border-black p-1 text-center">{score(subject.average)} / {subject.denominator || program.denominator}</td>
            <td className="border border-black p-1 text-center">{subject.coefficient ?? "—"}</td>
            <td className="border border-black p-1 text-center">{ranking(subject.subjectRank, null)}</td>
            <td className="border border-black p-1">{label(subject.observation)}</td>
            <td className="border border-black p-1">{label(subject.teacherName)}</td>
          </tr>
          {(subject.components || []).map(component => <tr key={component.id} className="text-[9px]">
            <td className="border border-black py-1 pl-4 pr-1">↳ {component.name}</td>
            <td className="border border-black p-1 text-center">{score(component.average)} / {subject.denominator || program.denominator}</td>
            <td className="border border-black p-1 text-center">{component.coefficient}</td>
            <td className="border border-black p-1 text-center">{ranking(component.rank, null)}</td>
            <td className="border border-black p-1" />
            <td className="border border-black p-1">{label(subject.teacherName)}</td>
          </tr>)}
        </tbody>)}
      </tbody>
    </table>
    <div className="mt-1 grid grid-cols-3 gap-2 text-[10px]">
      <div className="border border-black p-2">
        <div className="mb-1 text-center font-bold">Discipline générale</div>
        <div>Conduite : {history ? score(history.conductAverage) + " /20" : "—"}</div>
        <div>Absences : {label(program.absences)}</div>
        <div>Retards : {label(program.lates)}</div>
      </div>
      <div className="border border-black p-2 text-center">
        <div className="font-bold">Moyenne trimestrielle</div>
        <div className="mt-2 text-[13px] font-bold">
          {program.allowHistoricalNc && program.generalAverage === null ? "NC" : score(program.generalAverage)} / {program.denominator}
        </div>
        <div className="mt-2">Rang : {ranking(program.rank, program.classSize)}</div>
      </div>
      <div className="border border-black p-2 text-center">
        <div className="font-bold">Moyenne annuelle</div>
        <div className="mt-2">{history?.annualAverage != null ? score(history.annualAverage) + " /20" : "—"}</div>
        <div className="mt-2">Rang annuel : {history ? ranking(history.annualRank, program.classSize) : "—"}</div>
      </div>
    </div>
    {history && (history.groups.length > 0 || history.previousPeriods.length > 0) &&
      <div className="mt-1 grid grid-cols-2 gap-2 text-[10px]">
        {history.groups.length > 0 && <div className="border border-black p-2">
          <strong>Bilans disciplinaires</strong>
          {history.groups.map(g => <div key={g.id}>{g.label} : {score(g.average)} /20</div>)}
        </div>}
        {history.previousPeriods.length > 0 && <div className="border border-black p-2">
          <strong>Rappel des moyennes</strong>
          {history.previousPeriods.map((p, i) => <div key={i}>{label(p.label || p.code)} : {score(p.avg20)} /20</div>)}
        </div>}
      </div>}
    <div className="mt-1 grid grid-cols-2 gap-2 text-[10px]">
      <div className="flex min-h-[100px] flex-col justify-between border border-black p-2">
        <strong>Appréciation du conseil de classe</strong>
        <div>{label(program.appreciation)}</div>
        {history?.decision?.official_decision &&
          <strong className="text-center text-red-700">{history.decision.official_decision}</strong>}
      </div>
      <div className="flex min-h-[100px] flex-col justify-between border border-black p-2">
        <strong>Visa du directeur</strong>
        <div className="text-center">{label(director)}</div>
      </div>
    </div>
    <footer className="mt-1 text-center text-[9px] font-bold">
      www.mon-cahier.com · Document consultable dans Correspondant Fichier → Bulletins
    </footer>
  </article>;
}
