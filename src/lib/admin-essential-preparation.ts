"use client";

import { cacheGet, cacheSet, warmOfflineShell } from "@/lib/offline";
import { prepareOffline, type OfflineReadiness } from "@/lib/offline-readiness";
import {
  cacheAdminEssentialJson,
  rememberAdminEssentialScope,
} from "@/lib/admin-essential-fetch";
import {
  ADMIN_ESSENTIAL_PREPARATION_VERSION,
  adminEssentialPreparationKey,
  type AdminEssentialPreparationMarker,
} from "@/lib/admin-essential-contract";
import {
  adminBulletinConductKey,
  adminBulletinDataKey,
  adminBulletinPeriodsKey,
} from "@/lib/offline-bulletins";

type AdminClass = {
  id?: string | null;
  academic_year?: string | null;
};

type AdminClassesPayload = {
  items?: AdminClass[];
};

type AdminPeriod = {
  id?: string | null;
  academic_year?: string | null;
  code?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

export type AdminEssentialPreparationResult = {
  readiness: OfflineReadiness;
  class_count: number;
  roster_count: number;
  prepared_at: string;
};

const ADMIN_ESSENTIAL_STATIC_PATHS = [
  "/admin/absences/appels-matrice",
  "/admin/parents",
  "/admin/bulletins",
  "/admin/notes/conseil-classe",
] as const;

function itemsOf<T>(payload: any): T[] {
  if (Array.isArray(payload)) return payload as T[];
  return Array.isArray(payload?.items) ? payload.items : [];
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
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

async function optional<T>(task: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await task();
  } catch {
    return fallback;
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

function bulletinParams(classRow: AdminClass, period: AdminPeriod) {
  const params = new URLSearchParams({
    class_id: String(classRow.id || "").trim(),
    from: String(period.start_date || "").trim(),
    to: String(period.end_date || "").trim(),
  });
  const academicYear = String(
    period.academic_year || classRow.academic_year || "",
  ).trim();
  const periodCode = String(period.code || "").trim();
  if (academicYear) params.set("academic_year", academicYear);
  if (periodCode) params.set("period_code", periodCode);
  return params;
}

async function publishCouncilAliases(classes: AdminClass[]) {
  const academicYears = unique(classes.map((item) => item.academic_year));
  const years: Array<string | null> = academicYears.length ? academicYears : [null];
  const periods: AdminPeriod[] = [];

  for (const year of years) {
    const cached = await cacheGet<any>(adminBulletinPeriodsKey(year)).catch(() => null);
    periods.push(...itemsOf<AdminPeriod>(cached));
  }

  const periodMap = new Map<string, AdminPeriod>();
  for (const period of periods) {
    const from = String(period.start_date || "").trim();
    const to = String(period.end_date || "").trim();
    if (!from || !to) continue;
    periodMap.set(
      `${period.academic_year || ""}|${period.code || ""}|${from}|${to}`,
      period,
    );
  }
  const uniquePeriods = Array.from(periodMap.values());
  const tasks = classes.flatMap((classRow) =>
    uniquePeriods
      .filter(
        (period) =>
          !classRow.academic_year ||
          !period.academic_year ||
          classRow.academic_year === period.academic_year,
      )
      .map((period) => ({ classRow, period })),
  );

  await mapLimit(tasks, 4, async ({ classRow, period }) => {
    const preparedParams = bulletinParams(classRow, period);
    const bulletin = await cacheGet<any>(adminBulletinDataKey(preparedParams)).catch(
      () => null,
    );
    const conduct = await cacheGet<any>(
      adminBulletinConductKey(preparedParams),
    ).catch(() => null);
    if (!bulletin) throw new Error("admin_council_bulletin_not_prepared");
    if (!conduct) throw new Error("admin_council_conduct_not_prepared");

    // Le Conseil ajoute ces deux paramètres, mais l'API Bulletin applique déjà
    // active_only=true par défaut et ne lit que les évaluations publiées. On
    // publie donc le même snapshot officiel sous l'URL exacte du Conseil.
    const councilParams = new URLSearchParams(preparedParams);
    councilParams.set("published", "true");
    councilParams.set("active_only", "true");
    await Promise.all([
      cacheAdminEssentialJson(
        `/api/admin/grades/bulletin?${councilParams.toString()}`,
        bulletin,
      ),
      cacheAdminEssentialJson(
        `/api/admin/conduite/averages?${councilParams.toString()}`,
        conduct,
      ),
    ]);

    // Le récapitulatif annuel actuel du Conseil omet academic_year/period_code.
    // Même contenu, autre URL : on crée un alias local, sans requête Cloud.
    const annualParams = new URLSearchParams({
      class_id: String(classRow.id || "").trim(),
      from: String(period.start_date || "").trim(),
      to: String(period.end_date || "").trim(),
      published: "true",
      active_only: "true",
    });
    await cacheAdminEssentialJson(
      `/api/admin/grades/bulletin?${annualParams.toString()}`,
      bulletin,
    );
  });
}

/**
 * Prépare sans interaction utilisateur les quatre fonctions Admin essentielles.
 *
 * Le scope utilisateur/établissement provient obligatoirement d'un /api/auth/role
 * Cloud réussi. Le cache ne peut donc pas être alimenté sous l'identité résiduelle
 * d'un autre compte présent auparavant dans le même navigateur.
 */
export async function prepareAdminEssentialOffline(
  input: {
    userId: string;
    institutionId: string;
  },
  onProgress: (message: string) => void = () => undefined,
): Promise<AdminEssentialPreparationResult> {
  const userId = String(input.userId || "").trim();
  const institutionId = String(input.institutionId || "").trim();
  if (!userId || !institutionId) {
    throw new Error("admin_cloud_scope_required");
  }
  rememberAdminEssentialScope({ userId, institutionId });

  onProgress("Préparation des listes administratives…");
  const [classesPayload, affectationsPayload] = await Promise.all([
    jsonGet<AdminClassesPayload>("/api/admin/classes?limit=999"),
    // Le conseil de classe utilise cette URL sans limite ; on prépare aussi sa
    // clé exacte pour que son code actuel puisse fonctionner sans modification.
    jsonGet<AdminClassesPayload>("/api/admin/classes").then(() =>
      jsonGet<AdminClassesPayload>("/api/admin/classes?limit=999"),
    ),
    jsonGet("/api/admin/students"),
    jsonGet("/api/admin/institution/settings"),
    jsonGet("/api/admin/institution/academic-years"),
    optional(() => jsonGet<any>("/api/admin/affectations/current"), { items: [] }),
  ]).then((values) => [values[0], values[5]] as const);

  // Si l'API facultative des affectations n'a pas répondu, Conseil doit recevoir
  // une réponse vide plutôt qu'une exception réseau dans son Promise.all.
  await cacheAdminEssentialJson(
    "/api/admin/affectations/current",
    affectationsPayload || { items: [] },
  );

  const classes = itemsOf<AdminClass>(classesPayload).filter((item) =>
    Boolean(String(item?.id || "").trim()),
  );

  // Le document PWA et ses chunks doivent être rafraîchis AVANT les travaux
  // lourds (rosters, bulletins, conduite). Sinon une seule classe défaillante ou
  // une coupure pendant la préparation peut laisser un ancien shell en cache,
  // avec ancien menu et ancien code de lecture hors ligne.
  onProgress("Mise à jour des écrans essentiels…");
  await warmOfflineShell([...ADMIN_ESSENTIAL_STATIC_PATHS]);

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
      await optional(() => jsonGet(rosterUrl(classId, academicYear)), null);
    }

    // Cette variante est la première source utilisée par Conseil pour limiter le
    // calcul aux élèves encore inscrits : elle fait partie du paquet obligatoire.
    await jsonGet(activeStudentsUrl(classId));
  });

  // Les listes imprimables sont dynamiques. Une panne sur une classe ne doit
  // pas empêcher la consultation des trois autres fonctions essentielles.
  await mapLimit(classes, 3, async (classRow) => {
    const classId = String(classRow.id || "").trim();
    if (!classId) return;
    await optional(
      () => warmOfflineShell([`/admin/classes/liste/${encodeURIComponent(classId)}`]),
      undefined,
    );
  });

  onProgress("Préparation des bulletins et du conseil de classe…");
  // prepareOffline('admin') parcourt déjà toutes les classes et périodes et
  // calcule Bulletin + Conduite via les API officielles.
  const readiness = await prepareOffline("admin", onProgress);

  // Conseil réutilise les mêmes snapshots : aucune seconde vague de calcul Cloud.
  await publishCouncilAliases(classes);
  const preparedAt = new Date().toISOString();

  // Ce marqueur est publié EN DERNIER. Une coupure au milieu de la préparation
  // laisse l'ancien paquet valide intact et ne rend jamais un paquet partiel
  // éligible à la connexion hors ligne.
  const marker: AdminEssentialPreparationMarker = {
    version: ADMIN_ESSENTIAL_PREPARATION_VERSION,
    role: "admin",
    user_id: userId,
    institution_id: institutionId,
    prepared_at: preparedAt,
    class_count: classes.length,
    roster_count: rosterCount,
    bulletin_count: Number(readiness.bulletin_count || 0),
    shell_ready: true,
  };
  await cacheSet(
    adminEssentialPreparationKey(userId, institutionId),
    marker,
  );

  return {
    readiness,
    class_count: classes.length,
    roster_count: rosterCount,
    prepared_at: preparedAt,
  };
}
