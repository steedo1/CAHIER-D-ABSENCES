"use client";

import { useEffect, useState } from "react";
import FrancoArabicBulletin, { type BulletinVariant } from "./FrancoArabicBulletin";
import type { SpecializedBulletinPayload } from "@/lib/server/specialized-bulletin";
import { isSpecializedBulletinPrintable } from "@/lib/franco-arabic-print-layout";
import "@/app/admin/bulletins/modeles/print.css";

/** View inside the existing bulletin page; data and engine choice come from its
 * authenticated API. Changing this layout never changes a calculation or scope. */
export default function SpecializedBulletinPanel({ data, onBack, onPrint, printPreparing = false, error }: {
  data: SpecializedBulletinPayload; onBack: () => void; onPrint: () => Promise<void>;
  printPreparing?: boolean; error?: string | null;
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
  const visibleDocuments = data.documents.filter(row => selected === "combined"
    ? !!row.document.french && !!row.document.arabic : !!row.document[selected === "ordinary" ? "french" : selected]);
  // One incomplete pupil must not block every other eligible pupil. The
  // printed DOM contains ONLY documents authorized by the server-calculated
  // per-program readiness and the existing printable policy.
  const readyDocuments = visibleDocuments.filter(row =>
    isSpecializedBulletinPrintable(row.document, row.programReadiness, selected));
  const blockedDocuments = visibleDocuments.filter(row => !readyDocuments.includes(row));
  const printable = readyDocuments.length > 0;
  const lastReadyId = readyDocuments.at(-1)?.studentId;
  const printLabel = blockedDocuments.length
    ? `Imprimer ${readyDocuments.length} bulletin${readyDocuments.length > 1 ? "s" : ""} prêt${readyDocuments.length > 1 ? "s" : ""}`
    : "Imprimer les bulletins";
  const selectedTracks = selected === "combined" ? ["french", "arabic"] :
    [selected === "ordinary" ? "french" : selected];
  const reasonLabels: Record<string, string> = {
    included_subject_without_score: "Notes publiées manquantes",
    no_subject_in_average: "Aucune note exploitable pour la moyenne",
    level_scale_not_configured: "Barème de moyenne à renseigner",
    primary_subject_scale_not_configured: "Barème d'une matière manquant",
    level_subjects_not_configured: "Matières du niveau à configurer",
    level_curriculum_not_configured: "Matières de la classe à configurer",
    class_subject_coefficient_missing: "Coefficient manquant",
    primary_event_unpublished_evaluation: "Évaluation non publiée",
    PRIMARY_ANNUAL_INCOMPLETE: "Résultats annuels incomplets",
    official_publication_version_mismatch: "Publication des notes à vérifier",
  };
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
  if (data.cycle === "secondary") return <a href="/admin/bulletins">Ouvrir les bulletins historiques du secondaire</a>;
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center gap-3 print:hidden">
      <button type="button" onClick={onBack} className="rounded-lg border px-3 py-2">Changer de classe ou d’évaluation</button>
      <label htmlFor="specialized-bulletin-layout">Présentation</label>
      <select id="specialized-bulletin-layout" value={selected} onChange={event => setVariant(event.target.value as BulletinVariant)} className="rounded-lg border p-2">
        {choices.map(choice => <option key={choice} value={choice}>{choice === "combined" ? "Français et arabe — résultats séparés" : choice === "arabic" ? "Arabe" : choice === "ordinary" ? "Bulletin scolaire" : "Français"}</option>)}
      </select>
      <button type="button" disabled={!printable || printPreparing} onClick={() => void onPrint()}
        aria-describedby="specialized-print-status"
        className="rounded-lg bg-slate-900 px-3 py-2 text-white disabled:opacity-40"
      >{printPreparing ? "Préparation…" : printLabel}</button>
    </div>
    <div id="specialized-print-status" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm print:hidden">
      <p>{readyDocuments.length} bulletin{readyDocuments.length > 1 ? "s" : ""} prêt{readyDocuments.length > 1 ? "s" : ""} à imprimer
        {blockedDocuments.length ? ` · ${blockedDocuments.length} en attente de notes ou de configuration` : ""}.
      </p>
      {blockedDocuments.length > 0 && <details className="mt-2">
        <summary className="cursor-pointer font-semibold">Voir les bulletins non imprimables</summary>
        <ul className="mt-2 list-inside list-disc space-y-1">
          {blockedDocuments.slice(0, 12).map(row => {
            const reasons = [...new Set(selectedTracks.flatMap(track =>
              row.problemsByProgram?.[track as "french" | "arabic"] || []))];
            const name = [row.document.student.lastName, row.document.student.firstName].filter(Boolean).join(" ");
            return <li key={row.studentId}>{name || row.document.student.matricule || "Élève"} : {
              reasons.length ? reasons.slice(0, 2).map(code => reasonLabels[code] || "Notes ou paramètres à vérifier").join(", ")
                : "Moyenne ou validation indisponible"
            }</li>;
          })}
          {blockedDocuments.length > 12 && <li>Et {blockedDocuments.length - 12} autre(s) bulletin(s).</li>}
        </ul>
      </details>}
    </div>
    {error && <p role="alert" className="text-red-700 print:hidden">{error}</p>}
    <div className="specialized-print-denied" role="status">Impression indisponible : aucun bulletin validé dans la sélection. Vérifiez la configuration et les notes publiées dans Mon Cahier.</div>
    <div className={`fa-report-print-root specialized-print-root ${!printable || printPreparing || error ? "specialized-print-blocked" : ""} space-y-6 overflow-x-auto print:overflow-visible`}>
      {visibleDocuments.map(row => {
        const ready = readyDocuments.includes(row);
        return <div key={row.studentId} className={`specialized-document ${ready ? "" : "specialized-print-excluded"} ${ready && row.studentId === lastReadyId ? "specialized-last-printable" : ""}`}>
          <FrancoArabicBulletin model={{ ...row.document, school: { ...row.document.school, ...data.school },
            draft: !ready }} variant={selected} printRoot={false} />
        </div>;
      })}
    </div>
  </section>;
}
