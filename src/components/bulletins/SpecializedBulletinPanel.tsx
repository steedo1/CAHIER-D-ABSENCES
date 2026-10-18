"use client";

import { useEffect, useState } from "react";
import FrancoArabicBulletin, { type BulletinVariant } from "./FrancoArabicBulletin";
import SecondaryHistoricalBulletin from "./SecondaryHistoricalBulletin";
import type { SpecializedBulletinPayload } from "@/lib/server/specialized-bulletin";
import { isSpecializedBulletinPrintable } from "@/lib/franco-arabic-print-layout";
import "@/app/admin/bulletins/modeles/print.css";

/** View inside the existing bulletin page; data and engine choice come from its
 * authenticated API. Changing this layout never changes a calculation or scope. */
export default function SpecializedBulletinPanel({ data, onBack, onPrint, printPreparing = false, error, schoolLogoUrl }: {
  data: SpecializedBulletinPayload; onBack: () => void; onPrint: () => Promise<void>;
  printPreparing?: boolean; error?: string | null; schoolLogoUrl?: string | null;
}) {
  // Defense in depth for existing saved secondary choices and stale API data:
  // secondary never offers the combined model; preserve each teaching track.
  const format = data.cycle === "secondary" ? "separate" : data.format;
  const choices: BulletinVariant[] = data.programs.length === 1
    ? [data.programs[0] === "french" ? "ordinary" : "arabic"]
    : format === "combined" ? ["combined"]
    : format === "separate" ? ["french", "arabic"] : ["combined", "french", "arabic"];
  const [variant, setVariant] = useState<BulletinVariant>(choices[0]);
  const selected = choices.includes(variant) ? variant : choices[0];
  const printable = data.documents.length > 0 && data.documents.every(row =>
    isSpecializedBulletinPrintable(row.document, row.programReadiness, selected));
  useEffect(() => {
    const printShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        if (printable && !printPreparing) void onPrint();
      }
    };
    window.addEventListener("keydown", printShortcut);
    return () => window.removeEventListener("keydown", printShortcut);
  }, [onPrint, printable, printPreparing]);
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center gap-3 print:hidden">
      <button type="button" onClick={onBack} className="rounded-lg border px-3 py-2">Changer de classe ou de période</button>
      <label htmlFor="specialized-bulletin-layout">Présentation</label>
      <select id="specialized-bulletin-layout" value={selected} onChange={event => setVariant(event.target.value as BulletinVariant)} className="rounded-lg border p-2">
        {choices.map(choice => <option key={choice} value={choice}>{choice === "combined" ? "Français et arabe — résultats séparés" : choice === "arabic" ? "Arabe" : choice === "ordinary" ? "Bulletin scolaire" : "Français"}</option>)}
      </select>
      <button type="button" disabled={!printable || printPreparing} onClick={() => void onPrint()} className="rounded-lg bg-slate-900 px-3 py-2 text-white disabled:opacity-40">{printPreparing ? "Préparation…" : "Imprimer les bulletins"}</button>
    </div>
    {error && <p role="alert" className="text-red-700 print:hidden">{error}</p>}
    {!printable && <div role="status" className="rounded-xl bg-amber-50 p-4 text-amber-950 print:hidden">
      Les bulletins restent en préparation. Vérifiez les barèmes, les coefficients, les disciplines et les notes publiées.
      {[...new Set(data.documents.flatMap(row => row.problems))].includes("shared_subject_requires_program_specific_evaluations") &&
        <p>Une discipline commune aux deux enseignements contient des évaluations dont le programme ne peut pas encore être identifié. Ces notes ne sont attribuées à aucun des deux bulletins.</p>}
    </div>}
    <div className="specialized-print-denied" role="status">Impression indisponible : les bulletins sélectionnés sont incomplets ou non validés. Vérifiez la configuration et les notes publiées dans Mon Cahier.</div>
    <div className={`fa-report-print-root specialized-print-root ${!printable || printPreparing || error ? "specialized-print-blocked" : ""} space-y-6 overflow-x-auto print:overflow-visible`}>
      {data.cycle === "secondary"
        ? data.documents.map(row => {
            const program = selected === "arabic" ? row.document.arabic : row.document.french;
            return program
              ? <SecondaryHistoricalBulletin key={row.studentId} model={row.document}
                  program={program} schoolLogoUrl={schoolLogoUrl} />
              : <article key={row.studentId} role="alert">Bulletin indisponible : enseignement non renseigné.</article>;
          })
        : data.documents.map(row => <FrancoArabicBulletin key={row.studentId} model={{ ...row.document,
            draft: !isSpecializedBulletinPrintable(row.document, row.programReadiness, selected) }}
            variant={selected} printRoot={false} />)}
    </div>
  </section>;
}
