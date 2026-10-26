"use client";

import { useEffect, useMemo, useState } from "react";

type Student = { id: string; name: string; suggestion: string };
type StoredResponse = {
  ok: boolean;
  observations?: Record<string, Record<string, { text: string; validated: true }>>;
};
type Props = {
  classId: string;
  academicYear: string;
  periodId: string;
  students: Student[];
};
const risk = /avertissement|blâme|blame|sanction|conduite à améliorer|conduite très insuffisante|résultats insuffisants|résultats très insuffisants/i;

export default function SchoolReportObservationsPanel({ classId, academicYear, periodId, students }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const signature = useMemo(() => students.map(s => s.id).join(","), [students]);
  useEffect(() => {
    let active = true;
    if (!academicYear || !classId || !periodId) return;
    setLoading(true);
    setMessage("");
    void fetch("/api/admin/notes/school-report-fields?academic_year=" + encodeURIComponent(academicYear),
      { cache: "no-store" })
      .then(async res => {
        const data = (await res.json()) as StoredResponse;
        if (!res.ok || !data.ok) throw new Error("Observations indisponibles.");
        if (!active) return;
        const valid = data.observations?.[periodId] || {};
        const fromStorage: Record<string, string> = {};
        const next: Record<string, string> = {};
        for (const row of students) {
          const saved = valid[row.id]?.validated ? valid[row.id].text : "";
          fromStorage[row.id] = saved;
          next[row.id] = saved || row.suggestion || "";
        }
        setOriginal(fromStorage);
        setDrafts(next);
      })
      .catch(err => { if (active) setMessage(String(err.message || err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // Identité de classe et de liste ; les suggestions se figent au chargement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, academicYear, periodId, signature]);

  const pending = students.filter(s => (drafts[s.id] || "").trim() !== (original[s.id] || "").trim());
  const confirmed = students.filter(s => Boolean(original[s.id]?.trim())).length;

  async function validate() {
    if (!pending.length) { setMessage("Aucune observation à valider."); return; }
    if (pending.some(row => risk.test(drafts[row.id] || ""))) {
      if (!window.confirm("Certaines observations contiennent une sanction ou une appréciation défavorable. Confirmez-vous personnellement leur validation pour le rapport officiel ?")) return;
    }
    setSaving(true);
    setMessage("");
    try {
      // Une écriture par classe, en lots bornés pour éviter les surcharges.
      for (let i = 0; i < pending.length; i += 200) {
        const chunk = pending.slice(i, i + 200);
        const res = await fetch("/api/admin/notes/school-report-fields", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            class_id: classId, academic_year: academicYear, period_id: periodId,
            observations: chunk.map(row => ({
              student_id: row.id, text: (drafts[row.id] || "").trim(), validated: true,
            })),
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) throw new Error(json.error || "Validation impossible.");
        setOriginal(prev => {
          const next = { ...prev };
          chunk.forEach(row => { next[row.id] = (drafts[row.id] || "").trim(); });
          return next;
        });
      }
      setMessage("Observations validées : elles apparaîtront dans le Rapport 2.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erreur de validation.");
    } finally {
      setSaving(false);
    }
  }

  if (!academicYear || !periodId || !classId || students.length === 0) return null;
  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4" aria-label="Observations du conseil de classe">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Observations du conseil de classe</h2>
          <p className="mt-1 text-xs text-slate-600">Propositions non officielles avant validation. Corrigez-les librement ; aucune sanction n'est enregistrée automatiquement.</p>
          <p className="mt-1 text-xs text-slate-500">{confirmed} observation(s) validée(s) · {pending.length} à confirmer</p>
        </div>
        <button type="button" onClick={() => void validate()} disabled={loading || saving || pending.length === 0}
          className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          {saving ? "Validation…" : "Valider les observations"}
        </button>
      </div>
      {loading ? <p className="mt-4 text-sm">Chargement…</p> : (
        <div className="mt-4 max-h-[430px] overflow-auto rounded-xl border">
          <table className="min-w-[720px] w-full text-xs">
            <thead className="sticky top-0 bg-slate-100"><tr>
              <th className="px-3 py-2 text-left">Élève</th>
              <th className="px-3 py-2 text-left">Observation à valider</th>
              <th className="px-3 py-2 text-left">État</th>
            </tr></thead>
            <tbody>{students.map(row => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2 font-semibold">{row.name}</td>
                <td className="px-3 py-2">
                  <input className="w-full rounded-lg border border-slate-300 px-2 py-1.5"
                    value={drafts[row.id] ?? ""}
                    maxLength={250}
                    onChange={e => setDrafts(prev => ({ ...prev, [row.id]: e.target.value }))}
                    aria-label={"Observation de " + row.name}
                    placeholder="Observation facultative"
                  />
                </td>
                <td className="px-3 py-2">
                  {drafts[row.id]?.trim() === original[row.id]?.trim()
                    ? (original[row.id]?.trim() ? "Validée" : "À renseigner") : "À valider"}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {message && <p role="status" className="mt-3 text-sm text-slate-700">{message}</p>}
    </section>
  );
}
