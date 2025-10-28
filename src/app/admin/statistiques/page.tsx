"use client";

import { useEffect, useMemo, useState } from "react";

/* ��������������������������������������������������������������������������������������������������������������������
   Types
�������������������������������������������������������������������������������������������������������������������� */
type Subject = { id: string; name: string };
type Teacher = { id: string; display_name?: string | null; full_name?: string | null; email?: string | null; phone?: string | null };

type DetailRow = {
  id: string;
  dateISO: string;
  subject_name: string | null;
  expected_minutes: number;
};

type SummaryRow = {
  teacher_id: string;
  teacher_name: string;
  total_minutes: number;
  /** Nouveau : liste des disciplines rattach�es � cet enseignant (pivot et/ou s�ances) */
  subject_names?: string[];
};

type FetchState<T> = { loading: boolean; error: string | null; data: T | null };

/* ��������������������������������������������������������������������������������������������������������������������
   Utils
�������������������������������������������������������������������������������������������������������������������� */
function toLocalDateInputValue(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function addMinutesISO(iso: string, minutes: number) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + (minutes || 0));
  return d.toISOString();
}
function formatHHmm(iso: string) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
function formatDateFR(iso: string) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
function minutesToHourLabel(min: number) {
  const m = Math.max(0, Math.round(min || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h}h${String(r).padStart(2, "0")}`;
}
function minutesToDecimalHours(min: number) {
  return Math.round(((min || 0) / 60) * 100) / 100;
}
function downloadText(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
const teacherLabel = (t: Teacher) =>
  (t.display_name?.trim() || t.full_name?.trim() || t.email?.trim() || t.phone?.trim() || "(enseignant)");

/* ��������������������������������������������������������������������������������������������������������������������
   Composant principal
�������������������������������������������������������������������������������������������������������������������� */
export default function AdminStatistiquesPage() {
  // Filtres
  const [from, setFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toLocalDateInputValue(d);
  });
  const [to, setTo] = useState<string>(() => toLocalDateInputValue(new Date()));
  const [subjectId, setSubjectId] = useState<string>("ALL");
  const [teacherId, setTeacherId] = useState<string>("ALL");

  // Listes
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(false);

  // Donn�es
  const [summary, setSummary] = useState<FetchState<SummaryRow[]>>({
    loading: false, error: null, data: null,
  });
  const [detail, setDetail] = useState<FetchState<{ rows: DetailRow[]; total_minutes: number; count: number }>>({
    loading: false, error: null, data: null,
  });

  const showDetail = teacherId !== "ALL";

  // Charger disciplines
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/admin/subjects`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { items: Subject[] };
        setSubjects([{ id: "ALL", name: "Toutes les disciplines" }, ...json.items]);
      } catch {
        setSubjects([{ id: "ALL", name: "Toutes les disciplines" }]);
      }
    })();
  }, []);

  // Charger enseignants via la route align�e sur Affectations
  useEffect(() => {
    (async () => {
      setLoadingTeachers(true);
      try {
        const url =
          subjectId === "ALL"
            ? `/api/admin/teachers/by-subject` // retourne tous les enseignants
            : `/api/admin/teachers/by-subject?subject_id=${encodeURIComponent(subjectId)}`;

        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { items: Teacher[] };

        // Option "Tous"
        setTeachers([{ id: "ALL", display_name: "Tous les enseignants" }, ...(json.items || [])]);
        setTeacherId("ALL");
      } catch {
        setTeachers([{ id: "ALL", display_name: "Tous les enseignants" }]);
        setTeacherId("ALL");
      } finally {
        setLoadingTeachers(false);
      }
    })();
  }, [subjectId]);

  // Charger donn�es (summary ou detail)
  async function loadData() {
    if (!from || !to) return;
    if (showDetail) {
      setDetail({ loading: true, error: null, data: null });
      try {
        const qs = new URLSearchParams({ mode: "detail", from, to, teacher_id: teacherId });
        if (subjectId !== "ALL") qs.set("subject_id", subjectId);
        const res = await fetch(`/api/admin/statistics?${qs.toString()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { rows: DetailRow[]; total_minutes: number; count: number };
        setDetail({ loading: false, error: null, data: json });
        setSummary({ loading: false, error: null, data: null });
      } catch (e: any) {
        setDetail({ loading: false, error: e.message || "Erreur", data: null });
      }
    } else {
      setSummary({ loading: true, error: null, data: null });
      try {
        const qs = new URLSearchParams({ mode: "summary", from, to });
        if (subjectId !== "ALL") qs.set("subject_id", subjectId);
        const res = await fetch(`/api/admin/statistics?${qs.toString()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { items: SummaryRow[] };
        setSummary({ loading: false, error: null, data: json.items });
        setDetail({ loading: false, error: null, data: null });
      } catch (e: any) {
        setSummary({ loading: false, error: e.message || "Erreur", data: null });
      }
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, subjectId, teacherId]);

  /* �������������������������� Export CSV �������������������������� */
  function exportSummaryCSV() {
    const items = summary.data || [];
    const header = [
      "Enseignant",
      subjectId === "ALL" ? "Discipline(s)" : "Discipline (filtr�e)",
      "Total minutes",
      "Total heures (d�cimal)",
    ];
    const lines = [header.join(";")];
    for (const it of items) {
      const disciplineCell =
        subjectId === "ALL"
          ? (it.subject_names && it.subject_names.length ? it.subject_names.join(", ") : "�")
          : (subjects.find(s => s.id === subjectId)?.name || "");
      const cols = [
        it.teacher_name,
        disciplineCell,
        String(it.total_minutes),
        String(minutesToDecimalHours(it.total_minutes)),
      ];
      lines.push(cols.join(";"));
    }
    downloadText(`synthese_enseignants_${from}_${to}.csv`, lines.join("\n"));
  }

  function exportDetailCSV() {
    const d = detail.data;
    if (!d) return;
    const header = ["Date", "Heure d�but", "Plage horaire", "Discipline", "Minutes", "Heures (d�cimal)"];
    const lines = [header.join(";")];
    for (const r of d.rows) {
      const start = formatHHmm(r.dateISO);
      const end = formatHHmm(addMinutesISO(r.dateISO, r.expected_minutes || 0));
      const cols = [
        formatDateFR(r.dateISO),
        start,
        `${start}�${end}`,
        r.subject_name || "Discipline non renseign�e",
        String(r.expected_minutes ?? 0),
        String(minutesToDecimalHours(r.expected_minutes ?? 0)),
      ];
      lines.push(cols.join(";"));
    }
    downloadText(`detail_${teacherId}_${from}_${to}.csv`, lines.join("\n"));
  }

  /* �������������������������� Totaux / UI helpers �������������������������� */
  const totalMinutesSummary = useMemo(() => {
    if (!summary.data) return 0;
    return summary.data.reduce((acc, it) => acc + (it.total_minutes || 0), 0);
  }, [summary.data]);

  const disciplineHeader = subjectId === "ALL" ? "Discipline(s)" : "Discipline (filtr�e)";

  return (
    <main className="p-4 md:p-6">
      <h1 className="text-2xl font-semibold mb-4">Statistiques</h1>

      {/* Filtres */}
      <section className="grid md:grid-cols-4 gap-3 mb-6">
        <div className="space-y-1">
          <label className="text-sm font-medium">Date de d�but</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-full border rounded-xl p-2" />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Date de fin</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-full border rounded-xl p-2" />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Discipline</label>
          <select value={subjectId} onChange={e => setSubjectId(e.target.value)} className="w-full border rounded-xl p-2">
            {subjects.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Enseignant</label>
          <select
            value={teacherId}
            onChange={e => setTeacherId(e.target.value)}
            className="w-full border rounded-xl p-2"
            disabled={loadingTeachers}
          >
            {teachers.map(t => (
              <option key={t.id} value={t.id}>{teacherLabel(t)}</option>
            ))}
          </select>
          {loadingTeachers && <p className="text-xs text-gray-500">Chargement des enseignants&</p>}
        </div>
      </section>

      {/* R�sultats */}
      {teacherId === "ALL" ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Synth�se par enseignant</h2>
            <div className="flex items-center gap-2">
              <div className="text-sm">
                Total p�riode: <strong>{minutesToHourLabel(totalMinutesSummary)}</strong> ({minutesToDecimalHours(totalMinutesSummary)} h)
              </div>
              <button
                className="px-3 py-2 rounded-xl border text-sm hover:bg-gray-50"
                onClick={exportSummaryCSV}
                disabled={summary.loading || !summary.data}
              >
                Export CSV (Synth�se)
              </button>
            </div>
          </div>

          {summary.loading ? (
            <div className="p-4 border rounded-xl">Chargement&</div>
          ) : summary.error ? (
            <div className="p-4 border rounded-xl text-red-600">Erreur : {summary.error}</div>
          ) : (
            <div className="overflow-auto border rounded-xl">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2">Enseignant</th>
                    <th className="text-left px-3 py-2">{disciplineHeader}</th>
                    <th className="text-right px-3 py-2">Total minutes</th>
                    <th className="text-right px-3 py-2">Total heures</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary.data || []).map((row) => {
                    const disciplineCell =
                      subjectId === "ALL"
                        ? (row.subject_names && row.subject_names.length ? row.subject_names.join(", ") : "�")
                        : (subjects.find(s => s.id === subjectId)?.name || "");
                    return (
                      <tr key={row.teacher_id} className="border-t">
                        <td className="px-3 py-2">{row.teacher_name}</td>
                        <td className="px-3 py-2">{disciplineCell}</td>
                        <td className="px-3 py-2 text-right">{row.total_minutes}</td>
                        <td className="px-3 py-2 text-right">{minutesToDecimalHours(row.total_minutes)}</td>
                      </tr>
                    );
                  })}
                  {(!summary.data || summary.data.length === 0) && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-gray-500">Aucune donn�e sur la p�riode.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">D�tails de l�"enseignant</h2>
            <div className="flex items-center gap-2">
              {detail.data && (
                <div className="text-sm">
                  {detail.data.count} s�ance(s) " Total : <strong>{minutesToHourLabel(detail.data.total_minutes)}</strong> ({minutesToDecimalHours(detail.data.total_minutes)} h)
                </div>
              )}
              <button
                className="px-3 py-2 rounded-xl border text-sm hover:bg-gray-50"
                onClick={exportDetailCSV}
                disabled={detail.loading || !detail.data}
              >
                Export CSV (D�tail)
              </button>
            </div>
          </div>

          {detail.loading ? (
            <div className="p-4 border rounded-xl">Chargement&</div>
          ) : detail.error ? (
            <div className="p-4 border rounded-xl text-red-600">Erreur : {detail.error}</div>
          ) : (
            <div className="overflow-auto border rounded-xl">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2">Plage horaire</th>
                    <th className="text-left px-3 py-2">Discipline</th>
                    <th className="text-right px-3 py-2">Minutes</th>
                    <th className="text-right px-3 py-2">Heures</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.data?.rows || []).map((r) => {
                    const start = formatHHmm(r.dateISO);
                    const end = formatHHmm(addMinutesISO(r.dateISO, r.expected_minutes || 0));
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="px-3 py-2">{formatDateFR(r.dateISO)}</td>
                        <td className="px-3 py-2">{start}�{end}</td>
                        <td className="px-3 py-2">{r.subject_name || "Discipline non renseign�e"}</td>
                        <td className="px-3 py-2 text-right">{r.expected_minutes ?? 0}</td>
                        <td className="px-3 py-2 text-right">{minutesToDecimalHours(r.expected_minutes ?? 0)}</td>
                      </tr>
                    );
                  })}
                  {(!detail.data || detail.data.rows.length === 0) && (
                    <tr>
                      <td colSpan={5} className="px-3 py-4 text-center text-gray-500">Aucune donn�e pour cet enseignant sur la p�riode.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}


