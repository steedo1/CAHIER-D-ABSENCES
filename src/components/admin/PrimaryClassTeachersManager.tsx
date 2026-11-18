"use client";

import { useEffect, useState } from "react";

type PrimaryClass = {
  id: string;
  code: string;
  label: string | null;
  level: string | null;
  academic_year: string;
};
type PrimaryTeacher = {
  id: string;
  class_id: string;
  display_name: string;
  account_linked: boolean;
};
type Directory = {
  ok?: boolean;
  enabled?: boolean;
  academic_year?: string | null;
  classes?: PrimaryClass[];
  items?: PrimaryTeacher[];
  error?: string;
};

export default function PrimaryClassTeachersManager() {
  const [data, setData] = useState<Directory | null>(null);
  const [classId, setClassId] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    const response = await fetch("/api/admin/primary-class-teachers", { cache: "no-store" });
    const result = (await response.json().catch(() => ({}))) as Directory;
    if (!response.ok) throw new Error(result.error || "Impossible de charger les maîtres du primaire.");
    setData(result);
    return result;
  }

  useEffect(() => {
    let active = true;
    fetch("/api/admin/primary-class-teachers", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as Directory;
        if (!response.ok) throw new Error(body.error || "Répertoire primaire indisponible.");
        return body;
      })
      .then((body) => { if (active) setData(body); })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Erreur de chargement."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (loading) return null;
  if (!data?.enabled) return null;

  const classes = data.classes || [];
  const items = data.items || [];
  const current = items.find((row) => row.class_id === classId) || null;
  const selectedClass = classes.find((row) => row.id === classId) || null;

  async function save() {
    const name = teacherName.normalize("NFC").trim().replace(/\s+/g, " ");
    if (!classId || name.length < 2) {
      setMessage("Choisissez une classe et indiquez le nom du maître.");
      return;
    }
    if (current && current.display_name !== name &&
        !window.confirm("Cette classe possède déjà un maître enregistré. Remplacer sa fiche administrative ?")) {
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/primary-class-teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_id: classId, display_name: name }),
      });
      const result = (await response.json().catch(() => ({}))) as Directory;
      if (!response.ok) throw new Error(result.error || "Enregistrement impossible.");
      const next = await refresh();
      setTeacherName(next.items?.find((row) => row.class_id === classId)?.display_name || name);
      setMessage("Maître de classe enregistré. Aucun horaire ni discipline n'a été exigé.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border bg-white p-5">
      <h2 className="text-base font-semibold text-slate-900">Maîtres du primaire</h2>
      <p className="mt-2 text-sm text-slate-600">
        Au primaire, le titulaire est rattaché directement à sa classe, sans
        sélection de matière, sans quota horaire et sans emploi du temps imposé.
        Les enseignements français et arabe restent distincts selon la classe choisie.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">
          Classe
          <select
            className="mt-1 w-full rounded-lg border bg-white px-3 py-2"
            value={classId}
            onChange={(event) => {
              const id = event.target.value;
              setClassId(id);
              setTeacherName(items.find((row) => row.class_id === id)?.display_name || "");
              setMessage("");
            }}
          >
            <option value="">— Choisir une classe —</option>
            {classes.map((classe) => (
              <option key={classe.id} value={classe.id}>
                {classe.label || classe.code} ({classe.academic_year})
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Nom et prénoms du maître
          <input
            className="mt-1 w-full rounded-lg border px-3 py-2"
            value={teacherName}
            onChange={(event) => setTeacherName(event.target.value)}
            placeholder="Ex. Sou Sie Gaston"
            maxLength={160}
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !classId || teacherName.trim().length < 2}
          className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Enregistrement…" : current ? "Mettre à jour le maître" : "Enregistrer le maître"}
        </button>
        <span className="text-xs text-slate-500">
          Année scolaire : {data.academic_year || selectedClass?.academic_year || "en cours"}
        </span>
      </div>
      {message && <p className="mt-3 text-sm text-slate-700" role="status">{message}</p>}
      <p className="mt-3 text-xs text-amber-800">
        Cette fiche crée l'affectation administrative du maître. Elle ne génère
        pas de compte de connexion : un identifiant personnel devra être ajouté
        séparément pour accéder aux notes, aux appels et au cahier de texte.
      </p>
      {items.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-slate-600">
              <tr><th className="px-2 py-2">Classe</th><th className="px-2 py-2">Maître</th><th className="px-2 py-2">Accès</th></tr>
            </thead>
            <tbody>
              {items
                .filter((teacher) => classes.some((classe) => classe.id === teacher.class_id))
                .sort((a, b) => {
                  const aCode = classes.find((classe) => classe.id === a.class_id)?.code || "";
                  const bCode = classes.find((classe) => classe.id === b.class_id)?.code || "";
                  return aCode.localeCompare(bCode, "fr", { numeric: true });
                })
                .map((teacher) => (
                  <tr key={teacher.id} className="border-b last:border-0">
                    <td className="px-2 py-2">{classes.find((classe) => classe.id === teacher.class_id)?.label || "Classe"}</td>
                    <td className="px-2 py-2 font-medium">{teacher.display_name}</td>
                    <td className="px-2 py-2">{teacher.account_linked ? "Compte lié" : "Identifiant à ajouter"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
