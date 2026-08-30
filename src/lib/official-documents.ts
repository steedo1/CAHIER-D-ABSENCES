import crypto from "crypto";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export type OfficialDocumentType = "receipt" | "bulletin";

export type OfficialDocumentAccess = {
  ok: boolean;
  userId: string | null;
  institutionId: string | null;
  roles: string[];
  canReadReceipts: boolean;
  canReadBulletins: boolean;
};

const RECEIPT_ROLES = new Set(["super_admin", "founder", "finance_manager"]);
const BULLETIN_ROLES = new Set(["super_admin", "founder", "admin", "file_correspondent"]);

export function cleanOfficialText(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedJson(value: any): any {
  if (Array.isArray(value)) {
    return value.map((item) => {
      const next = normalizedJson(item);
      return next === undefined ? null : next;
    });
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    return value;
  }

  return Object.keys(value)
    .sort((a, b) => a.localeCompare(b))
    .reduce<Record<string, any>>((acc, key) => {
      const next = normalizedJson(value[key]);
      if (next !== undefined) acc[key] = next;
      return acc;
    }, {});
}

export function stableOfficialJson(value: any) {
  return JSON.stringify(normalizedJson(value));
}

export function canonicalOfficialSnapshot(value: any) {
  return JSON.parse(stableOfficialJson(value));
}

export function hashOfficialSnapshot(value: any) {
  return crypto
    .createHash("sha256")
    .update(stableOfficialJson(value), "utf8")
    .digest("hex");
}

export function computeOfficialBulletinSourceId(p: {
  institutionId: string;
  classId: string;
  studentId: string;
  academicYear: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  periodLabel: string | null;
}) {
  // Cette concaténation doit rester strictement identique à celle de la route
  // bulletin historique, car elle constitue l'identité technique du document.
  const raw = [
    String(p.institutionId ?? ""),
    String(p.classId ?? ""),
    String(p.studentId ?? ""),
    String(p.academicYear ?? ""),
    String(p.periodFrom ?? ""),
    String(p.periodTo ?? ""),
    String(p.periodLabel ?? ""),
  ].join("|");

  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

export function bulletinOfficialNumber(shortCode: string | null | undefined, sourceId: string) {
  const code = cleanOfficialText(shortCode).toUpperCase();
  if (code) return `BUL-${code}`;
  return `BUL-${cleanOfficialText(sourceId).slice(0, 12).toUpperCase()}`;
}

export async function getOfficialDocumentAccess(): Promise<OfficialDocumentAccess> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      userId: null,
      institutionId: null,
      roles: [],
      canReadReceipts: false,
      canReadBulletins: false,
    };
  }

  const [{ data: profile, error: profileError }, { data: roleRows, error: roleError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("institution_id")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("user_roles")
        .select("role,institution_id")
        .eq("profile_id", user.id),
    ]);

  if (profileError) throw new Error(profileError.message);
  if (roleError) throw new Error(roleError.message);

  let institutionId = cleanOfficialText((profile as any)?.institution_id);
  if (!institutionId) {
    institutionId = cleanOfficialText(
      (roleRows ?? []).find((row: any) => cleanOfficialText(row.institution_id))
        ?.institution_id,
    );
  }

  // Un rôle détenu dans un autre établissement ne doit jamais ouvrir le
  // registre de l'établissement actuellement sélectionné. Les anciens rôles
  // sans institution restent compatibles, comme dans finance-access.ts.
  const roles: string[] = Array.from(
    new Set<string>(
      (roleRows ?? [])
        .filter((row: any) => {
          const role = cleanOfficialText(row.role);
          const roleInstitutionId = cleanOfficialText(row.institution_id);
          return (
            role === "super_admin" ||
            !roleInstitutionId ||
            roleInstitutionId === institutionId
          );
        })
        .map((row: any) => cleanOfficialText(row.role))
        .filter((role: string): role is string => Boolean(role)),
    ),
  );

  const canReadReceipts = roles.some((role) => RECEIPT_ROLES.has(role));
  const canReadBulletins = roles.some((role) => BULLETIN_ROLES.has(role));

  return {
    ok: Boolean(institutionId && (canReadReceipts || canReadBulletins)),
    userId: user.id,
    institutionId: institutionId || null,
    roles,
    canReadReceipts,
    canReadBulletins,
  };
}
