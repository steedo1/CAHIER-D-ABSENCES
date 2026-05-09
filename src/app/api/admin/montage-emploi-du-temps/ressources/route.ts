import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResourceType = "ordinary" | "pc_lab" | "svt_lab" | "computer_lab" | "sports_field";
type RoomFormat = "numeric" | "alpha";
type DbPreferenceUsage = "main" | "allowed" | "forbidden";

type ResourcePayload = {
  id?: string;
  name?: string;
  resource_type?: ResourceType | string;
  capacity?: number | string | null;
  is_shared?: boolean;
  is_active?: boolean;
};

type PreferencePayload = {
  class_id?: string;
  main_resource_id?: string | null;
  alternative_resource_id?: string | null;
};

type Payload = ResourcePayload & {
  action?:
    | "save_resource"
    | "generate_ordinary_rooms"
    | "ensure_specialized_rooms"
    | "save_class_room_preferences";
  base_name?: string;
  format?: RoomFormat | string;
  count?: number | string;
  specialized_counts?: Partial<Record<ResourceType, number | string>>;
  preferences?: PreferencePayload[];
};

const RESOURCE_TYPES: ResourceType[] = ["ordinary", "pc_lab", "svt_lab", "computer_lab", "sports_field"];

const SPECIALIZED_DEFINITIONS: Array<{ type: ResourceType; baseName: string }> = [
  { type: "pc_lab", baseName: "Labo P.C" },
  { type: "svt_lab", baseName: "Labo SVT" },
  { type: "sports_field", baseName: "Terrain EPS" },
  { type: "computer_lab", baseName: "Salle informatique" },
];

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeKey(value: unknown) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toNumberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toPositiveInt(value: unknown, fallback: number, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(max, Math.floor(n)));
}

function validResourceType(value: unknown): ResourceType {
  const text = clean(value);
  if (RESOURCE_TYPES.includes(text as ResourceType)) return text as ResourceType;
  return "ordinary";
}

function validFormat(value: unknown): RoomFormat {
  return clean(value) === "alpha" ? "alpha" : "numeric";
}

function roomName(baseName: string, format: RoomFormat, index: number) {
  if (format === "alpha") return `${baseName} ${String.fromCharCode(64 + index)}`;
  return `${baseName} ${index}`;
}

function specializedRoomName(baseName: string, count: number, index: number) {
  return count <= 1 ? baseName : `${baseName} ${index}`;
}

async function guardAdmin() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "unauthorized", message: "Utilisateur non connecté." },
        { status: 401 },
      ),
    };
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "profile_failed", message: meErr.message },
        { status: 400 },
      ),
    };
  }

  const institutionId = me?.institution_id ? String(me.institution_id) : "";
  if (!institutionId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "no_institution", message: "Aucune institution associée à ce compte." },
        { status: 400 },
      ),
    };
  }

  const { data: roleRow, error: roleErr } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (roleErr) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "role_failed", message: roleErr.message },
        { status: 400 },
      ),
    };
  }

  if (!["admin", "super_admin"].includes(String(roleRow?.role || ""))) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "forbidden", message: "Droits insuffisants." },
        { status: 403 },
      ),
    };
  }

  return { ok: true as const, srv, userId: user.id, institutionId };
}

export async function GET() {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;

    const [resourcesRes, classesRes, preferencesRes] = await Promise.all([
      guard.srv
        .from("montage_timetable_resources")
        .select("id,institution_id,name,resource_type,capacity,is_shared,is_active,metadata,created_at,updated_at")
        .eq("institution_id", guard.institutionId)
        .order("resource_type", { ascending: true })
        .order("name", { ascending: true }),
      guard.srv
        .from("classes")
        .select("id,label")
        .eq("institution_id", guard.institutionId)
        .order("label", { ascending: true }),
      guard.srv
        .from("montage_timetable_class_room_preferences")
        .select("id,class_id,resource_id,priority,usage_type,is_allowed")
        .eq("institution_id", guard.institutionId)
        .order("class_id", { ascending: true })
        .order("priority", { ascending: true }),
    ]);

    const firstError = resourcesRes.error || classesRes.error || preferencesRes.error;
    if (firstError) {
      return NextResponse.json(
        { ok: false, error: "resources_fetch_failed", message: firstError.message },
        { status: 400 },
      );
    }

    const resources = resourcesRes.data || [];
    const preferences = preferencesRes.data || [];

    return NextResponse.json({
      ok: true,
      items: resources,
      classes: classesRes.data || [],
      preferences,
      totals: {
        resources: resources.length,
        active: resources.filter((item: any) => item.is_active).length,
        ordinary: resources.filter((item: any) => item.resource_type === "ordinary").length,
        specialized: resources.filter((item: any) => item.resource_type !== "ordinary").length,
        classes: (classesRes.data || []).length,
        classes_with_main_room: new Set(
          preferences
            .filter((item: any) => item.usage_type === "main" && item.is_allowed)
            .map((item: any) => String(item.class_id)),
        ).size,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "server_error", message: error instanceof Error ? error.message : "Erreur serveur." },
      { status: 500 },
    );
  }
}

async function insertMissingResources({
  srv,
  institutionId,
  userId,
  resources,
}: {
  srv: any;
  institutionId: string;
  userId: string;
  resources: Array<{ name: string; resource_type: ResourceType; capacity?: number | null }>;
}) {
  if (resources.length === 0) return { inserted: 0, skipped: 0 };

  const { data: existing, error: existingErr } = await srv
    .from("montage_timetable_resources")
    .select("name,resource_type")
    .eq("institution_id", institutionId);

  if (existingErr) throw new Error(existingErr.message);

  const existingKeys = new Set(
    (existing || []).map((item: any) => `${item.resource_type}:${normalizeKey(item.name)}`),
  );

  const rows = resources
    .map((item) => ({
      institution_id: institutionId,
      name: item.name,
      resource_type: item.resource_type,
      capacity: item.capacity ?? null,
      is_shared: true,
      is_active: true,
      metadata: { source: "horaclasse_room_setup" },
      created_by: userId,
      updated_by: userId,
    }))
    .filter((item) => {
      const key = `${item.resource_type}:${normalizeKey(item.name)}`;
      if (existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });

  if (rows.length === 0) return { inserted: 0, skipped: resources.length };

  const { error } = await srv.from("montage_timetable_resources").insert(rows);
  if (error) throw new Error(error.message);

  return { inserted: rows.length, skipped: resources.length - rows.length };
}

export async function POST(req: NextRequest) {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;

    const body = (await req.json().catch(() => ({}))) as Payload;
    const action = clean(body.action || "save_resource");

    if (action === "generate_ordinary_rooms") {
      const baseName = clean(body.base_name || "Salle") || "Salle";
      const format = validFormat(body.format);
      const count = toPositiveInt(body.count, 1, 80);
      if (count <= 0) {
        return NextResponse.json(
          { ok: false, error: "invalid_count", message: "Le nombre de salles doit être supérieur à 0." },
          { status: 400 },
        );
      }

      const resources = Array.from({ length: count }, (_, index) => ({
        name: roomName(baseName, format, index + 1),
        resource_type: "ordinary" as ResourceType,
      }));

      const result = await insertMissingResources({
        srv: guard.srv,
        institutionId: guard.institutionId,
        userId: guard.userId,
        resources,
      });

      return NextResponse.json({
        ok: true,
        inserted: result.inserted,
        skipped: result.skipped,
        message:
          result.inserted > 0
            ? `${result.inserted} salle(s) ordinaire(s) ajoutée(s).`
            : "Aucune nouvelle salle ajoutée : elles existent déjà.",
      });
    }

    if (action === "ensure_specialized_rooms") {
      const counts = body.specialized_counts || {};
      const resources: Array<{ name: string; resource_type: ResourceType }> = [];

      for (const definition of SPECIALIZED_DEFINITIONS) {
        const count = toPositiveInt(counts[definition.type], 0, 20);
        for (let index = 1; index <= count; index += 1) {
          resources.push({
            name: specializedRoomName(definition.baseName, count, index),
            resource_type: definition.type,
          });
        }
      }

      const result = await insertMissingResources({
        srv: guard.srv,
        institutionId: guard.institutionId,
        userId: guard.userId,
        resources,
      });

      return NextResponse.json({
        ok: true,
        inserted: result.inserted,
        skipped: result.skipped,
        message:
          result.inserted > 0
            ? `${result.inserted} ressource(s) spécialisée(s) ajoutée(s).`
            : "Aucune nouvelle ressource spécialisée ajoutée.",
      });
    }

    if (action === "save_class_room_preferences") {
      const preferences = Array.isArray(body.preferences) ? body.preferences : [];
      const classIds = Array.from(
        new Set(preferences.map((item) => clean(item.class_id)).filter(Boolean)),
      );

      if (classIds.length === 0) {
        return NextResponse.json({ ok: true, message: "Aucune affectation de salle à enregistrer." });
      }

      const { error: deleteErr } = await guard.srv
        .from("montage_timetable_class_room_preferences")
        .delete()
        .eq("institution_id", guard.institutionId)
        .in("class_id", classIds);

      if (deleteErr) {
        return NextResponse.json(
          { ok: false, error: "preferences_delete_failed", message: deleteErr.message },
          { status: 400 },
        );
      }

      const rows: Array<{
        institution_id: string;
        class_id: string;
        resource_id: string;
        priority: number;
        usage_type: DbPreferenceUsage;
        is_allowed: boolean;
        created_by: string;
        updated_by: string;
      }> = [];

      for (const item of preferences) {
        const classId = clean(item.class_id);
        const main = clean(item.main_resource_id);
        const alternative = clean(item.alternative_resource_id);
        if (!classId) continue;
        if (main) {
          rows.push({
            institution_id: guard.institutionId,
            class_id: classId,
            resource_id: main,
            priority: 1,
            usage_type: "main",
            is_allowed: true,
            created_by: guard.userId,
            updated_by: guard.userId,
          });
        }
        if (alternative && alternative !== main) {
          rows.push({
            institution_id: guard.institutionId,
            class_id: classId,
            resource_id: alternative,
            priority: 2,
            usage_type: "allowed",
            is_allowed: true,
            created_by: guard.userId,
            updated_by: guard.userId,
          });
        }
      }

      if (rows.length > 0) {
        const { error: insertErr } = await guard.srv
          .from("montage_timetable_class_room_preferences")
          .insert(rows);

        if (insertErr) {
          return NextResponse.json(
            { ok: false, error: "preferences_save_failed", message: insertErr.message },
            { status: 400 },
          );
        }
      }

      return NextResponse.json({ ok: true, message: "Affectations de salles enregistrées." });
    }

    const name = clean(body.name);
    if (!name) {
      return NextResponse.json(
        { ok: false, error: "missing_name", message: "Nom de ressource obligatoire." },
        { status: 400 },
      );
    }

    const payload = {
      institution_id: guard.institutionId,
      name,
      resource_type: validResourceType(body.resource_type),
      capacity: toNumberOrNull(body.capacity),
      is_shared: body.is_shared !== false,
      is_active: body.is_active !== false,
      updated_by: guard.userId,
    };

    const query = body.id
      ? guard.srv
          .from("montage_timetable_resources")
          .update(payload)
          .eq("id", body.id)
          .eq("institution_id", guard.institutionId)
          .select()
          .single()
      : guard.srv
          .from("montage_timetable_resources")
          .insert({ ...payload, created_by: guard.userId })
          .select()
          .single();

    const { data, error } = await query;
    if (error) {
      return NextResponse.json(
        { ok: false, error: "save_failed", message: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true, item: data, message: "Ressource sauvegardée." });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "server_error", message: error instanceof Error ? error.message : "Erreur serveur." },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;

    const id = clean(new URL(req.url).searchParams.get("id"));
    if (!id) {
      return NextResponse.json(
        { ok: false, error: "missing_id", message: "Identifiant manquant." },
        { status: 400 },
      );
    }

    const { error: prefErr } = await guard.srv
      .from("montage_timetable_class_room_preferences")
      .delete()
      .eq("institution_id", guard.institutionId)
      .eq("resource_id", id);

    if (prefErr) {
      return NextResponse.json(
        { ok: false, error: "preference_delete_failed", message: prefErr.message },
        { status: 400 },
      );
    }

    const { error } = await guard.srv
      .from("montage_timetable_resources")
      .delete()
      .eq("id", id)
      .eq("institution_id", guard.institutionId);

    if (error) {
      return NextResponse.json(
        { ok: false, error: "delete_failed", message: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true, message: "Ressource supprimée." });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "server_error", message: error instanceof Error ? error.message : "Erreur serveur." },
      { status: 500 },
    );
  }
}
