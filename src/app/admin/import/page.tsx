"use client";

import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

/* UI helpers */
function Textarea(p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...p}
      className={
        "w-full rounded-lg border px-3 py-2 text-sm font-mono " +
        (p.className ?? "")
      }
    />
  );
}
function Button(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { type = "button", ...rest } = p;
  return (
    <button
      type={type}
      {...rest}
      className={
        "rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm font-medium shadow " +
        (p.disabled ? "opacity-60" : "hover:bg-emerald-700 transition")
      }
    />
  );
}
function SecondaryButton(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { type = "button", ...rest } = p;
  return (
    <button
      type={type}
      {...rest}
      className={
        "rounded-xl border px-4 py-2 text-sm font-medium " +
        (p.disabled ? "opacity-60" : "hover:bg-slate-50 transition")
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

/* Helpers d'affichage */
function boolLabel(v: unknown) {
  if (v === true) return "Oui";
  if (v === false) return "Non";
  return "";
}

/* Types */
type ClassItem = { id: string; name: string; level?: string | null };
type Mode = "students" | "teachers" | "student_photos";
type MatchMode = "auto" | "matricule" | "full_name";

export default function ImportPage() {
  const [mode, setMode] = useState<Mode>("students");

  // classes
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [level, setLevel] = useState<string>("");
  const [classId, setClassId] = useState<string>("");

  const levels = useMemo(
    () =>
      Array.from(new Set(classes.map((c) => c.level).filter(Boolean) as string[])).sort(
        (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })
      ),
    [classes]
  );

  const classesOfLevel = useMemo(
    () => classes.filter((c) => !level || c.level === level),
    [classes, level]
  );

  // csv + preview
  const [csv, setCsv] = useState<string>("");
  const [preview, setPreview] = useState<any[] | null>(null);

  // general state
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [authErr, setAuthErr] = useState(false);

  // file picker csv
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>("");

  // ───────── Photos: state ─────────
  const photoRef = useRef<HTMLInputElement>(null);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreview, setPhotoPreview] = useState<any[] | null>(null);
  const [photoMsg, setPhotoMsg] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [matchMode, setMatchMode] = useState<MatchMode>("auto");

  useEffect(() => {
    void loadClasses();
  }, []);

  async function loadClasses() {
    try {
      const r = await fetch("/api/admin/classes?limit=500", { cache: "no-store" });
      if (r.status === 401) {
        setAuthErr(true);
        return;
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setClasses(j.items || []);
    } catch {
      // silencieux
    }
  }

  // Reset UI bits when changing mode
  useEffect(() => {
    setMsg(null);
    setPreview(null);
    setPhotoMsg(null);
    setPhotoPreview(null);
    setPhotoLoading(false);
    setLoading(false);
  }, [mode]);

  const canPreview =
    mode === "students"
      ? !!csv.trim() && !!classId && !loading
      : mode === "teachers"
      ? !!csv.trim() && !loading
      : false;

  const canImport = canPreview;

  function pickFile() {
    fileRef.current?.click();
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    if (!/\.(csv|txt|tsv)$/i.test(f.name)) {
      setMsg("Format non supporté. Utilisez un fichier .csv, .txt ou .tsv.");
    }
    const text = await f.text();
    setCsv(text);
    setPreview(null);
    setMsg(null);
  }

  function clearCsv() {
    setCsv("");
    setPreview(null);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function parse() {
    if (!canPreview) return;
    setMsg(null);
    setPreview(null);
    setLoading(true);
    try {
      const url =
        mode === "students" ? "/api/admin/students/import" : "/api/admin/teachers/import";
      const body: any = { action: "preview", csv };
      if (mode === "students" && classId) body.class_id = classId;

      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const j = await r.json().catch(() => ({}));

      if (r.status === 401) {
        setAuthErr(true);
        setLoading(false);
        return;
      }
      if (!r.ok) {
        setMsg(j?.error || `HTTP ${r.status}`);
        setLoading(false);
        return;
      }
      setPreview(j.preview || []);
    } catch (e: any) {
      setMsg(e?.message || "Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!canImport) return;
    setMsg(null);
    setLoading(true);
    try {
      const url =
        mode === "students" ? "/api/admin/students/import" : "/api/admin/teachers/import";
      const body: any = { action: "commit", csv };
      if (mode === "students" && classId) body.class_id = classId;

      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const j = await r.json().catch(() => ({}));

      if (r.status === 401) {
        setAuthErr(true);
        setLoading(false);
        return;
      }
      if (!r.ok) {
        setMsg(j?.error || `HTTP ${r.status}`);
        setLoading(false);
        return;
      }

      if (mode === "students") {
        setMsg(
          `Import OK : ${j?.inserted ?? 0} élève(s) | maj identité : ${j?.updated_names ?? 0}`
        );
      } else {
        const created = j?.created ?? 0;
        const updated = j?.updated ?? 0;
        const skipped = j?.skipped_no_phone ?? 0;
        const failed = j?.failed ?? 0;
        const subjectsAdded = j?.subjects_added ?? 0;
        setMsg(
          `Import OK : ${created} créé(s), ${updated} mis à jour, ${subjectsAdded} matière(s), ${skipped} sans téléphone${
            failed ? `, ${failed} échec(s)` : ""
          }`
        );
      }
      setPreview(null);
    } catch (e: any) {
      setMsg(e?.message || "Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  // placeholders
  const phStudents = `N°,Matricule,Nom et prénoms,Sexe,Date de naissance,Lieu de naissance,Nationalité,Régime,Redoublant,Interne,Affecté
1,19659352H,Abia Yapi Christ Brayan,M,12/03/2010,Abidjan,Ivoirienne,Externe,Non,Non,Oui
2,19578655R,Aboy Othniel,M,2010-05-02,Aboisso,Ivoirienne,Externe,Non,Non,Non`;
  const phTeachers = `Nom,Email,Téléphone,Disciplines
M. FABRE,fabre@ecole.ci,+22501020304,Maths; Physique
Mme KONE,kone@ecole.ci,+22505060708,Français`;

  // ───────── Photos helpers ─────────
  function pickPhotos() {
    photoRef.current?.click();
  }

  function clearPhotos() {
    setPhotoFiles([]);
    setPhotoPreview(null);
    setPhotoMsg(null);
    if (photoRef.current) photoRef.current.value = "";
  }

  async function runPhotoPreview(files: File[], mm: MatchMode) {
    if (!files.length) {
      setPhotoPreview(null);
      return;
    }
    setPhotoMsg(null);
    setPhotoLoading(true);
    try {
      const r = await fetch("/api/admin/students/photos/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "preview",
          match_mode: mm,
          filenames: files.map((f) => f.name),
        }),
      });

      if (r.status === 401) {
        setAuthErr(true);
        setPhotoLoading(false);
        return;
      }

      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setPhotoMsg(j?.error || `HTTP ${r.status}`);
        setPhotoLoading(false);
        return;
      }
      setPhotoPreview(j.items || []);
    } catch (e: any) {
      setPhotoMsg(e?.message || "Erreur réseau");
    } finally {
      setPhotoLoading(false);
    }
  }

  async function onPhotosChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    setPhotoFiles(files);
    setPhotoPreview(null);
    setPhotoMsg(null);
    await runPhotoPreview(files, matchMode);
  }

  // ✅ amélioration: si on change le matchMode, on relance la preview automatiquement
  useEffect(() => {
    if (mode !== "student_photos") return;
    if (!photoFiles.length) return;
    void runPhotoPreview(photoFiles, matchMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchMode, mode]);

  async function uploadPhotos() {
    if (!photoFiles.length || photoLoading) return;
    setPhotoMsg(null);
    setPhotoLoading(true);

    try {
      const fd = new FormData();
      fd.set("action", "commit");
      fd.set("match_mode", matchMode);
      for (const f of photoFiles) fd.append("files", f);

      const r = await fetch("/api/admin/students/photos/import", {
        method: "POST",
        body: fd,
      });

      if (r.status === 401) {
        setAuthErr(true);
        setPhotoLoading(false);
        return;
      }

      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setPhotoMsg(j?.error || `HTTP ${r.status}`);
        setPhotoLoading(false);
        return;
      }

      const updated = j?.updated ?? 0;
      const failed = j?.failed ?? 0;
      setPhotoMsg(`Upload terminé : ${updated} photo(s) associée(s) ✅ | ${failed} échec(s)`);

      setPhotoPreview(j?.results || null);
    } catch (e: any) {
      setPhotoMsg(e?.message || "Erreur réseau");
    } finally {
      setPhotoLoading(false);
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Import</h1>
        <p className="text-slate-600">
          Import flexible (élèves / enseignants) + import photos élèves (association automatique).
        </p>
      </div>

      <div className="rounded-2xl border bg-white p-5 space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setMode("students")} disabled={mode === "students"}>
            Élèves
          </Button>
          <Button onClick={() => setMode("teachers")} disabled={mode === "teachers"}>
            Enseignants
          </Button>
          <Button onClick={() => setMode("student_photos")} disabled={mode === "student_photos"}>
            Photos élèves
          </Button>
        </div>

        {mode === "teachers" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
            <b>Téléphone obligatoire</b> pour chaque enseignant (connexion par{" "}
            <i> téléphone + mot de passe</i>). Formats : <code>+22501020304</code>,{" "}
            <code>0022501020304</code>, <code>01020304</code>. Colonnes :{" "}
            <code>Nom</code>, <code>Email</code>, <code>Téléphone</code>, <code>Disciplines</code>.
          </div>
        )}

        {mode === "students" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <div className="mb-1 text-xs text-slate-500">Niveau</div>
              <Select
                value={level}
                onChange={(e) => {
                  setLevel(e.target.value);
                  setClassId("");
                }}
              >
                <option value="">— Tous —</option>
                {levels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <div className="mb-1 text-xs text-slate-500">Classe</div>
              <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
                <option value="">— Choisir —</option>
                {classesOfLevel.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <div className="mt-1 text-[11px] text-slate-500">
                Sélectionne la classe ciblée pour l’inscription.
              </div>
            </div>
          </div>
        )}

        {/* ───────── Mode PHOTOS ───────── */}
        {mode === "student_photos" ? (
          <div className="space-y-3">
            <div className="rounded-lg border bg-slate-50 p-3 text-[13px] text-slate-700">
              <div className="font-semibold mb-1">Règle de nommage des fichiers (IMPORTANT)</div>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  Option 1 (recommandée) : le fichier s’appelle <code>MATRICULE.jpg</code> (ex:{" "}
                  <code>20166309J.jpg</code>)
                </li>
                <li>
                  Option 2 : le fichier s’appelle <code>NOM Prénoms.jpg</code> et doit correspondre à{" "}
                  <code>students.full_name</code> (ex: <code>ANOH Ekloi Acouba.jpg</code>)
                </li>
                <li>
                  L’app peut faire <b>Auto</b> : matricule d’abord, sinon nom complet.
                </li>
              </ul>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <div className="mb-1 text-xs text-slate-500">Association</div>
                <Select value={matchMode} onChange={(e) => setMatchMode(e.target.value as MatchMode)}>
                  <option value="auto">Auto (matricule puis nom complet)</option>
                  <option value="matricule">Matricule uniquement</option>
                  <option value="full_name">Nom complet uniquement</option>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <SecondaryButton onClick={pickPhotos}>Choisir des photos…</SecondaryButton>
              <SecondaryButton onClick={clearPhotos} disabled={!photoFiles.length}>
                Effacer
              </SecondaryButton>

              <Button onClick={uploadPhotos} disabled={!photoFiles.length || photoLoading}>
                {photoLoading ? "…" : "Uploader & associer"}
              </Button>

              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={onPhotosChange}
              />
              {photoFiles.length > 0 && (
                <span className="text-xs text-slate-500">
                  {photoFiles.length} photo(s) sélectionnée(s)
                </span>
              )}
            </div>

            {photoMsg && (
              <div className="text-sm text-slate-600" aria-live="polite">
                {photoMsg}
              </div>
            )}

            {photoPreview && (
              <div className="rounded-xl border bg-white p-4">
                <div className="text-sm font-semibold mb-2">
                  Prévisualisation / Résultats ({photoPreview.length})
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left">Fichier</th>
                        <th className="px-3 py-2 text-left">Clé détectée</th>
                        <th className="px-3 py-2 text-left">Statut</th>
                        <th className="px-3 py-2 text-left">Matricule</th>
                        <th className="px-3 py-2 text-left">Nom complet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {photoPreview.map((r: any, idx: number) => {
                        const ok = !!(r.match_ok ?? r.ok);
                        const student = r.student || null;
                        const status = ok ? "OK" : (r.error || "not_found");
                        return (
                          <tr key={idx} className="border-t">
                            <td className="px-3 py-2">{r.file_name}</td>
                            <td className="px-3 py-2">{r.key_raw ?? ""}</td>
                            <td className="px-3 py-2">
                              <span className={ok ? "text-emerald-700" : "text-rose-700"}>
                                {status}
                              </span>
                            </td>
                            <td className="px-3 py-2">{student?.matricule ?? ""}</td>
                            <td className="px-3 py-2">{student?.full_name ?? ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Zone CSV + barre d’actions fichiers */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <SecondaryButton onClick={pickFile}>Choisir un fichier…</SecondaryButton>
                <SecondaryButton onClick={clearCsv} disabled={!csv.trim() && !fileName}>
                  Effacer
                </SecondaryButton>
                {fileName && (
                  <span className="text-xs text-slate-500">
                    Fichier sélectionné : {fileName}
                  </span>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.txt,.tsv"
                  className="hidden"
                  onChange={onFileChange}
                />
              </div>

              <Textarea
                rows={12}
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                placeholder={mode === "students" ? phStudents : phTeachers}
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={parse} disabled={!canPreview}>
                {loading ? "…" : "Prévisualiser"}
              </Button>
              <Button onClick={save} disabled={!canImport}>
                {loading ? "…" : "Importer"}
              </Button>
            </div>

            {msg && (
              <div className="text-sm text-slate-600" aria-live="polite">
                {msg}
              </div>
            )}
          </>
        )}
      </div>

      {preview && (
        <div className="rounded-xl border bg-white p-4">
          <div className="text-sm font-semibold mb-2">
            Prévisualisation ({preview.length})
          </div>
          <div className="overflow-x-auto">
            {mode === "students" ? (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left">N°</th>
                    <th className="px-3 py-2 text-left">Matricule</th>
                    <th className="px-3 py-2 text-left">Nom</th>
                    <th className="px-3 py-2 text-left">Prénom</th>
                    <th className="px-3 py-2 text-left">Sexe</th>
                    <th className="px-3 py-2 text-left">Date naiss.</th>
                    <th className="px-3 py-2 text-left">Lieu naiss.</th>
                    <th className="px-3 py-2 text-left">Nationalité</th>
                    <th className="px-3 py-2 text-left">Régime</th>
                    <th className="px-3 py-2 text-left">Redoublant</th>
                    <th className="px-3 py-2 text-left">Interne</th>
                    <th className="px-3 py-2 text-left">Affecté</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r: any, idx: number) => (
                    <tr key={idx} className="border-t">
                      <td className="px-3 py-2">{r.numero ?? String(idx + 1)}</td>
                      <td className="px-3 py-2">{r.matricule ?? ""}</td>
                      <td className="px-3 py-2">{r.last_name ?? ""}</td>
                      <td className="px-3 py-2">{r.first_name ?? ""}</td>
                      <td className="px-3 py-2">{r.gender ?? ""}</td>
                      <td className="px-3 py-2">{r.birthdate ?? ""}</td>
                      <td className="px-3 py-2">{r.birth_place ?? ""}</td>
                      <td className="px-3 py-2">{r.nationality ?? ""}</td>
                      <td className="px-3 py-2">{r.regime ?? ""}</td>
                      <td className="px-3 py-2">{boolLabel(r.is_repeater)}</td>
                      <td className="px-3 py-2">{boolLabel(r.is_boarder)}</td>
                      <td className="px-3 py-2">{boolLabel(r.is_affecte)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left">Nom affiché</th>
                    <th className="px-3 py-2 text-left">Email</th>
                    <th className="px-3 py-2 text-left">Téléphone</th>
                    <th className="px-3 py-2 text-left">Disciplines</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r: any, idx: number) => (
                    <tr key={idx} className="border-t">
                      <td className="px-3 py-2">{r.display_name}</td>
                      <td className="px-3 py-2">{r.email ?? ""}</td>
                      <td className="px-3 py-2">{r.phone ?? ""}</td>
                      <td className="px-3 py-2">{(r.subjects || []).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
