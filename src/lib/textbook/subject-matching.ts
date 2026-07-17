export type TextbookSubjectIdentity = {
  globalSubjectId: string | null;
  institutionSubjectId: string | null;
  displayName: string | null;
  tokens: Set<string>;
  keys: Set<string>;
};

export type TextbookSubjectCatalog = {
  byToken: Map<string, TextbookSubjectIdentity>;
  byKey: Map<string, TextbookSubjectIdentity[]>;
};

function uniq(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

function firstRelation(value: unknown) {
  if (Array.isArray(value)) return value[0] || null;
  if (value && typeof value === "object") return value as any;
  return null;
}

export function normalizeTextbookSubjectKey(value: unknown) {
  const compact = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();

  const aliases: Record<string, string> = {
    math: "mathematiques",
    maths: "mathematiques",
    mathematique: "mathematiques",
    mathematiques: "mathematiques",
    esp: "espagnol",
    espagnole: "espagnol",
    espagnol: "espagnol",
    all: "allemand",
    allemand: "allemand",
    ang: "anglais",
    anglais: "anglais",
    fr: "francais",
    francais: "francais",
    svt: "svt",
    sciencesdelavieetdelaterre: "svt",
    pc: "physiquechimie",
    physiquechimie: "physiquechimie",
    hg: "histoiregeographie",
    histoiregeographie: "histoiregeographie",
    edhc: "edhc",
    educationauxdroitshumainsetalacitoyennete: "edhc",
    musique: "musique",
    educationmusicale: "musique",
    artplastique: "artsplastiques",
    artsplastique: "artsplastiques",
    artsplastiques: "artsplastiques",
  };

  return aliases[compact] || compact;
}

function makeIdentity(input: {
  globalSubjectId?: unknown;
  institutionSubjectId?: unknown;
  displayName?: unknown;
  names?: unknown[];
  tokens?: unknown[];
}): TextbookSubjectIdentity {
  const globalSubjectId = String(input.globalSubjectId || "").trim() || null;
  const institutionSubjectId =
    String(input.institutionSubjectId || "").trim() || null;
  const displayName = String(input.displayName || "").trim() || null;

  const tokens = new Set(
    uniq([
      globalSubjectId,
      institutionSubjectId,
      ...(input.tokens || []).map((value) => String(value || "")),
    ]),
  );

  const keys = new Set(
    uniq([
      displayName,
      ...(input.names || []).map((value) => String(value || "")),
    ])
      .map(normalizeTextbookSubjectKey)
      .filter(Boolean),
  );

  return {
    globalSubjectId,
    institutionSubjectId,
    displayName,
    tokens,
    keys,
  };
}

function mergeIdentity(
  target: TextbookSubjectIdentity,
  source: TextbookSubjectIdentity,
) {
  if (!target.globalSubjectId && source.globalSubjectId) {
    target.globalSubjectId = source.globalSubjectId;
  }
  if (!target.institutionSubjectId && source.institutionSubjectId) {
    target.institutionSubjectId = source.institutionSubjectId;
  }
  if (!target.displayName && source.displayName) {
    target.displayName = source.displayName;
  }
  for (const token of source.tokens) target.tokens.add(token);
  for (const key of source.keys) target.keys.add(key);
  return target;
}

function registerIdentity(
  catalog: TextbookSubjectCatalog,
  identity: TextbookSubjectIdentity,
) {
  for (const token of identity.tokens) {
    const existing = catalog.byToken.get(token);
    if (existing && existing !== identity) {
      mergeIdentity(existing, identity);
      for (const mergedToken of existing.tokens) {
        catalog.byToken.set(mergedToken, existing);
      }
    } else {
      catalog.byToken.set(token, identity);
    }
  }

  for (const key of identity.keys) {
    const rows = catalog.byKey.get(key) || [];
    const candidate = Array.from(identity.tokens).find((token) =>
      rows.some((row) => row.tokens.has(token)),
    );
    if (!candidate && !rows.includes(identity)) rows.push(identity);
    catalog.byKey.set(key, rows);
  }
}

export async function buildTextbookSubjectCatalog(
  srv: any,
  institutionId: string,
  rawIds: Array<string | null | undefined> = [],
): Promise<TextbookSubjectCatalog> {
  const catalog: TextbookSubjectCatalog = {
    byToken: new Map(),
    byKey: new Map(),
  };

  const { data: institutionSubjects, error } = await srv
    .from("institution_subjects")
    .select(
      "id,subject_id,custom_name,subjects:subject_id(id,name,code,subject_key)",
    )
    .eq("institution_id", institutionId);

  if (error) throw error;

  for (const row of (institutionSubjects || []) as any[]) {
    const subject = firstRelation(row?.subjects) || {};
    const identity = makeIdentity({
      globalSubjectId: subject?.id || row?.subject_id,
      institutionSubjectId: row?.id,
      displayName: row?.custom_name || subject?.name,
      names: [
        row?.custom_name,
        subject?.name,
        subject?.code,
        subject?.subject_key,
      ],
      tokens: [row?.id, row?.subject_id, subject?.id],
    });
    registerIdentity(catalog, identity);
  }

  const missingGlobalIds = uniq(rawIds).filter(
    (id) => !catalog.byToken.has(id),
  );

  if (missingGlobalIds.length) {
    const { data: subjects, error: subjectsError } = await srv
      .from("subjects")
      .select("id,name,code,subject_key")
      .in("id", missingGlobalIds);

    if (subjectsError) throw subjectsError;

    for (const row of (subjects || []) as any[]) {
      const identity = makeIdentity({
        globalSubjectId: row?.id,
        displayName: row?.name,
        names: [row?.name, row?.code, row?.subject_key],
        tokens: [row?.id],
      });
      registerIdentity(catalog, identity);
    }
  }

  return catalog;
}

function identityFromTokensAndName(
  catalog: TextbookSubjectCatalog,
  tokens: Array<string | null | undefined>,
  subjectName: unknown,
): TextbookSubjectIdentity | null {
  let resolved: TextbookSubjectIdentity | null = null;

  for (const token of uniq(tokens)) {
    const candidate = catalog.byToken.get(token);
    if (!candidate) continue;
    resolved = resolved ? mergeIdentity(resolved, candidate) : candidate;
  }

  if (resolved) return resolved;

  const key = normalizeTextbookSubjectKey(subjectName);
  if (!key) return null;
  const candidates = catalog.byKey.get(key) || [];
  return candidates.length === 1 ? candidates[0] : null;
}

export function resolveTextbookAssignmentSubject(
  assignment: any,
  catalog: TextbookSubjectCatalog,
) {
  return identityFromTokensAndName(
    catalog,
    [
      assignment?.subject_id,
      assignment?.institution_subject_id,
      assignment?.progression?.subject_id,
      assignment?.progression?.institution_subject_id,
    ],
    assignment?.progression?.subject_name || assignment?.subject_name,
  );
}

export function resolveTextbookRowSubject(
  row: any,
  catalog: TextbookSubjectCatalog,
) {
  return identityFromTokensAndName(
    catalog,
    [row?.subject_id, row?.institution_subject_id],
    row?.subject_name,
  );
}

function identitiesMatch(
  left: TextbookSubjectIdentity | null,
  right: TextbookSubjectIdentity | null,
) {
  if (!left || !right) return false;

  for (const token of left.tokens) {
    if (right.tokens.has(token)) return true;
  }
  for (const key of left.keys) {
    if (right.keys.has(key)) return true;
  }
  return false;
}

export function textbookAssignmentMatchesClassTeacherRows(
  assignment: any,
  rows: any[],
  catalog: TextbookSubjectCatalog,
) {
  if (!Array.isArray(rows) || !rows.length) return false;

  const assignmentSubject = resolveTextbookAssignmentSubject(
    assignment,
    catalog,
  );
  if (!assignmentSubject) return false;

  return rows.some((row) =>
    identitiesMatch(assignmentSubject, resolveTextbookRowSubject(row, catalog)),
  );
}

export function findTextbookTeacherForAssignment(
  assignment: any,
  rows: any[],
  catalog: TextbookSubjectCatalog,
) {
  const explicitTeacherId = String(assignment?.teacher_id || "").trim();
  if (explicitTeacherId) return explicitTeacherId;

  const assignmentSubject = resolveTextbookAssignmentSubject(
    assignment,
    catalog,
  );
  if (!assignmentSubject) return null;

  const matched = (rows || []).find((row) => {
    const teacherId = String(row?.teacher_id || "").trim();
    if (!teacherId) return false;
    return identitiesMatch(
      assignmentSubject,
      resolveTextbookRowSubject(row, catalog),
    );
  });

  return String(matched?.teacher_id || "").trim() || null;
}

export async function resolveTextbookSubjectForInstitution(
  srv: any,
  institutionId: string,
  input: {
    subject_id?: unknown;
    institution_subject_id?: unknown;
    subject_name?: unknown;
  },
) {
  const rawSubjectId = String(input?.subject_id || "").trim() || null;
  const rawInstitutionSubjectId =
    String(input?.institution_subject_id || "").trim() || null;
  const rawSubjectName = String(input?.subject_name || "").trim() || null;

  const catalog = await buildTextbookSubjectCatalog(srv, institutionId, [
    rawSubjectId,
    rawInstitutionSubjectId,
  ]);

  const identity = identityFromTokensAndName(
    catalog,
    [rawSubjectId, rawInstitutionSubjectId],
    rawSubjectName,
  );

  return {
    subject_id: identity?.globalSubjectId || rawSubjectId,
    institution_subject_id:
      identity?.institutionSubjectId || rawInstitutionSubjectId,
    subject_name: identity?.displayName || rawSubjectName,
  };
}
