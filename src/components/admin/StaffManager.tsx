"use client";

import { useEffect, useState } from "react";

type StaffItem = {
  id: string;
  display_name: string | null;
  phone: string | null;
  email: string | null;
  role: string;
  editable: boolean;
};

type InstitutionInfo = { id: string; name: string; code: string };

type SchoolClass = {
  id: string;
  code: string;
  label: string | null;
  level: string | null;
  academic_year: string;
};

type StaffDetail = {
  ok: boolean;
  profile: StaffItem;
  classes: SchoolClass[];
  academic_year?: string;
  assigned_class_ids: string[];
  whole_levels: string[];
};

const ROLE_LABELS: Record<string, string> = {
  teacher: "Enseignant",
  educator: "Éducateur",
  infirmier: "Infirmier",
  file_correspondent: "Correspondant fichier",
  finance_manager: "Gestionnaire financier",
  admin: "Administrateur",
};

function ErrorBox({ text }: { text: string | null }) {
  return text ? (
    <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">
      {text}
    </p>
  ) : null;
}

export default function StaffManager() {
  const [schoolCode, setSchoolCode] = useState("");
  const [institution, setInstitution] = useState<InstitutionInfo | null>(null);
  const [query, setQuery] = useState("");
  const [staff, setStaff] = useState<StaffItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [detail, setDetail] = useState<StaffDetail | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [savingClasses, setSavingClasses] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function listStaff(search: string, code: string) {
    setLoading(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams({ q: search.trim() });
      if (code.trim()) params.set("institution_code", code.trim());
      const r = await fetch("/api/admin/staff?" + params.toString(), { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Impossible de charger le personnel.");
      setInstitution(j.institution || null);
      setStaff(Array.isArray(j.items) ? j.items : []);
    } catch (e) {
      setStaff([]);
      setInstitution(null);
      setSearchError(e instanceof Error ? e.message : "Recherche impossible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void listStaff("", "");
  }, []);

  async function openStaff(person: StaffItem) {
    if (!person.editable || !institution) return;
    setSaving(false);
    setSavingClasses(false);
    setEditError(null);
    setSuccess(null);
    try {
      const params = new URLSearchParams({ institution_id: institution.id });
      const r = await fetch("/api/admin/staff/" + person.id + "?" + params.toString(), { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "Impossible de charger cette fiche.");
      const d = j as StaffDetail;
      setDetail(d);
      setDisplayName(d.profile.display_name || "");
      setPhone(d.profile.phone || "");
      setEmail(d.profile.email || "");
      setSelectedClasses(d.assigned_class_ids || []);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Lecture du personnel impossible.");
    }
  }

  async function saveIdentity() {
    if (!detail || !institution || saving) return;
    setEditError(null);
    setSuccess(null);
    const phoneChanged = phone.replace(/\D/g, "") !== String(detail.profile.phone || "").replace(/\D/g, "");
    const emailChanged = email.trim().toLowerCase() !== String(detail.profile.email || "").trim().toLowerCase();
    if ((phoneChanged || emailChanged) &&
      !window.confirm("La connexion utilisera immédiatement le nouvel identifiant. Le mot de passe reste inchangé. Confirmer ?")) {
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/admin/staff/" + detail.profile.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          institution_id: institution.id,
          display_name: displayName,
          phone,
          email,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "Enregistrement impossible.");
      const updatedProfile = j.profile || detail.profile;
      setDetail((previous) => previous ? { ...previous, profile: { ...previous.profile, ...updatedProfile } } : previous);
      setDisplayName(updatedProfile.display_name || "");
      setPhone(updatedProfile.phone || "");
      setEmail(updatedProfile.email || "");
      setSuccess("Identité enregistrée. Le compte, son mot de passe et son historique sont conservés.");
      await listStaff(query, schoolCode);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Modification impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function saveAssignments() {
    if (!detail || !institution || savingClasses || !detail.academic_year || detail.whole_levels.length) return;
    setSavingClasses(true);
    setEditError(null);
    setSuccess(null);
    try {
      const r = await fetch("/api/admin/staff/" + detail.profile.id + "/assignments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          institution_id: institution.id,
          academic_year: detail.academic_year,
          class_ids: selectedClasses,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "Affectations non enregistrées.");
      setDetail((previous) => previous ? { ...previous, assigned_class_ids: j.assigned_class_ids || [] } : previous);
      setSuccess("Affectations de l'année active enregistrées, sans toucher aux autres années.");
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Modification impossible.");
    } finally {
      setSavingClasses(false);
    }
  }

  function toggleClass(id: string) {
    setSelectedClasses((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    );
  }

  return (
    <section id="manage-staff" className="rounded-2xl border border-sky-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-slate-900">Gérer le personnel existant</h2>
      <p className="mt-1 text-sm text-slate-600">
        Corriger le nom, le téléphone de connexion ou l'e-mail sans recréer le compte.
        Les éducateurs peuvent aussi changer leurs classes de suivi.
      </p>

      <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(e) => {
        e.preventDefault();
        void listStaff(query, schoolCode);
      }}>
        <label className="min-w-56 flex-1 text-sm font-medium text-slate-700">
          Nom, téléphone ou e-mail
          <input className="mt-1 w-full rounded-lg border px-3 py-2 font-normal"
            value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un personnel" />
        </label>
        <label className="w-44 text-sm font-medium text-slate-700">
          Code établissement
          <input className="mt-1 w-full rounded-lg border px-3 py-2 font-normal"
            value={schoolCode} onChange={(e) => setSchoolCode(e.target.value)}
            placeholder="Super Admin seulement" />
        </label>
        <button disabled={loading} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {loading ? "Recherche…" : "Rechercher"}
        </button>
      </form>

      {institution && (
        <p className="mt-3 text-xs text-slate-500">
          Établissement : <b>{institution.name}</b> ({institution.code}) — au plus 100 résultats par recherche.
        </p>
      )}
      <ErrorBox text={searchError} />

      <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
        {staff.length === 0 && !loading && !searchError && (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Aucun personnel trouvé.</p>
        )}
        {staff.map((person) => (
          <div key={person.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold text-slate-900">{person.display_name || "(Sans nom)"}</p>
              <p className="text-xs text-slate-600">
                {ROLE_LABELS[person.role] || person.role} — {person.phone || person.email || "Identifiant absent"}
              </p>
            </div>
            <button type="button" disabled={!person.editable || loading}
              title={person.editable ? "Modifier ce compte" : "Modification réservée au Super Admin"}
              className="rounded-lg border border-sky-500 px-3 py-1.5 text-sm font-medium text-sky-700 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => void openStaff(person)}>
              Modifier
            </button>
          </div>
        ))}
      </div>

      {detail && institution && (
        <div role="dialog" aria-modal="true" aria-label="Modifier le personnel"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold">Modifier un personnel</h3>
                <p className="text-xs text-slate-500">
                  {ROLE_LABELS[detail.profile.role] || detail.profile.role} — {institution.name}
                </p>
              </div>
              <button type="button" className="rounded-lg border px-3 py-1 text-sm"
                disabled={saving || savingClasses} onClick={() => { setDetail(null); setSuccess(null); setEditError(null); }}>
                Fermer
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-sm font-medium md:col-span-2">
                Nom et prénoms
                <input className="mt-1 w-full rounded-lg border px-3 py-2 font-normal"
                  value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={160} />
              </label>
              <label className="text-sm font-medium">
                Téléphone de connexion
                <input className="mt-1 w-full rounded-lg border px-3 py-2 font-normal"
                  type="tel" inputMode="tel" value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="07 01 02 03 04" />
              </label>
              <label className="text-sm font-medium">
                E-mail (facultatif)
                <input className="mt-1 w-full rounded-lg border px-3 py-2 font-normal"
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="Aucun e-mail" />
              </label>
            </div>
            <p className="mt-2 text-xs text-amber-700">
              Modifier un téléphone ou un e-mail change l'identifiant de connexion.
              Le mot de passe, les rôles et les historiques restent conservés.
              La suppression d'un e-mail déjà existant nécessite l'intervention du Super Admin.
            </p>
            <button type="button" onClick={() => void saveIdentity()} disabled={saving || savingClasses}
              className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? "Enregistrement…" : "Enregistrer l'identité"}
            </button>

            {detail.profile.role === "educator" && (
              <div className="mt-5 border-t pt-4">
                <h4 className="font-semibold">Classes suivies — {detail.academic_year || "année non définie"}</h4>
                {detail.whole_levels.length ? (
                  <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    Cet éducateur possède une affectation à un niveau entier ({detail.whole_levels.join(", ")}).
                    Afin de préserver l'historique, la modification de cette portée nécessite une vérification par l'administration.
                  </p>
                ) : (
                  <>
                    <div className="mt-3 grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
                      {detail.classes.map((classe) => (
                        <label key={classe.id} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
                          <input type="checkbox" checked={selectedClasses.includes(classe.id)}
                            onChange={() => toggleClass(classe.id)} />
                          {classe.label || classe.code} <span className="text-xs text-slate-500">({classe.level})</span>
                        </label>
                      ))}
                    </div>
                    <button type="button" onClick={() => void saveAssignments()}
                      disabled={savingClasses || saving || !detail.academic_year}
                      className="mt-3 rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                      {savingClasses ? "Enregistrement…" : "Enregistrer les affectations"}
                    </button>
                  </>
                )}
              </div>
            )}
            <ErrorBox text={editError} />
            {success && <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}
          </div>
        </div>
      )}
    </section>
  );
}
