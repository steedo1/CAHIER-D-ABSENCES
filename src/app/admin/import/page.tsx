"use client";

import type React from "react";
import readXlsxFile from "read-excel-file/browser";
import { useEffect, useMemo, useRef, useState } from "react";

/* =========================
   UI helpers
========================= */

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
        "rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow " +
        (p.disabled ? "opacity-60" : "transition hover:bg-emerald-700")
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
        (p.disabled ? "opacity-60" : "transition hover:bg-slate-50")
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

function boolLabel(v: unknown) {
  if (v === true) return "Oui";
  if (v === false) return "Non";
  return "";
}

/* =========================
   Types
========================= */

type ClassItem = { id: string; name: string; level?: string | null };
type Mode = "students" | "teachers" | "student_photos";
type MatchMode = "auto" | "matricule" | "full_name";

type ParsedFileResult = {
  text: string;
  normalizedFileName: string;
  detectedType: "csv" | "tsv" | "txt" | "xlsx";
};

/* =========================
   Fichiers / XLSX helpers
========================= */

function getExt(name: string) {
  const m = String(name || "")
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/i);
  return m?.[1] ?? "";
}

async function readTextFile(file: File) {
  return await file.text();
}

function formatDateYmd(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeExcelCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateYmd(value);
  }
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  return String(value);
}

function escapeCsvCell(value: unknown): string {
  const s = normalizeExcelCell(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToCsv(rows: unknown[][]): string {
  return rows
    .map((row) => (row || []).map((cell) => escapeCsvCell(cell)).join(","))
    .join("\n");
}

async function readSpreadsheetAsCsv(file: File): Promise<string> {
  const rows = await readXlsxFile(file);

  if (!rows || rows.length === 0) {
    throw new Error("Le fichier Excel est vide.");
  }

  const csv = rowsToCsv(rows as unknown[][]);

  if (!csv.trim()) {
    throw new Error("Le fichier Excel ne contient aucune donnée exploitable.");
  }

  return csv;
}

async function parseImportFile(file: File): Promise<ParsedFileResult> {
  const ext = getExt(file.name);

  if (ext === "csv") {
    return {
      text: await readTextFile(file),
      normalizedFileName: file.name,
      detectedType: "csv",
    };
  }

  if (ext === "txt") {
    return {
      text: await readTextFile(file),
      normalizedFileName: file.name,
      detectedType: "txt",
    };
  }

  if (ext === "tsv") {
    return {
      text: await readTextFile(file),
      normalizedFileName: file.name,
      detectedType: "tsv",
    };
  }

  if (ext === "xlsx") {
    return {
      text: await readSpreadsheetAsCsv(file),
      normalizedFileName: file.name,
      detectedType: "xlsx",
    };
  }

  if (ext === "xls") {
    throw new Error(
      "Le format .xls ancien n’est pas supporté. Enregistre le fichier en .xlsx ou .csv puis réessaie."
    );
  }

  throw new Error(
    "Format non supporté. Utilise un fichier .csv, .txt, .tsv ou .xlsx."
  );
}

/* =========================
   Page
========================= */

export default function ImportPage() {
  const [mode, setMode] = useState<Mode>("students");

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [level, setLevel] = useState<string>("");
  const [classId, setClassId] = useState<string>("");

  const levels = useMemo(
    () =>
      Array.from(
        new Set(classes.map((c) => c.level).filter(Boolean) as string[])
      ).sort((a, b) =>
        String(a).localeCompare(String(b), undefined, { numeric: true })
      ),
    [classes]
  );

  const classesOfLevel = useMemo(
    () => classes.filter((c) => !level || c.level === level),
    [classes, level]
  );

  const [csv, setCsv] = useState<string>("");
  const [preview, setPreview] = useState<any[] | null>(null);

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [authErr, setAuthErr] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>("");
  const [fileTypeLabel, setFileTypeLabel] = useState<string>("");

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
      const r = await fetch("/api/admin/classes?limit=500", {
        cache: "no-store",
      });
      if (r.status === 401) {
        setAuthErr(true);
        return;
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setClasses(j.items || []);
    } catch {
      // no-op
    }
  }

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

    setLoading(true);
    setMsg(null);
    setPreview(null);

    try {
      const parsed = await parseImportFile(f);
      setFileName(parsed.normalizedFileName);
      setFileTypeLabel(parsed.detectedType.toUpperCase());
      setCsv(parsed.text);

      if (parsed.detectedType === "xlsx") {
        setMsg(
          "Fichier Excel chargé avec succès. Le fichier a été converti automatiquement pour l’import."
        );
      }
    } catch (e: any) {
      setCsv("");
      setFileName(f.name);
      setFileTypeLabel("");
      setMsg(e?.message || "Impossible de lire ce fichier.");
    } finally {
      setLoading(false);
    }
  }

  function clearCsv() {
    setCsv("");
    setPreview(null);
    setFileName("");
    setFileTypeLabel("");
    setMsg(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function parse() {
    if (!canPreview) return;
    setMsg(null);
    setPreview(null);
    setLoading(true);

    try {
      const url =
        mode === "students"
          ? "/api/admin/students/import"
          : "/api/admin/teachers/import";

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
        mode === "students"
          ? "/api/admin/students/import"
          : "/api/admin/teachers/import";

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
        const inserted = j?.inserted ?? 0;
        const updated = j?.updated ?? 0;
        const updatedByName = j?.updated_by_name ?? 0;
        const ambiguous = j?.ambiguous_name ?? 0;
        const closedOld = j?.closed_old_enrollments ?? 0;
        const reactivated = j?.reactivated_in_target ?? 0;
        const insertedInTarget = j?.inserted_in_target ?? 0;

        setMsg(
          `Import OK : ${inserted} élève(s) créé(s), ${updated} mise(s) à jour par matricule, ${updatedByName} mise(s) à jour par nom, ${insertedInTarget} inscription(s) ajoutée(s), ${reactivated} réactivée(s), ${closedOld} ancienne(s) clôturée(s)${
            ambiguous ? `, ${ambiguous} nom(s) ambigu(s)` : ""
          }.`
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
          }.`
        );
      }

      setPreview(null);
    } catch (e: any) {
      setMsg(e?.message || "Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  const phStudents = `N°,Matricule,Nom et prénoms,Sexe,Date de naissance,Lieu de naissance,Nationalité,Régime,Redoublant,Interne,Affecté
1,19659352H,Abia Yapi Christ Brayan,M,12/03/2010,Abidjan,Ivoirienne,Externe,Non,Non,Oui
2,19578655R,Aboy Othniel,M,2010-05-02,Aboisso,Ivoirienne,Externe,Non,Non,Non`;

  const phTeachers = `Nom,Email,Téléphone,Disciplines
M. FABRE,fabre@ecole.ci,+22501020304,Maths; Physique
Mme KONE,kone@ecole.ci,+22505060708,Français`;

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
      setPhotoMsg(
        `Upload terminé : ${updated} photo(s) associée(s) ✅ | ${failed} échec(s)`
      );

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
          Import flexible (élèves / enseignants) + import photos élèves
          (association automatique).
        </p>
      </div>

      <div className="space-y-3 rounded-2xl border bg-white p-5">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setMode("students")} disabled={mode === "students"}>
            Élèves
          </Button>
          <Button onClick={() => setMode("teachers")} disabled={mode === "teachers"}>
            Enseignants
          </Button>
          <Button
            onClick={() => setMode("student_photos")}
            disabled={mode === "student_photos"}
          >
            Photos élèves
          </Button>
        </div>

        {mode === "teachers" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
            <b>Téléphone obligatoire</b> pour chaque enseignant.
            <br />
            Formats : <code>+22501020304</code>, <code>0022501020304</code>,{" "}
            <code>01020304</code>.
            <br />
            Colonnes : <code>Nom</code>, <code>Email</code>, <code>Téléphone</code>,{" "}
            <code>Disciplines</code>.
            <br />
            <span className="font-medium">
              Conseil :
            </span>{" "}
            dans Excel, mets la colonne téléphone au format <b>Texte</b> pour éviter la
            perte d’un zéro initial.
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

        {mode === "student_photos" ? (
          <div className="space-y-3">
            <div className="rounded-lg border bg-slate-50 p-3 text-[13px] text-slate-700">
              <div className="mb-1 font-semibold">
                Règle de nommage des fichiers
              </div>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  Recommandé : <code>MATRICULE.jpg</code> — ex :{" "}
                  <code>20166309J.jpg</code>
                </li>
                <li>
                  Ou : <code>NOM Prénoms.jpg</code> — ex :{" "}
                  <code>ANOH Ekloi Acouba.jpg</code>
                </li>
                <li>
                  Le mode <b>Auto</b> essaie matricule puis nom complet.
                </li>
              </ul>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <div className="mb-1 text-xs text-slate-500">Association</div>
                <Select
                  value={matchMode}
                  onChange={(e) => setMatchMode(e.target.value as MatchMode)}
                >
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
                <div className="mb-2 text-sm font-semibold">
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
                        const status = ok ? "OK" : r.error || "not_found";

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
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px] text-slate-700">
              Formats acceptés : <code>.csv</code>, <code>.txt</code>, <code>.tsv</code>,{" "}
              <code>.xlsx</code>.
              <br />
              Les anciens fichiers <code>.xls</code> doivent être réenregistrés en{" "}
              <code>.xlsx</code> ou <code>.csv</code>.
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <SecondaryButton onClick={pickFile}>Choisir un fichier…</SecondaryButton>
                <SecondaryButton onClick={clearCsv} disabled={!csv.trim() && !fileName}>
                  Effacer
                </SecondaryButton>

                {fileName && (
                  <span className="text-xs text-slate-500">
                    Fichier sélectionné : {fileName}
                    {fileTypeLabel ? ` (${fileTypeLabel})` : ""}
                  </span>
                )}

                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.txt,.tsv,.xlsx"
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
          <div className="mb-2 text-sm font-semibold">
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