"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

type Student = {
  id: string;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  matricule?: string | null;
  class_id?: string | null;
  class_label?: string | null;
  level?: string | null;
};

function norm(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function officialName(student: Student) {
  const fromParts = [student.last_name, student.first_name]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");

  return fromParts || String(student.full_name || "").trim() || "—";
}

export default function StudentsByClassLayout({ children }: { children: ReactNode }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/admin/students", { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (!res.ok) {
          throw new Error(json?.error || "Impossible de charger les eleves");
        }

        setStudents(Array.isArray(json?.items) ? json.items : []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Impossible de charger les eleves");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const results = useMemo(() => {
    const q = norm(query);
    if (q.length < 2) return [];

    return students
      .filter((student) => {
        const name = norm(officialName(student));
        const matricule = norm(student.matricule);
        const classLabel = norm(student.class_label);
        const level = norm(student.level);
        return (
          name.includes(q) ||
          matricule.includes(q) ||
          classLabel.includes(q) ||
          level.includes(q)
        );
      })
      .sort((a, b) => officialName(a).localeCompare(officialName(b), "fr", { sensitivity: "base" }))
      .slice(0, 50);
  }, [query, students]);

  return (
    <>
      <style jsx global>{`
        section:has(input[placeholder="Ex : KOUASSI / 20166309J"]) {
          display: none !important;
        }
      `}</style>

      <div className="mx-auto max-w-6xl px-4 pt-4 md:px-6 md:pt-6">
        <section className="rounded-2xl border border-sky-200 bg-sky-50/60 p-5 shadow-sm">
          <div className="text-sm font-semibold uppercase tracking-wide text-sky-900">
            Rechercher un élève dans tout l'établissement
          </div>
          <div className="mt-1 text-xs text-slate-600">
            La recherche fonctionne sans choisir de niveau ni de classe et affiche immédiatement la classe trouvée.
          </div>

          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nom, prénom ou matricule — ex. KOUASSI / 20166309J"
            className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-500/15"
          />

          {loading ? (
            <div className="mt-3 text-sm text-slate-600">Chargement des élèves…</div>
          ) : error ? (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {error}
            </div>
          ) : query.trim().length >= 2 ? (
            <div className="mt-4 overflow-x-auto rounded-xl border bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-left">
                  <tr>
                    <th className="px-3 py-2">Nom et prénoms</th>
                    <th className="px-3 py-2">Matricule</th>
                    <th className="px-3 py-2">Niveau</th>
                    <th className="px-3 py-2">Classe</th>
                  </tr>
                </thead>
                <tbody>
                  {results.length > 0 ? (
                    results.map((student) => (
                      <tr key={student.id} className="border-t hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-900">{officialName(student)}</td>
                        <td className="px-3 py-2">{student.matricule || "—"}</td>
                        <td className="px-3 py-2">{student.level || "—"}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex rounded-full bg-sky-100 px-2.5 py-1 font-semibold text-sky-800">
                            {student.class_label || "Non classé"}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-slate-600">
                        Aucun élève trouvé.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>

      {children}
    </>
  );
}
