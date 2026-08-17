"use client";

import { warmOfflineShell } from "@/lib/offline";
import { getOfflineAccessIntent } from "@/lib/offline-auth-client";
import { prepareOffline, type OfflineReadiness } from "@/lib/offline-readiness";
import "@/lib/admin-essential-fetch";

type AdminClass = {
  id?: string | null;
  academic_year?: string | null;
};

type AdminClassesPayload = {
  items?: AdminClass[];
};

export type AdminEssentialPreparationResult = {
  readiness: OfflineReadiness;
  class_count: number;
  roster_count: number;
  prepared_at: string;
};

function itemsOf<T>(payload: any): T[] {
  if (Array.isArray(payload)) return payload as T[];
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function jsonGet<T = any>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      String(payload?.error || payload?.message || `HTTP_${response.status}`),
    );
  }
  return payload as T;
}

async function mapLimit<T>(
  values: T[],
  limit: number,
  callback: (value: T, index: number) => Promise<void>,
) {
  if (!values.length) return;
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor++;
        await callback(values[index]!, index);
      }
    },
  );
  await Promise.all(workers);
}

async function optional(task: () => Promise<unknown>) {
  try {
    await task();
  } catch {
    // Une projection facultative ne doit pas invalider le paquet principal.
  }
}

function activeStudentsUrl(classId: string) {
  const id = encodeURIComponent(classId);
  return `/api/admin/students?class_id=${id}&page=1&page_size=5000&pageSize=5000&limit=5000&per_page=5000`;
}

function rosterUrl(classId: string, academicYear?: string | null) {
  const base = `/api/admin/classes/${encodeURIComponent(classId)}/roster`;
  const year = String(academicYear || "").trim();
  return year ? `${base}?academic_year=${encodeURIComponent(year)}` : base;
}

/**
 * Prépare sans interaction utilisateur les quatre fonctions Admin essentielles.
 *
 * Règle produit : ouvrir préalablement Listes/Bulletins/Conseil ne doit jamais
 * être une condition du mode hors ligne. Les lectures sont donc exécutées ici
 * pendant que le Cloud existe, puis le pont admin-essential-fetch les restitue
 * en cas de panne réseau. Les réponses officielles Bulletin/Conduite restent
 * produites par les API Cloud : aucune formule métier n'est dupliquée côté Web.
 */
export async function prepareAdminEssentialOffline(
  onProgress: (message: string) => void = () => undefined,
): Promise<AdminEssentialPreparationResult> {
  const active = await getOfflineAccessIntent().catch(() => null);
  if (!active || active.payload.role !== "admin") {
    throw new Error("admin_offline_grant_required");
  }

  onProgress("Préparation des listes administratives…");
  const [classesPayload] = await Promise.all([
    jsonGet<AdminClassesPayload>("/api/admin/classes?limit=999"),
    // Le conseil de classe utilise cette URL sans limite ; on prépare aussi sa
    // clé exacte pour que son code actuel puisse fonctionner sans modification.
    jsonGet<AdminClassesPayload>("/api/admin/classes"),
    jsonGet("/api/admin/students"),
    jsonGet("/api/admin/institution/settings"),
    jsonGet("/api/admin/institution/academic-years"),
    optional(() => jsonGet("/api/admin/affectations/current")),
  ]);

  const classes = itemsOf<AdminClass>(classesPayload).filter((item) =>
    Boolean(String(item?.id || "").trim()),
  );

  let rosterCount = 0;
  onProgress(`Préparation de ${classes.length} liste(s) de classe…`);
  await mapLimit(classes, 4, async (classRow, index) => {
    const classId = String(classRow.id || "").trim();
    if (!classId) return;
    if (index === 0 || (index + 1) % 5 === 0 || index + 1 === classes.length) {
      onProgress(`Listes de classe ${index + 1}/${classes.length}…`);
    }

    await jsonGet(rosterUrl(classId));
    rosterCount += 1;

    const academicYear = String(classRow.academic_year || "").trim();
    if (academicYear) {
      await optional(() => jsonGet(rosterUrl(classId, academicYear)));
    }

    // Le conseil commence par cette variante pour filtrer les élèves encore
    // inscrits. La préparer suffit à éviter ses deux fallbacks Cloud suivants.
    await optional(() => jsonGet(activeStudentsUrl(classId)));
  });

  onProgress("Préparation des écrans essentiels…");
  await warmOfflineShell([
    "/admin/absences/appels-matrice",
    "/admin/parents",
    "/admin/bulletins",
    "/admin/notes/conseil-classe",
  ]);

  // Les listes imprimables sont dynamiques. Une panne sur une classe ne doit
  // pas empêcher la consultation des trois autres fonctions essentielles.
  await mapLimit(classes, 3, async (classRow) => {
    const classId = String(classRow.id || "").trim();
    if (!classId) return;
    await optional(() =>
      warmOfflineShell([`/admin/classes/liste/${encodeURIComponent(classId)}`]),
    );
  });

  onProgress("Préparation des bulletins et du conseil de classe…");
  // prepareOffline('admin') sait déjà parcourir toutes les classes et toutes les
  // périodes, puis préparer Bulletin + Conduite. Comme le pont de lecture est
  // installé avant cet appel, ces mêmes réponses alimentent aussi le secours du
  // Conseil de classe sans double calcul métier.
  const readiness = await prepareOffline("admin", onProgress);

  return {
    readiness,
    class_count: classes.length,
    roster_count: rosterCount,
    prepared_at: new Date().toISOString(),
  };
}
