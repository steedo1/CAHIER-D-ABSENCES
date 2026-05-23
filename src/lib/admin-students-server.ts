// src/lib/admin-students-server.ts
import { cookies, headers } from "next/headers";

export type AdminStudentRow = {
  id: string;
  full_name: string;
  class_id: string | null;
  class_label: string | null;
  matricule?: string | null;
  level?: string | null;
  class_level?: string | null;
  academic_year?: string | null;
  gender?: string | null;
  is_affecte?: boolean | null;
  is_boarder?: boolean | null;
  regime?: string | null;
};

function buildOriginFromHeaders(h: Headers) {
  const proto =
    h.get("x-forwarded-proto") ||
    (process.env.NODE_ENV === "development" ? "http" : "https");
  const host = h.get("x-forwarded-host") || h.get("host");
  if (!host) {
    throw new Error("Impossible de déterminer l’hôte courant.");
  }
  return `${proto}://${host}`;
}

export async function getAdminStudentsServer(
  academicYear?: string | null,
): Promise<AdminStudentRow[]> {
  const h = await headers();
  const c = await cookies();

  const origin = buildOriginFromHeaders(h);

  const url = new URL(`${origin}/api/admin/students`);
  const year = String(academicYear || "").trim();
  if (year) url.searchParams.set("academic_year", year);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      cookie: c.toString(),
      accept: "application/json",
    },
    cache: "no-store",
  });

  const json = await res.json().catch(() => ({}));

  if (res.status === 401) {
    throw new Error("unauthorized");
  }

  if (!res.ok) {
    throw new Error(json?.error || `HTTP ${res.status}`);
  }

  const items = Array.isArray(json?.items) ? json.items : [];

  return items.map((row: any) => ({
    id: String(row.id),
    full_name: String(row.full_name || ""),
    class_id: row.class_id ? String(row.class_id) : null,
    class_label: row.class_label ? String(row.class_label) : null,
    matricule: row.matricule ? String(row.matricule) : null,
    level: row.level ? String(row.level) : null,
    class_level: row.class_level ? String(row.class_level) : null,
    academic_year: row.academic_year ? String(row.academic_year) : null,
    gender: row.gender ? String(row.gender) : null,
    is_affecte:
      typeof row.is_affecte === "boolean" ? row.is_affecte : null,
    is_boarder:
      typeof row.is_boarder === "boolean" ? row.is_boarder : null,
    regime: row.regime ? String(row.regime) : null,
  }));
}