"use client";

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
type ClassItem = { id: string; name: string; level: string };

export default function ImportPage() {
  const [mode, setMode] = useState<"students" | "teachers">("students");

  // classes
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [level, setLevel] = useState<string>("");
  const [classId, setClassId] = useState<string>("");

  const levels = useMemo(
    () =>
      Array.from(
        new Set(classes.map((c) => c.level).filter(Boolean))
      ).sort((a, b) =>
        String(a).localeCompare(String(b), undefined, { numeric: true })
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
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [authErr, setAuthErr] = useState(false);

  // file picker
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>("");

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
      // silencieux
    }
  }

  const canPreview =
    !!csv.trim() && (mode !== "students" || !!classId) && !loading;
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
        const text = j?.error || `HTTP ${r.status}`;
        setMsg(text);
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
        const text = j?.error || `HTTP ${r.status}`;
        setMsg(text);
        setLoading(false);
        return;
      }

      if (mode === "students") {
        setMsg(`Import OK : ${j?.inserted ?? 0} élèves`);
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
  const phStudents = `N°,Matricule,Nom et prénoms
1,19659352H,Abia Yapi Christ Brayan
2,19578655R,Aboy Othniel`;
  const phTeachers = `Nom,Email,Téléphone,Disciplines
M. FABRE,fabre@ecole.ci,+22501020304,Maths; Physique
Mme KONE,kone@ecole.ci,+22505060708,Français`;

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
          Import flexible (détection automatique des colonnes).
        </p>
      </div>

      <div className="rounded-2xl border bg-white p-5 space-y-3">
        <div className="flex gap-2">
          <Button
            onClick={() => setMode("students")}
            disabled={mode === "students"}
          >
            Élèves
          </Button>
          <Button
            onClick={() => setMode("teachers")}
            disabled={mode === "teachers"}
          >
            Enseignants
          </Button>
        </div>

        {mode === "teachers" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
            <b>Téléphone obligatoire</b> pour chaque enseignant (connexion par
            <i> téléphone + mot de passe</i>). Formats :{" "}
            <code>+22501020304</code>, <code>0022501020304</code>,{" "}
            <code>01020304</code>. Colonnes : <code>Nom</code>,{" "}
            <code>Email</code>, <code>Téléphone</code>,{" "}
            <code>Disciplines</code>.
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
              <Select
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
              >
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

        {/* Zone CSV + barre d’actions fichiers */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <SecondaryButton onClick={pickFile}>
              Choisir un fichier…
            </SecondaryButton>
            <SecondaryButton
              onClick={clearCsv}
              disabled={!csv.trim() && !fileName}
            >
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
                      {/* Fallback : si la colonne N° est absente/vide, on affiche idx+1 */}
                      <td className="px-3 py-2">
                        {r.numero ?? String(idx + 1)}
                      </td>
                      <td className="px-3 py-2">{r.matricule ?? ""}</td>
                      <td className="px-3 py-2">{r.last_name ?? ""}</td>
                      <td className="px-3 py-2">{r.first_name ?? ""}</td>
                      <td className="px-3 py-2">{r.gender ?? ""}</td>
                      <td className="px-3 py-2">{r.birthdate ?? ""}</td>
                      <td className="px-3 py-2">{r.birth_place ?? ""}</td>
                      <td className="px-3 py-2">{r.nationality ?? ""}</td>
                      <td className="px-3 py-2">{r.regime ?? ""}</td>
                      <td className="px-3 py-2">
                        {boolLabel(r.is_repeater)}
                      </td>
                      <td className="px-3 py-2">
                        {boolLabel(r.is_boarder)}
                      </td>
                      <td className="px-3 py-2">
                        {boolLabel(r.is_affecte)}
                      </td>
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
                      <td className="px-3 py-2">
                        {(r.subjects || []).join(", ")}
                      </td>
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
