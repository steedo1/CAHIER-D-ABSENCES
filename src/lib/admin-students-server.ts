// src/lib/admin-students-server.ts
import { cookies, headers } from "next/headers";

export type AdminStudentRow = {
  id: string;
  full_name: string;
  class_id: string | null;
  class_label: string | null;
  matricule?: string | null;
  level?: string | null;
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

export async function getAdminStudentsServer(): Promise<AdminStudentRow[]> {
  const h = await headers();
  const c = await cookies();

  const origin = buildOriginFromHeaders(h);

  const res = await fetch(`${origin}/api/admin/students`, {
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
  }));
}