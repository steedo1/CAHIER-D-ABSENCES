import { resolveAttendanceEducationContext } from "@/lib/education-attendance";
import { createRelayAttendanceAccessToken } from "@/lib/attendance-presence-server";
import { relayEndpointCandidates } from "@/lib/relay-endpoints";

export type ClassDeviceSourceRow = {
  id?: string | null;
  label?: string | null;
  level?: string | null;
  institution_id?: string | null;
  education_type?: string | null;
  formation_code?: string | null;
  formation_level_code?: string | null;
  [key: string]: unknown;
};

type InstitutionRow = {
  id?: string | null;
  name?: string | null;
  short_name?: string | null;
  settings_json?: unknown;
};

type AttendancePolicyRow = {
  institution_id?: string | null;
  enabled?: boolean | null;
  allow_local_relay?: boolean | null;
  relay_local_url?: string | null;
  relay_presence_secret?: string | null;
};

type RelayDeviceRow = {
  institution_id?: string | null;
  observed_lan_urls?: string[] | null;
  last_seen_at?: string | null;
  is_active?: boolean | null;
  revoked_at?: string | null;
};

type QueryResult<T> = {
  data: T[] | null;
  error: { code?: string; message?: string } | null;
};

export type ClassDeviceMetadataReader = {
  from(table: string): {
    select(columns: string): {
      in(column: string, values: string[]): PromiseLike<QueryResult<any>>;
    };
  };
};

export type ClassDeviceAccessDiagnostic =
  | "institution_id_missing"
  | "class_id_missing"
  | "relay_policy_missing"
  | "relay_disabled"
  | "relay_local_access_disabled"
  | "relay_not_provisioned"
  | "relay_provisioning_unavailable"
  | "relay_url_missing"
  | "relay_secret_missing"
  | "relay_secret_too_short";

export class ClassDeviceAccessError extends Error {
  constructor(
    readonly status: number,
    readonly code:
      | "class_relay_policy_unavailable"
      | "class_relay_token_creation_failed",
  ) {
    super(code);
    this.name = "ClassDeviceAccessError";
  }
}

function text(value: unknown) {
  return String(value || "").trim();
}

function secretValue(value: unknown) {
  return String(value ?? "");
}

function relayDiagnostic(
  row: ClassDeviceSourceRow,
  policy: AttendancePolicyRow | null,
  relayLocalUrls: string[],
  relayProvisioned: boolean | null,
): ClassDeviceAccessDiagnostic | null {
  if (!text(row.institution_id)) return "institution_id_missing";
  if (!text(row.id)) return "class_id_missing";
  if (!policy) return "relay_policy_missing";
  if (policy.enabled !== true) return "relay_disabled";
  if (policy.allow_local_relay !== true) {
    return "relay_local_access_disabled";
  }
  if (relayProvisioned === null) return "relay_provisioning_unavailable";
  if (!relayProvisioned) return "relay_not_provisioned";
  if (relayLocalUrls.length === 0) return "relay_url_missing";
  const secret = secretValue(policy.relay_presence_secret);
  if (!secret) return "relay_secret_missing";
  if (secret.length < 32) return "relay_secret_too_short";
  return null;
}

function fallbackEducation(row: ClassDeviceSourceRow) {
  return resolveAttendanceEducationContext({
    educationType: row.education_type,
    formationCode: row.formation_code,
    formationLevelCode: row.formation_level_code,
    classLevel: row.level,
  });
}

async function readOptionalQuery<T>(
  read: () => PromiseLike<QueryResult<T>>,
): Promise<QueryResult<T>> {
  try {
    return await read();
  } catch {
    return {
      data: null,
      error: { code: "query_exception" },
    };
  }
}

async function readPolicyQuery(
  read: () => PromiseLike<QueryResult<AttendancePolicyRow>>,
): Promise<QueryResult<AttendancePolicyRow>> {
  try {
    return await read();
  } catch {
    throw new ClassDeviceAccessError(
      503,
      "class_relay_policy_unavailable",
    );
  }
}

export async function enrichClassDeviceAccess(input: {
  items: ClassDeviceSourceRow[];
  actorProfileId: string;
  service: ClassDeviceMetadataReader;
  createAccessToken?: typeof createRelayAttendanceAccessToken;
}) {
  const institutionIds = Array.from(
    new Set(
      input.items
        .map((item) => text(item.institution_id))
        .filter(Boolean),
    ),
  );
  if (institutionIds.length === 0) {
    return {
      items: input.items.map((row) => {
        const education = fallbackEducation(row);
        return {
          ...row,
          education_type: education.education_type,
          education_label: education.education_label,
          education_short_label: education.education_short_label,
          formation_code: education.formation_code,
          formation_label: education.formation_label,
          formation_level_code: education.formation_level_code,
          formation_level_label: education.formation_level_label,
          education_context_key: education.context_key,
          education_context_label: education.context_label,
          actor_profile_id: input.actorProfileId,
          attendance_presence: {
            enabled: false,
            allow_local_relay: false,
            relay_local_url: null,
            relay_access_token: null,
            access_contract_version: 2 as const,
            actor_kind: "class_device" as const,
            authorized_class_id: text(row.id) || null,
            authorized_actor_profile_id: input.actorProfileId,
            diagnostic: "institution_id_missing" as const,
          },
          metadata_diagnostics: ["institution_id_missing"],
        };
      }),
      diagnostics: ["institution_id_missing"],
    };
  }

  const [institutionsResult, settingsResult, policiesResult, relayDevicesResult] = await Promise.all([
    readOptionalQuery<InstitutionRow>(() =>
      input.service
        .from("institutions")
        .select("id,name,short_name")
        .in("id", institutionIds),
    ),
    readOptionalQuery<InstitutionRow>(() =>
      input.service
        .from("institutions")
        .select("id,settings_json")
        .in("id", institutionIds),
    ),
    readPolicyQuery(() =>
      input.service
        .from("institution_attendance_policies")
        .select(
          "institution_id,enabled,allow_local_relay,relay_local_url,relay_presence_secret",
        )
        .in("institution_id", institutionIds),
    ),
    readOptionalQuery<RelayDeviceRow>(() =>
      input.service
        .from("relay_sync_devices")
        .select("institution_id,observed_lan_urls,last_seen_at,is_active,revoked_at")
        .in("institution_id", institutionIds),
    ),
  ]);

  if (policiesResult.error) {
    throw new ClassDeviceAccessError(
      503,
      "class_relay_policy_unavailable",
    );
  }

  const institutionById = new Map(
    (institutionsResult.error ? [] : institutionsResult.data || []).map(
      (row) => [text(row.id), row],
    ),
  );
  const settingsById = new Map(
    (settingsResult.error ? [] : settingsResult.data || []).map(
      (row) => [text(row.id), row],
    ),
  );
  const policyByInstitution = new Map(
    (policiesResult.data || []).map((row) => [
      text(row.institution_id),
      row,
    ]),
  );
  const observedUrlsByInstitution = new Map<string, string[]>();
  const provisionedRelayInstitutions = new Set<string>();
  if (!relayDevicesResult.error) {
    for (const row of relayDevicesResult.data || []) {
      if (
        row.is_active !== true ||
        text(row.revoked_at) ||
        !text(row.last_seen_at)
      ) continue;
      const institutionId = text(row.institution_id);
      if (!institutionId) continue;
      provisionedRelayInstitutions.add(institutionId);
      if (!Array.isArray(row.observed_lan_urls)) continue;
      observedUrlsByInstitution.set(institutionId, [
        ...(observedUrlsByInstitution.get(institutionId) || []),
        ...row.observed_lan_urls,
      ]);
    }
  }
  const aggregateDiagnostics = new Set<string>();
  if (institutionsResult.error) {
    aggregateDiagnostics.add("institution_metadata_unavailable");
  }
  if (settingsResult.error) {
    aggregateDiagnostics.add("education_settings_unavailable");
  }

  const createAccessToken =
    input.createAccessToken || createRelayAttendanceAccessToken;
  const enriched = input.items.map((row) => {
    const institutionId = text(row.institution_id);
    const classId = text(row.id);
    const institution = institutionById.get(institutionId);
    const settings = settingsById.get(institutionId);
    const policy = policyByInstitution.get(institutionId) || null;
    const relayLocalUrls = relayEndpointCandidates({
      configuredUrl: policy?.relay_local_url,
      observedUrls: observedUrlsByInstitution.get(institutionId),
    });
    const accessDiagnostic = relayDiagnostic(
      row,
      policy,
      relayLocalUrls,
      relayDevicesResult.error
        ? null
        : provisionedRelayInstitutions.has(institutionId),
    );
    const metadataDiagnostics = new Set<string>();
    if (institutionsResult.error) {
      metadataDiagnostics.add("institution_metadata_unavailable");
    } else if (!institution) {
      metadataDiagnostics.add("institution_metadata_missing");
    }
    if (settingsResult.error) {
      metadataDiagnostics.add("education_settings_unavailable");
    } else if (!settings || settings.settings_json == null) {
      metadataDiagnostics.add("education_settings_missing");
    }

    let education;
    try {
      education = resolveAttendanceEducationContext({
        educationType: row.education_type,
        formationCode: row.formation_code,
        formationLevelCode: row.formation_level_code,
        classLevel: row.level,
        settingsJson: settings?.settings_json,
      });
    } catch {
      education = fallbackEducation(row);
      metadataDiagnostics.add("education_metadata_invalid");
      aggregateDiagnostics.add("education_metadata_invalid");
    }

    let relayAccessToken: string | null = null;
    if (accessDiagnostic === null) {
      try {
        relayAccessToken = createAccessToken({
          secret: secretValue(policy?.relay_presence_secret),
          institutionId,
          actorProfileId: input.actorProfileId,
          actorKind: "class_device",
          classId,
        });
      } catch {
        throw new ClassDeviceAccessError(
          500,
          "class_relay_token_creation_failed",
        );
      }
      if (!text(relayAccessToken)) {
        throw new ClassDeviceAccessError(
          500,
          "class_relay_token_creation_failed",
        );
      }
    }

    for (const diagnostic of metadataDiagnostics) {
      aggregateDiagnostics.add(diagnostic);
    }
    return {
      ...row,
      institution_name:
        institution?.name || institution?.short_name || null,
      education_type: education.education_type,
      education_label: education.education_label,
      education_short_label: education.education_short_label,
      formation_code: education.formation_code,
      formation_label: education.formation_label,
      formation_level_code: education.formation_level_code,
      formation_level_label: education.formation_level_label,
      education_context_key: education.context_key,
      education_context_label: education.context_label,
      actor_profile_id: input.actorProfileId,
      attendance_presence: {
        enabled: accessDiagnostic === null,
        allow_local_relay: accessDiagnostic === null,
        access_contract_version: 2 as const,
        actor_kind: "class_device" as const,
        authorized_class_id: classId || null,
        authorized_actor_profile_id: input.actorProfileId,
        relay_local_url:
          accessDiagnostic === null
            ? relayLocalUrls[0]
            : null,
        relay_local_urls:
          accessDiagnostic === null ? relayLocalUrls : [],
        relay_access_token: relayAccessToken,
        diagnostic: accessDiagnostic,
      },
      metadata_diagnostics: Array.from(metadataDiagnostics),
    };
  });

  return {
    items: enriched,
    diagnostics: Array.from(aggregateDiagnostics),
  };
}
