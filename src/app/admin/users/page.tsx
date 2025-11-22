// src/app/admin/users/page.tsx
"use client";

import { useEffect, useState } from "react";

function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={
        "w-full rounded-lg border px-3 py-2 text-sm " + (p.className ?? "")
      }
    />
  );
}
function Button(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={
        "rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm font-medium shadow " +
        (p.disabled ? "opacity-60" : "hover:bg-emerald-700 transition")
      }
    />
  );
}
function Help({ children }: { children: any }) {
  return (
    <div className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-[12px] text-amber-800">
      {children}
    </div>
  );
}

type SubjectItem = { id: string; name: string };
type TeacherRow = {
  id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
};

// Réponse /api/admin/users (recherche)
type AdminUserItem = {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
};

type CreateRole = "teacher" | "educator" | "admin";

export default function UsersPage() {
  // État auth (session expirée)
  const [authErr, setAuthErr] = useState(false);

  // CHOIX DU ROLE
  const [createRole, setCreateRole] = useState<CreateRole>("teacher");

  // ENSEIGNANT / EDUCATEUR / ADMIN (création)
  const [tEmail, setTEmail] = useState("");
  const [tPhone, setTPhone] = useState("");
  const [tName, setTName] = useState("");
  const [tSubject, setTSubject] = useState(""); // discipline (utilisée pour les enseignants)

  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Suggestions de disciplines
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/subjects", { cache: "no-store" });
        if (r.status === 401) {
          setAuthErr(true);
          return;
        }
        const j = await r.json().catch(() => ({}));
        setSubjects(j.items || []);
      } catch {
        setMsg("Impossible de charger les disciplines.");
      }
    })();
  }, []);

  async function createUser() {
    setSubmitting(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/users/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: createRole,
          email: tEmail.trim() || null, // email optionnel
          phone: tPhone.trim(), // téléphone obligatoire pour tous nos rôles ici
          display_name: tName.trim() || null,
          subject: createRole === "teacher" ? tSubject.trim() || null : null, // discipline seulement pour teacher
        }),
      });
      const j = await r.json().catch(() => ({}));
      setSubmitting(false);
      if (r.status === 401) {
        setAuthErr(true);
        return;
      }
      if (!r.ok) {
        setMsg(j?.error || "Échec");
        return;
      }

      let labelRole = "utilisateur";
      if (createRole === "teacher") labelRole = "enseignant";
      if (createRole === "educator") labelRole = "éducateur";
      if (createRole === "admin") labelRole = "admin";

      setMsg(`Compte ${labelRole} créé.`);

      setTEmail("");
      setTPhone("");
      setTName("");
      setTSubject("");

      // Recharger les suggestions de disciplines (au cas où on en a créé une)
      try {
        const r2 = await fetch("/api/admin/subjects", { cache: "no-store" });
        const j2 = await r2.json().catch(() => ({}));
        setSubjects(j2.items || []);
      } catch {}
      // Recharger la liste des enseignants pour la carte “Ajouter une discipline”
      try {
        await loadTeachersForAdd();
      } catch {}
    } catch {
      setSubmitting(false);
      setMsg("Erreur réseau.");
    }
  }

  // ───────────────── Retirer un enseignant ─────────────────
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<AdminUserItem[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [rmMsg, setRmMsg] = useState<string | null>(null);

  async function searchUsers() {
    if (!q.trim()) return;
    setSearching(true);
    setRmMsg(null);
    try {
      const url = `/api/admin/users?q=${encodeURIComponent(q.trim())}`;
      const r = await fetch(url, { cache: "no-store" });
      if (r.status === 401) {
        setAuthErr(true);
        setResults([]);
        setSearching(false);
        return;
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setRmMsg(j?.error || "Recherche impossible.");
        setResults([]);
      } else {
        setResults((j.items || []) as AdminUserItem[]);
      }
    } catch (e: any) {
      setRmMsg(e?.message || "Erreur de recherche.");
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function removeTeacher(profile_id: string) {
    setRemovingId(profile_id);
    setRmMsg(null);
    try {
      const r = await fetch("/api/admin/teachers/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id,
          end_open_sessions: true,
          unset_profile_institution: true, // nettoie institution active si c'était celle-ci
        }),
      });
      if (r.status === 401) {
        setAuthErr(true);
        setRemovingId(null);
        return;
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setRmMsg(j?.error || "Échec de la suppression.");
        return;
      }
      const ended = j?.ended_sessions ? ` — ${j.ended_sessions} séance(s) clôturée(s)` : "";
      const cleared = j?.cleared_institution ? " — institution active nettoyée" : "";
      setRmMsg(`Enseignant retiré de l’établissement${ended}${cleared}.`);
      setResults((prev) => prev.filter((u) => u.id !== profile_id));

      // Recharger liste enseignants pour carte “Ajouter une discipline”
      try {
        await loadTeachersForAdd();
      } catch {}
    } catch (e: any) {
      setRmMsg(e?.message || "Erreur réseau.");
    } finally {
      setRemovingId(null);
    }
  }

  // ──────────────── Ajouter une discipline à un enseignant ────────────────
  const [teachersForAdd, setTeachersForAdd] = useState<TeacherRow[]>([]);
  const [teacherIdForAdd, setTeacherIdForAdd] = useState<string>("");
  const [newSubjectName, setNewSubjectName] = useState("");
  const [addingSubject, setAddingSubject] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);

  async function loadTeachersForAdd() {
    // Liste de tous les enseignants de l’établissement (endpoint existant, sans filtre subject)
    const r = await fetch("/api/admin/teachers/by-subject", { cache: "no-store" });
    if (r.status === 401) {
      setAuthErr(true);
      return;
    }
    const j = await r.json().catch(() => ({}));
    setTeachersForAdd(j.items || []);
  }

  useEffect(() => {
    // Charger dès l’ouverture de la page
    loadTeachersForAdd().catch(() => {});
  }, []);

  async function addSubjectToTeacher() {
    if (!teacherIdForAdd || !newSubjectName.trim()) return;
    setAddingSubject(true);
    setAddMsg(null);
    try {
      const r = await fetch("/api/admin/teachers/subjects/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: teacherIdForAdd,
          subject: newSubjectName.trim(),
        }),
      });
      const j = await r.json().catch(() => ({}));
      setAddingSubject(false);
      if (r.status === 401) {
        setAuthErr(true);
        return;
      }
      if (!r.ok) {
        setAddMsg(j?.error || "Échec.");
        return;
      }

      // Rafraîchir suggestions de disciplines (au cas où on vient d’en créer une)
      try {
        const r2 = await fetch("/api/admin/subjects", { cache: "no-store" });
        const j2 = await r2.json().catch(() => ({}));
        setSubjects(j2.items || []);
      } catch {}

      setAddMsg("Discipline ajoutée à l’enseignant.");
      setNewSubjectName("");
    } catch (e: any) {
      setAddingSubject(false);
      setAddMsg(e?.message || "Erreur réseau.");
    }
  }

  if (authErr) {
    return (
      <div className="rounded-xl border bg-white p-5">
        <div className="text-sm text-slate-700">
          Votre session a expiré.{" "}
          <a className="text-emerald-700 underline" href="/login">
            Se reconnecter
          </a>
        </div>
      </div>
    );
  }

  const currentRoleLabel =
    createRole === "teacher"
      ? "enseignant"
      : createRole === "educator"
      ? "éducateur"
      : "admin";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Utilisateurs & rôles</h1>
        <p className="text-slate-600">
          Créer des comptes <b>enseignants</b>, <b>éducateurs</b> ou{" "}
          <b>admins d’établissement</b> (mot de passe temporaire). La discipline ne
          concerne que les <b>enseignants</b>.
        </p>
      </div>

      {/* Carte 1 : Création utilisateur (teacher / educator / admin) */}
      <div className="rounded-2xl border bg-white p-5">
        <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Créer un compte ({currentRoleLabel})
        </div>
        <Help>
          Téléphone <b>obligatoire</b> (pour la connexion). Email <b>facultatif</b>.
          La discipline est <b>réservée aux enseignants</b> (utile surtout au PRIMAIRE).
        </Help>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs text-slate-500">Rôle du compte</div>
            <select
              className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
              value={createRole}
              onChange={(e) => setCreateRole(e.target.value as CreateRole)}
            >
              <option value="teacher">Enseignant</option>
              <option value="educator">Éducateur</option>
              <option value="admin">Admin d’établissement</option>
            </select>
          </div>

          <div>
            <div className="mb-1 text-xs text-slate-500">Nom affiché</div>
            <Input
              value={tName}
              onChange={(e) => setTName(e.target.value)}
              placeholder="Mme/M. NOM"
              autoComplete="name"
            />
          </div>

          <div>
            <div className="mb-1 text-xs text-slate-500">Email (optionnel)</div>
            <Input
              type="email"
              value={tEmail}
              onChange={(e) => setTEmail(e.target.value)}
              placeholder="utilisateur@exemple.com"
              autoComplete="email"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-500">Téléphone</div>
            <Input
              type="tel"
              value={tPhone}
              onChange={(e) => setTPhone(e.target.value)}
              placeholder="+225..."
              autoComplete="tel"
            />
          </div>

          {createRole === "teacher" && (
            <div>
              <div className="mb-1 text-xs text-slate-500">Discipline</div>
              <Input
                list="subjects-list"
                value={tSubject}
                onChange={(e) => setTSubject(e.target.value)}
                placeholder="Mathématiques, Français…"
              />
              <datalist id="subjects-list">
                {subjects.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
              <div className="mt-1 text-[11px] text-slate-500">
                Tu peux saisir une nouvelle discipline ou choisir une existante.
              </div>
            </div>
          )}
        </div>

        <div className="mt-4">
          <Button onClick={createUser} disabled={submitting || !tPhone.trim()}>
            {submitting ? "Création…" : `Créer le compte ${currentRoleLabel}`}
          </Button>
        </div>
        {msg && (
          <div className="mt-2 text-sm text-slate-600" aria-live="polite">
            {msg}
          </div>
        )}
      </div>

      {/* Carte 1bis : Ajouter une discipline à un enseignant */}
      <div className="rounded-2xl border bg-white p-5">
        <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Ajouter une discipline à un enseignant
        </div>
        <Help>
          Permet d’associer <b>plusieurs matières</b> au <b>même enseignant</b> dans cet
          établissement.
        </Help>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="md:col-span-1">
            <div className="mb-1 text-xs text-slate-500">Enseignant</div>
            <select
              className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
              value={teacherIdForAdd}
              onChange={(e) => setTeacherIdForAdd(e.target.value)}
            >
              <option value="">— Choisir —</option>
              {teachersForAdd.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.display_name || "(Sans nom)"}{" "}
                  {t.phone ? `— ${t.phone}` : t.email ? `— ${t.email}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-1">
            <div className="mb-1 text-xs text-slate-500">Discipline</div>
            <Input
              list="subjects-list"
              value={newSubjectName}
              onChange={(e) => setNewSubjectName(e.target.value)}
              placeholder="Ex: Mathématiques"
            />
          </div>

          <div className="md:col-span-1 flex items-end">
            <Button
              onClick={addSubjectToTeacher}
              disabled={addingSubject || !teacherIdForAdd || !newSubjectName.trim()}
              title={!teacherIdForAdd ? "Choisissez d’abord un enseignant" : "Ajouter la discipline"}
            >
              {addingSubject ? "Ajout…" : "Ajouter la discipline"}
            </Button>
          </div>
        </div>

        {addMsg && <div className="mt-2 text-sm text-emerald-700">{addMsg}</div>}
      </div>

      {/* Carte 2 : Retirer un enseignant de l’établissement */}
      <div className="rounded-2xl border bg-white p-5">
        <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Retirer un enseignant de l’établissement
        </div>
        <Help>
          Recherchez l’utilisateur par <b>nom</b>, <b>email</b> ou <b>téléphone</b>,
          puis cliquez sur <b>Retirer</b>.
        </Help>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <div className="mb-1 text-xs text-slate-500">Recherche</div>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nom, email ou téléphone"
              onKeyDown={(e) => {
                if (e.key === "Enter") searchUsers();
              }}
            />
          </div>
          <Button onClick={searchUsers} disabled={searching || !q.trim()}>
            {searching ? "Recherche…" : "Rechercher"}
          </Button>
        </div>

        {/* Résultats */}
        <div className="mt-4 space-y-2">
          {results.length === 0 ? (
            <div className="text-sm text-slate-500">Aucun résultat pour l’instant.</div>
          ) : (
            results.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between rounded-xl border p-3"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {u.display_name || "(Sans nom)"}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {u.email || "—"} {u.phone ? `• ${u.phone}` : ""}{" "}
                    {u.role ? `• rôle: ${u.role}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => removeTeacher(u.id)}
                    disabled={removingId === u.id}
                    className="rounded-xl bg-red-600 text-white px-3 py-1.5 text-sm font-medium shadow hover:bg-red-700 disabled:opacity-60"
                    title="Retirer le rôle teacher pour cet établissement"
                  >
                    {removingId === u.id ? "Retrait…" : "Retirer"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {rmMsg && (
          <div className="mt-3 text-sm text-slate-600" aria-live="polite">
            {rmMsg}
          </div>
        )}
      </div>
    </div>
  );
}
