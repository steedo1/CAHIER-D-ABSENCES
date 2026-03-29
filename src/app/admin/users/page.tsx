"use client";

import type React from "react";
import { useEffect, useMemo, useState } from "react";

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

function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...p}
      className={
        "w-full rounded-lg border bg-white px-3 py-2 text-sm " +
        (p.className ?? "")
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

function Help({ children }: { children: React.ReactNode }) {
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

type TeacherPayrollRow = {
  profile_id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  employment_type: "vacataire" | "permanent";
  payroll_enabled: boolean;
  notes?: string | null;
};

type AdminUserItem = {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
};

type CreateRole = "teacher" | "educator" | "admin";
type EmploymentType = "vacataire" | "permanent";

function onlyDigits(v: string) {
  return String(v || "").replace(/\D+/g, "");
}

function phoneLooseEqual(
  a: string | null | undefined,
  b: string | null | undefined
) {
  const da = onlyDigits(a || "");
  const db = onlyDigits(b || "");
  if (!da || !db) return false;
  return da === db || da.endsWith(db) || db.endsWith(da);
}

export default function UsersPage() {
  const [authErr, setAuthErr] = useState(false);

  const [createRole, setCreateRole] = useState<CreateRole>("teacher");

  const [tEmail, setTEmail] = useState("");
  const [tPhone, setTPhone] = useState("");
  const [tName, setTName] = useState("");
  const [tSubject, setTSubject] = useState("");
  const [tEmploymentType, setTEmploymentType] =
    useState<EmploymentType>("permanent");
  const [tPayrollEnabled, setTPayrollEnabled] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [subjects, setSubjects] = useState<SubjectItem[]>([]);

  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<AdminUserItem[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [rmMsg, setRmMsg] = useState<string | null>(null);

  const [teachersForAdd, setTeachersForAdd] = useState<TeacherRow[]>([]);
  const [teacherIdForAdd, setTeacherIdForAdd] = useState<string>("");
  const [newSubjectName, setNewSubjectName] = useState("");
  const [addingSubject, setAddingSubject] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);

  const [payrollTeachers, setPayrollTeachers] = useState<TeacherPayrollRow[]>(
    []
  );
  const [loadingPayrollTeachers, setLoadingPayrollTeachers] = useState(false);
  const [payrollTeacherId, setPayrollTeacherId] = useState("");
  const [payrollEmploymentType, setPayrollEmploymentType] =
    useState<EmploymentType>("permanent");
  const [payrollEnabled, setPayrollEnabled] = useState(true);
  const [payrollNotes, setPayrollNotes] = useState("");
  const [savingPayroll, setSavingPayroll] = useState(false);
  const [payrollMsg, setPayrollMsg] = useState<string | null>(null);

  const selectedPayrollTeacher = useMemo(
    () =>
      payrollTeachers.find((t) => t.profile_id === payrollTeacherId) || null,
    [payrollTeachers, payrollTeacherId]
  );

  useEffect(() => {
    void loadSubjects();
    void loadTeachersForAdd();
    void loadPayrollTeachers();
  }, []);

  useEffect(() => {
    if (!selectedPayrollTeacher) return;
    setPayrollEmploymentType(selectedPayrollTeacher.employment_type);
    setPayrollEnabled(!!selectedPayrollTeacher.payroll_enabled);
    setPayrollNotes(selectedPayrollTeacher.notes || "");
  }, [selectedPayrollTeacher]);

  async function loadSubjects() {
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
  }

  async function loadTeachersForAdd() {
    const r = await fetch("/api/admin/teachers/by-subject", {
      cache: "no-store",
    });
    if (r.status === 401) {
      setAuthErr(true);
      return;
    }
    const j = await r.json().catch(() => ({}));
    setTeachersForAdd(j.items || []);
  }

  async function loadPayrollTeachers(query?: string) {
    setLoadingPayrollTeachers(true);
    try {
      const qs = query?.trim()
        ? `?q=${encodeURIComponent(query.trim())}`
        : "";
      const r = await fetch(`/api/admin/teachers/payroll-profile${qs}`, {
        cache: "no-store",
      });
      if (r.status === 401) {
        setAuthErr(true);
        setLoadingPayrollTeachers(false);
        return [] as TeacherPayrollRow[];
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setPayrollMsg(j?.error || "Impossible de charger les fiches de paie.");
        setPayrollTeachers([]);
        setLoadingPayrollTeachers(false);
        return [] as TeacherPayrollRow[];
      }
      const items = (j.items || []) as TeacherPayrollRow[];
      setPayrollTeachers(items);
      return items;
    } catch (e: any) {
      setPayrollMsg(
        e?.message || "Erreur de chargement des fiches de paie."
      );
      setPayrollTeachers([]);
      return [] as TeacherPayrollRow[];
    } finally {
      setLoadingPayrollTeachers(false);
    }
  }

  async function upsertPayrollProfile(
    profileId: string,
    employmentType: EmploymentType,
    enabled: boolean,
    notes?: string
  ) {
    const r = await fetch("/api/admin/teachers/payroll-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile_id: profileId,
        employment_type: employmentType,
        payroll_enabled: enabled,
        notes: notes?.trim() || null,
      }),
    });

    const j = await r.json().catch(() => ({}));

    if (r.status === 401) {
      setAuthErr(true);
      return { ok: false as const, error: "unauthorized" as const };
    }

    if (!r.ok) {
      return {
        ok: false as const,
        error:
          (j?.error as string) ||
          "Échec de la mise à jour de la fiche de paie.",
      };
    }

    return { ok: true as const, data: j };
  }

  async function applyPayrollProfileAfterCreate(opts: {
    phone: string;
    displayName: string;
    employmentType: EmploymentType;
    payrollEnabled: boolean;
  }) {
    const rows = await loadPayrollTeachers(opts.phone);
    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        ok: false as const,
        message: "Compte créé, mais fiche de paie à vérifier manuellement.",
      };
    }

    const exactPhone = rows.find((r) => phoneLooseEqual(r.phone, opts.phone));
    const exactName =
      !exactPhone && opts.displayName.trim()
        ? rows.find(
            (r) =>
              (r.display_name || "").trim().toLowerCase() ===
              opts.displayName.trim().toLowerCase()
          )
        : null;

    const target = exactPhone || exactName || rows[0];
    if (!target?.profile_id) {
      return {
        ok: false as const,
        message: "Compte créé, mais fiche de paie à vérifier manuellement.",
      };
    }

    const up = await upsertPayrollProfile(
      target.profile_id,
      opts.employmentType,
      opts.payrollEnabled
    );

    if (!up.ok) {
      return {
        ok: false as const,
        message: "Compte créé, mais fiche de paie à vérifier manuellement.",
      };
    }

    await loadPayrollTeachers();
    return {
      ok: true as const,
      message: "Compte enseignant créé et fiche de paie initialisée.",
    };
  }

  async function createUser() {
    setSubmitting(true);
    setMsg(null);

    const rawRole = createRole;
    const rawPhone = tPhone.trim();
    const rawName = tName.trim();
    const rawEmploymentType = tEmploymentType;
    const rawPayrollEnabled = tPayrollEnabled;

    try {
      const r = await fetch("/api/admin/users/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: rawRole,
          email: tEmail.trim() || null,
          phone: rawPhone,
          display_name: rawName || null,
          subject: rawRole === "teacher" ? tSubject.trim() || null : null,
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

      if (rawRole === "teacher") {
        const payrollResult = await applyPayrollProfileAfterCreate({
          phone: rawPhone,
          displayName: rawName,
          employmentType: rawEmploymentType,
          payrollEnabled: rawPayrollEnabled,
        });
        setMsg(payrollResult.message);
      } else {
        let labelRole = "utilisateur";
        if (rawRole === "educator") labelRole = "éducateur";
        if (rawRole === "admin") labelRole = "admin";
        setMsg(`Compte ${labelRole} créé.`);
      }

      setTEmail("");
      setTPhone("");
      setTName("");
      setTSubject("");
      setTEmploymentType("permanent");
      setTPayrollEnabled(true);

      try {
        await loadSubjects();
      } catch {}

      try {
        await loadTeachersForAdd();
      } catch {}

      try {
        await loadPayrollTeachers();
      } catch {}
    } catch {
      setSubmitting(false);
      setMsg("Erreur réseau.");
    }
  }

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
          unset_profile_institution: true,
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
      const ended = j?.ended_sessions
        ? ` — ${j.ended_sessions} séance(s) clôturée(s)`
        : "";
      const cleared = j?.cleared_institution
        ? " — institution active nettoyée"
        : "";
      setRmMsg(`Enseignant retiré de l’établissement${ended}${cleared}.`);
      setResults((prev) => prev.filter((u) => u.id !== profile_id));

      try {
        await loadTeachersForAdd();
      } catch {}

      try {
        await loadPayrollTeachers();
      } catch {}
    } catch (e: any) {
      setRmMsg(e?.message || "Erreur réseau.");
    } finally {
      setRemovingId(null);
    }
  }

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

      try {
        await loadSubjects();
      } catch {}

      setAddMsg("Discipline ajoutée à l’enseignant.");
      setNewSubjectName("");
    } catch (e: any) {
      setAddingSubject(false);
      setAddMsg(e?.message || "Erreur réseau.");
    }
  }

  async function savePayrollProfile() {
    if (!payrollTeacherId) return;
    setSavingPayroll(true);
    setPayrollMsg(null);

    const up = await upsertPayrollProfile(
      payrollTeacherId,
      payrollEmploymentType,
      payrollEnabled,
      payrollNotes
    );

    if (!up.ok) {
      setSavingPayroll(false);
      if (up.error !== "unauthorized") {
        setPayrollMsg(up.error || "Échec de la mise à jour de la fiche de paie.");
      }
      return;
    }

    await loadPayrollTeachers();
    setPayrollMsg("Fiche de paie enseignant mise à jour.");
    setSavingPayroll(false);
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
          <b>admins d’établissement</b>. Pour les enseignants, on peut aussi
          gérer la <b>fiche de paie</b> avec le type <b>vacataire</b> ou{" "}
          <b>permanent</b>.
        </p>
      </div>

      <div className="rounded-2xl border bg-white p-5">
        <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Créer un compte ({currentRoleLabel})
        </div>
        <Help>
          Téléphone <b>obligatoire</b>. Email <b>facultatif</b>. La discipline
          et la fiche de paie ne concernent que les <b>enseignants</b>.
        </Help>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs text-slate-500">Rôle du compte</div>
            <Select
              value={createRole}
              onChange={(e) => setCreateRole(e.target.value as CreateRole)}
            >
              <option value="teacher">Enseignant</option>
              <option value="educator">Éducateur</option>
              <option value="admin">Admin d’établissement</option>
            </Select>
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
            <>
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
                  Tu peux saisir une nouvelle discipline ou choisir une
                  existante.
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs text-slate-500">
                  Type d’enseignant
                </div>
                <Select
                  value={tEmploymentType}
                  onChange={(e) =>
                    setTEmploymentType(e.target.value as EmploymentType)
                  }
                >
                  <option value="permanent">Permanent</option>
                  <option value="vacataire">Vacataire</option>
                </Select>
              </div>

              <div className="md:col-span-2">
                <label className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={tPayrollEnabled}
                    onChange={(e) => setTPayrollEnabled(e.target.checked)}
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">
                      Inclure cet enseignant dans la paie
                    </span>
                    <span className="block text-xs text-slate-600">
                      Décoche si l’enseignant ne doit pas apparaître dans les
                      calculs de paie.
                    </span>
                  </span>
                </label>
              </div>
            </>
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

      <div className="rounded-2xl border bg-white p-5">
        <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Ajouter une discipline à un enseignant
        </div>
        <Help>
          Permet d’associer <b>plusieurs matières</b> au <b>même enseignant</b>.
        </Help>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="md:col-span-1">
            <div className="mb-1 text-xs text-slate-500">Enseignant</div>
            <Select
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
            </Select>
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
              disabled={
                addingSubject || !teacherIdForAdd || !newSubjectName.trim()
              }
              title={
                !teacherIdForAdd
                  ? "Choisissez d’abord un enseignant"
                  : "Ajouter la discipline"
              }
            >
              {addingSubject ? "Ajout…" : "Ajouter la discipline"}
            </Button>
          </div>
        </div>

        {addMsg && <div className="mt-2 text-sm text-emerald-700">{addMsg}</div>}
      </div>

      <div className="rounded-2xl border bg-white p-5">
        <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Mettre à jour la fiche de paie d’un enseignant
        </div>
        <Help>
          Permet de corriger les enseignants déjà en base : <b>vacataire</b> ou{" "}
          <b>permanent</b>, et inclusion ou non dans la paie.
        </Help>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs text-slate-500">Enseignant</div>
            <Select
              value={payrollTeacherId}
              onChange={(e) => setPayrollTeacherId(e.target.value)}
            >
              <option value="">— Choisir un enseignant —</option>
              {payrollTeachers.map((t) => (
                <option key={t.profile_id} value={t.profile_id}>
                  {t.display_name || "(Sans nom)"}{" "}
                  {t.phone ? `— ${t.phone}` : t.email ? `— ${t.email}` : ""}
                </option>
              ))}
            </Select>
            {loadingPayrollTeachers ? (
              <div className="mt-1 text-xs text-slate-500">Chargement…</div>
            ) : null}
          </div>

          <div>
            <div className="mb-1 text-xs text-slate-500">
              Type d’enseignant
            </div>
            <Select
              value={payrollEmploymentType}
              onChange={(e) =>
                setPayrollEmploymentType(e.target.value as EmploymentType)
              }
              disabled={!payrollTeacherId}
            >
              <option value="permanent">Permanent</option>
              <option value="vacataire">Vacataire</option>
            </Select>
          </div>

          <div className="md:col-span-2">
            <label className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
              <input
                type="checkbox"
                checked={payrollEnabled}
                onChange={(e) => setPayrollEnabled(e.target.checked)}
                disabled={!payrollTeacherId}
                className="mt-1 h-4 w-4"
              />
              <span>
                <span className="block text-sm font-semibold text-slate-900">
                  Paie active
                </span>
                <span className="block text-xs text-slate-600">
                  Si décoché, l’enseignant ne remonte pas dans les calculs de
                  paie.
                </span>
              </span>
            </label>
          </div>

          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Notes</div>
            <Input
              value={payrollNotes}
              onChange={(e) => setPayrollNotes(e.target.value)}
              placeholder="Ex. Vacataire payé à la séance"
              disabled={!payrollTeacherId}
            />
          </div>
        </div>

        {selectedPayrollTeacher ? (
          <div className="mt-3 rounded-xl border bg-slate-50 p-3 text-sm text-slate-700">
            <div className="font-medium text-slate-900">
              {selectedPayrollTeacher.display_name || "(Sans nom)"}
            </div>
            <div className="text-xs text-slate-500">
              {selectedPayrollTeacher.phone ||
                selectedPayrollTeacher.email ||
                "—"}
            </div>
            <div className="mt-2 text-xs text-slate-600">
              Actuel :{" "}
              <b>
                {selectedPayrollTeacher.employment_type === "vacataire"
                  ? "Vacataire"
                  : "Permanent"}
              </b>{" "}
              —{" "}
              {selectedPayrollTeacher.payroll_enabled
                ? "Paie active"
                : "Paie inactive"}
            </div>
          </div>
        ) : null}

        <div className="mt-4">
          <Button
            onClick={savePayrollProfile}
            disabled={savingPayroll || !payrollTeacherId}
          >
            {savingPayroll ? "Mise à jour…" : "Mettre à jour la fiche de paie"}
          </Button>
        </div>

        {payrollMsg && (
          <div className="mt-2 text-sm text-slate-600" aria-live="polite">
            {payrollMsg}
          </div>
        )}
      </div>

      <div className="rounded-2xl border bg-white p-5">
        <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Retirer un enseignant de l’établissement
        </div>
        <Help>
          Recherche par <b>nom</b>, <b>email</b> ou <b>téléphone</b>, puis clique
          sur <b>Retirer</b>.
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

        <div className="mt-4 space-y-2">
          {results.length === 0 ? (
            <div className="text-sm text-slate-500">
              Aucun résultat pour l’instant.
            </div>
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