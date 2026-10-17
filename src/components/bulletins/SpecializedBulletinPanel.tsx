"use client";

import { useState } from "react";
import FrancoArabicBulletin, { type BulletinVariant } from "./FrancoArabicBulletin";
import type { SpecializedBulletinPayload } from "@/lib/server/specialized-bulletin";
import "@/app/admin/bulletins/modeles/print.css";

/** View inside the existing bulletin page; data and engine choice come from its
 * authenticated API. Changing this layout never changes a calculation or scope. */
export default function SpecializedBulletinPanel({ data, onBack }: {
  data: SpecializedBulletinPayload; onBack: () => void;
}) {
  const choices: BulletinVariant[] = data.programs.length === 1
    ? [data.programs[0] === "french" ? "ordinary" : "arabic"]
    : data.format === "combined" ? ["combined"]
    : data.format === "separate" ? ["french", "arabic"] : ["combined", "french", "arabic"];
  const [variant, setVariant] = useState<BulletinVariant>(choices[0]);
  const selected = choices.includes(variant) ? variant : choices[0];
  const printable = data.documents.length > 0 && data.documents.every(row => row.ready);
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center gap-3 print:hidden">
      <button type="button" onClick={onBack} className="rounded-lg border px-3 py-2">Changer de classe ou de période</button>
      <label htmlFor="specialized-bulletin-layout">Présentation</label>
      <select id="specialized-bulletin-layout" value={selected} onChange={event => setVariant(event.target.value as BulletinVariant)} className="rounded-lg border p-2">
        {choices.map(choice => <option key={choice} value={choice}>{choice === "combined" ? "Français et arabe — résultats séparés" : choice === "arabic" ? "Arabe" : choice === "ordinary" ? "Bulletin scolaire" : "Français"}</option>)}
      </select>
      <button type="button" disabled={!printable} onClick={() => window.print()} className="rounded-lg bg-slate-900 px-3 py-2 text-white disabled:opacity-40">Imprimer les bulletins</button>
    </div>
    {!printable && <div role="status" className="rounded-xl bg-amber-50 p-4 text-amber-950 print:hidden">
      Les bulletins restent en préparation. Vérifiez les barèmes, les coefficients, les disciplines et les notes publiées.
      {[...new Set(data.documents.flatMap(row => row.problems))].includes("shared_subject_requires_program_specific_evaluations") &&
        <p>Une discipline commune aux deux enseignements contient des évaluations dont le programme ne peut pas encore être identifié. Ces notes ne sont attribuées à aucun des deux bulletins.</p>}
    </div>}
    <div className="fa-report-print-root specialized-print-root space-y-6 overflow-x-auto print:overflow-visible">
      {data.documents.map(row => <FrancoArabicBulletin key={row.studentId} model={row.document} variant={selected} printRoot={false} />)}
    </div>
  </section>;
}
