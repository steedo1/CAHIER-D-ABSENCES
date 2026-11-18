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
  phone_e164?: string | null;
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
  const [teacherPhone, setTeacherPhone] = useState("");
  const [initialPassword, setInitialPassword] = useState<string | null>(null);
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
    setInitialPassword(null);
    try {
      const response = await fetch("/api/admin/primary-class-teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_id: classId, display_name: name, phone: teacherPhone }),
      });
      const result = (await response.json().catch(() => ({}))) as Directory;
      if (!response.ok) throw new Error(result.error || "Enregistrement impossible.");
      const next = await refresh();
      setTeacherName(next.items?.find((row) => row.class_id === classId)?.display_name || name);
      setTeacherPhone(next.items?.find((row) => row.class_id === classId)?.phone_e164 || teacherPhone);
      setMessage("Maître de classe enregistré. Aucun horaire ni discipline n'a été exigé.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  async function activate() {
    if (!current || !teacherPhone.trim()) {
      setMessage("Enregistrez le maître et son numéro avant d'activer le compte.");
      return;
    }
    if (!window.confirm(
      "Activer un compte personnel pour " + current.display_name + " et lui confier " +
      (selectedClass?.label || selectedClass?.code || "la classe") +
      " ? L'ancien titulaire perdra ses affectations actives de cette classe."
    )) return;

    setSaving(true);
    setMessage("");
    setInitialPassword(null);
    try {
      const response = await fetch("/api/admin/primary-class-teachers/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_id: classId, phone: teacherPhone }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Activation impossible.");
      if (typeof result.initial_password === "string") {
        setInitialPassword(result.initial_password);
      }
      await refresh();
      setMessage(result.already_active
        ? "Compte déjà activé. Aucun mot de passe n'a été modifié."
        : "Compte activé et lié au maître de classe. Conservez le mot de passe provisoire, affiché une seule fois.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Échec de l'activation.");
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
              setTeacherPhone(items.find((row) => row.class_id === id)?.phone_e164 || "");
              setInitialPassword(null);
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
        <label className="text-sm font-medium text-slate-700 md:col-span-2">
          Téléphone de connexion (facultatif pour la fiche)
          <input
            className="mt-1 w-full rounded-lg border px-3 py-2"
            value={teacherPhone}
            onChange={(event) => setTeacherPhone(event.target.value)}
            placeholder="Ex. 0565366730"
            inputMode="tel"
            autoComplete="tel"
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
        {current && !current.account_linked && (
          <button
            type="button"
            onClick={() => void activate()}
            disabled={saving || !teacherPhone.trim() || teacherName.trim() !== current.display_name}
            className="rounded-xl border border-sky-700 bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Activation…" : "Créer et activer son compte"}
          </button>
        )}
        <span className="text-xs text-slate-500">
          Année scolaire : {data.academic_year || selectedClass?.academic_year || "en cours"}
        </span>
      </div>
      {message && <p className="mt-3 text-sm text-slate-700" role="status">{message}</p>}
      {initialPassword && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="status">
          <p className="font-semibold">Mot de passe provisoire — à transmettre confidentiellement</p>
          <p className="mt-1 break-all font-mono">{initialPassword}</p>
          <button type="button" onClick={() => void navigator.clipboard.writeText(initialPassword)}
            className="mt-2 rounded-lg border border-amber-600 px-3 py-1 text-xs font-semibold">
            Copier le mot de passe
          </button>
        </div>
      )}
      <p className="mt-3 text-xs text-amber-800">
        La fiche est enregistrée sans discipline ni horaire imposé.
        L'activation du compte est une action distincte : elle crée l'accès personnel
        et transfère les affectations internes déjà configurées pour cette classe.
      </p>
      {items.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-slate-600">
              <tr><th className="px-2 py-2">Classe</th><th className="px-2 py-2">Maître</th><th className="px-2 py-2">Téléphone</th><th className="px-2 py-2">Accès</th></tr>
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
                    <td className="px-2 py-2">{teacher.phone_e164 || "À renseigner"}</td>
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
