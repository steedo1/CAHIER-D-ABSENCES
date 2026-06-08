import type {
  CandidateSlot,
  HalfDay,
  InstitutionRuleBehavior,
  InstitutionRulePriority,
  InstitutionRuleScope,
  InstitutionSchedulingRule,
  LessonBlock,
  Placement,
  Room,
  SchedulerContext,
  ScienceTandemMode,
  ScienceTandemScope,
  SessionPeriod,
  TerrainSchedulingRules,
} from "./types";

type RoomType = Room["roomType"];

export const DEFAULT_TERRAIN_RULES: TerrainSchedulingRules = {
  avoidBreakInsideMultiPeriodBlock: true,

  enablePcSvtTandem: false,
  pcSvtTandemScope: "disabled",
  pcSvtTandemMode: "parallel",
  pcSvtTandemClassIds: [],

  allowPcInOrdinaryRoomWhenNoLab: true,
  allowSvtInOrdinaryRoomWhenNoLab: true,
  allowEpsInOrdinaryRoomWhenNoField: false,
  allowComputerInOrdinaryRoomWhenNoLab: true,

  // RÃ©alitÃ© terrain : les terrains EPS sont partageables, mais pas illimitÃ©s.
  // Par dÃ©faut, un terrain peut accueillir 2 cours EPS au mÃªme crÃ©neau.
  treatSportsFieldAsSharedResource: true,
  epsMaxSimultaneousCoursesPerField: 2,

  // RÃ¨gle terrain par dÃ©faut : EPS est fortement Ã©vitÃ© aprÃ¨s 10h le matin
  // et avant 15h lâ€™aprÃ¨s-midi. Si aucune solution propre nâ€™existe, le cours
  // reste placÃ© mais la case est marquÃ©e Ã  vÃ©rifier.
  epsHotHourMode: "soft",

  avoidStudentGaps: true,
  avoidTeacherGaps: true,
  avoidSingleHourReturn: true,
  avoidHeavySubjectsBackToBack: true,
  avoidSameSubjectSameDay: true,
  balanceHalfDays: true,
  preferMainClassRoom: true,

  // Règles personnalisées par établissement : vide par défaut pour éviter tout comportement spécial caché.
  institutionRules: [],
};


const RULE_PRIORITIES: InstitutionRulePriority[] = ["hard", "strong", "medium", "soft"];
const RULE_BEHAVIORS: InstitutionRuleBehavior[] = ["prefer", "avoid", "require", "forbid"];
const RULE_SCOPES: InstitutionRuleScope[] = ["all", "level", "class", "subject", "teacher"];
const HALF_DAYS: HalfDay[] = ["morning", "afternoon", "evening"];

function normalizeTextToken(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function textValue(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean)));
}

function asNumberArray(value: unknown, min: number, max: number): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item >= min && item <= max),
    ),
  ).sort((a, b) => a - b);
}

function asHalfDays(value: unknown): HalfDay[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter((item): item is HalfDay => HALF_DAYS.includes(item as HalfDay)),
    ),
  );
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const text = String(value ?? "").trim();
  return allowed.includes(text as T) ? (text as T) : fallback;
}

function makeRuleId(index: number): string {
  return `rule_${Date.now().toString(36)}_${index + 1}`;
}

function normalizeInstitutionRules(value: unknown): InstitutionSchedulingRule[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((raw, index) => {
      const item = raw && typeof raw === "object" ? (raw as Partial<InstitutionSchedulingRule>) : {};
      const name = textValue(item.name, `Règle établissement ${index + 1}`);
      return {
        id: textValue(item.id, makeRuleId(index)),
        name,
        description: textValue(item.description, "") || null,
        enabled: item.enabled !== false,
        priority: oneOf(item.priority, RULE_PRIORITIES, "medium"),
        behavior: oneOf(item.behavior, RULE_BEHAVIORS, "prefer"),
        scope: oneOf(item.scope, RULE_SCOPES, "all"),
        dayIndexes: asNumberArray(item.dayIndexes, 1, 7),
        periodIndexes: asNumberArray(item.periodIndexes, 1, 20),
        halfDays: asHalfDays(item.halfDays),
        classIds: asStringArray(item.classIds),
        levelCodes: asStringArray(item.levelCodes),
        subjectIds: asStringArray(item.subjectIds),
        teacherIds: asStringArray(item.teacherIds),
        startTime: textValue(item.startTime, "") || null,
        endTime: textValue(item.endTime, "") || null,
      } satisfies InstitutionSchedulingRule;
    })
    .filter((rule) => rule.name.trim().length > 0);
}

export function normalizeTerrainRules(
  rules?: Partial<TerrainSchedulingRules> | null,
): TerrainSchedulingRules {
  const scope: ScienceTandemScope =
    rules?.enablePcSvtTandem && rules.pcSvtTandemScope !== "disabled"
      ? rules.pcSvtTandemScope ?? "all_classes"
      : rules?.enablePcSvtTandem
        ? "all_classes"
        : "disabled";

  const rawTandemMode = rules?.pcSvtTandemMode;
  const pcSvtTandemMode: ScienceTandemMode =
    rawTandemMode === "rotation" || rawTandemMode === "parallel"
      ? rawTandemMode
      : DEFAULT_TERRAIN_RULES.pcSvtTandemMode;

  const rawEpsMode = rules?.epsHotHourMode;
  const epsHotHourMode =
    rawEpsMode === "disabled"
      ? "disabled"
      : rawEpsMode === "strict"
        ? "strict"
        : DEFAULT_TERRAIN_RULES.epsHotHourMode;

  return {
    ...DEFAULT_TERRAIN_RULES,
    ...rules,
    enablePcSvtTandem: Boolean(rules?.enablePcSvtTandem),
    pcSvtTandemScope: scope,
    pcSvtTandemMode,
    pcSvtTandemClassIds: Array.isArray(rules?.pcSvtTandemClassIds)
      ? rules.pcSvtTandemClassIds
      : [],
    epsMaxSimultaneousCoursesPerField: Math.max(1, Math.min(8, Math.round(
      Number(rules?.epsMaxSimultaneousCoursesPerField ?? DEFAULT_TERRAIN_RULES.epsMaxSimultaneousCoursesPerField),
    ) || DEFAULT_TERRAIN_RULES.epsMaxSimultaneousCoursesPerField)),
    epsHotHourMode,
    institutionRules: normalizeInstitutionRules(rules?.institutionRules),
  };
}

export function getTerrainRules(
  context: Pick<SchedulerContext, "terrainRules">,
): TerrainSchedulingRules {
  return normalizeTerrainRules(context.terrainRules);
}

export function withDefaultTerrainRules<T extends SchedulerContext>(
  context: T,
): T {
  return {
    ...context,
    terrainRules: normalizeTerrainRules(context.terrainRules),
  };
}

export function hasConfiguredRoomType(
  roomType: string | null | undefined,
  context: SchedulerContext,
): boolean {
  if (!roomType) {
    return false;
  }

  return context.rooms.some((room) => room.roomType === roomType);
}

export function canUseOrdinaryRoomFallback(
  roomType: string | null | undefined,
  context: SchedulerContext,
): boolean {
  if (!roomType) {
    return true;
  }

  const rules = getTerrainRules(context);

  if (roomType === "sports_field") {
    // RÃ¨gle mÃ©tier Mon Cahier / ACE : si un terrain EPS est configurÃ©,
    // EPS ne doit jamais Ãªtre envoyÃ© en salle ordinaire. Le fallback ne sert
    // que pour les Ã©tablissements sans terrain dÃ©clarÃ© et seulement si
    // lâ€™admin lâ€™a explicitement autorisÃ©.
    return !hasConfiguredRoomType("sports_field", context) && rules.allowEpsInOrdinaryRoomWhenNoField;
  }

  if (roomType === "pc_lab") {
    return rules.allowPcInOrdinaryRoomWhenNoLab;
  }

  if (roomType === "svt_lab") {
    return rules.allowSvtInOrdinaryRoomWhenNoLab;
  }

  if (roomType === "computer_lab") {
    return rules.allowComputerInOrdinaryRoomWhenNoLab;
  }

  return false;
}

export function isOrdinaryFallbackRoom(roomType: RoomType): boolean {
  return roomType === "ordinary" || roomType === "multipurpose";
}

export function isSharedSportsFieldRoom(
  roomId: string | null | undefined,
  context: SchedulerContext,
): boolean {
  if (!roomId) {
    return false;
  }

  if (!getTerrainRules(context).treatSportsFieldAsSharedResource) {
    return false;
  }

  return context.rooms.some(
    (room) => room.id === roomId && room.roomType === "sports_field",
  );
}


export function getSportsFieldRooms(context: SchedulerContext): Room[] {
  return context.rooms.filter((room) => room.roomType === "sports_field");
}

export function getEpsMaxSimultaneousCoursesPerField(
  context: SchedulerContext,
): number {
  return getTerrainRules(context).epsMaxSimultaneousCoursesPerField;
}

export function getTotalEpsFieldCapacity(context: SchedulerContext): number {
  const fieldCount = getSportsFieldRooms(context).length;
  return fieldCount * getEpsMaxSimultaneousCoursesPerField(context);
}

export function isPcSvtSubject(subjectId: string): boolean {
  const normalized = subjectId.toLowerCase();

  return normalized === "pc" || normalized === "svt";
}

export function isPcSvtTandemEnabledForClass(
  classId: string,
  context: SchedulerContext,
): boolean {
  const rules = getTerrainRules(context);

  if (!rules.enablePcSvtTandem) {
    return false;
  }

  if (rules.pcSvtTandemScope === "all_classes") {
    return true;
  }

  if (rules.pcSvtTandemScope === "selected_classes") {
    return rules.pcSvtTandemClassIds.includes(classId);
  }

  return false;
}

export function getPcSvtTandemMode(context: SchedulerContext): ScienceTandemMode {
  return getTerrainRules(context).pcSvtTandemMode;
}

export function blockBelongsToPcSvtTandem(
  block: LessonBlock,
  context: SchedulerContext,
): boolean {
  return (
    isPcSvtSubject(block.subjectId) &&
    isPcSvtTandemEnabledForClass(block.classId, context)
  );
}

export function isSchoolHalfDayClosed(
  dayIndex: number,
  halfDay: HalfDay,
  context: SchedulerContext,
): boolean {
  const day = context.days.find((item) => item.dayIndex === dayIndex);

  if (!day || !day.isEnabled) {
    return true;
  }

  if (Array.isArray(day.closedHalfDays)) {
    return day.closedHalfDays.includes(halfDay);
  }

  // SÃ©curitÃ© terrain : si lâ€™ancien projet nâ€™a pas encore ce rÃ©glage,
  // on applique le comportement ivoirien le plus courant : mercredi aprÃ¨s-midi fermÃ©.
  return day.dayIndex === 3 && halfDay === "afternoon";
}

function getPeriodsForRawCandidate(
  candidate: CandidateSlot,
  context: SchedulerContext,
): SessionPeriod[] {
  const teachingPeriods = context.periods
    .filter((period) => period.isTeachingPeriod)
    .sort((a, b) => a.periodIndex - b.periodIndex);

  const startIndex = teachingPeriods.findIndex(
    (period) => period.periodIndex === candidate.startPeriodIndex,
  );

  if (startIndex < 0) {
    return [];
  }

  return teachingPeriods.slice(
    startIndex,
    startIndex + Math.max(1, Math.ceil(candidate.durationUnits)),
  );
}


function getOfficialPeriodKeySet(context: SchedulerContext): Set<string> | null {
  if (!Array.isArray(context.availablePeriodKeys) || context.availablePeriodKeys.length === 0) {
    return null;
  }

  return new Set(context.availablePeriodKeys);
}

export function candidateUsesOnlyOfficialPeriods(
  candidate: CandidateSlot,
  context: SchedulerContext,
): boolean {
  const officialKeys = getOfficialPeriodKeySet(context);

  if (!officialKeys) {
    return true;
  }

  const periods = getPeriodsForRawCandidate(candidate, context);
  const expectedCount = Math.max(1, Math.ceil(candidate.durationUnits));

  if (periods.length !== expectedCount) {
    return false;
  }

  return periods.every((period) =>
    officialKeys.has(`${candidate.dayIndex}:${period.periodIndex}`),
  );
}

export function candidateHitsClosedSchoolPeriod(
  candidate: CandidateSlot,
  context: SchedulerContext,
): boolean {
  if (!candidateUsesOnlyOfficialPeriods(candidate, context)) {
    return true;
  }

  const periods = getPeriodsForRawCandidate(candidate, context);

  if (periods.length === 0) {
    return true;
  }

  return periods.some((period) =>
    isSchoolHalfDayClosed(candidate.dayIndex, period.halfDay, context),
  );
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function isEpsSubjectId(subjectId: string, context: SchedulerContext): boolean {
  const subject = context.subjects.find((item) => item.id === subjectId);
  const values = [
    subjectId,
    subject?.id,
    subject?.code,
    subject?.name,
    subject?.shortName,
  ].map(normalizeText);

  return values.some((value) => value === "eps" || value.includes("education physique"));
}

export function isEpsBlock(block: LessonBlock, context: SchedulerContext): boolean {
  if (block.blockType === "eps" || block.roomTypeRequired === "sports_field") {
    return true;
  }

  return isEpsSubjectId(block.subjectId, context);
}

export function getEffectiveRoomTypeRequired(
  block: LessonBlock,
  context: SchedulerContext,
): string | null {
  const explicit = String(block.roomTypeRequired ?? "").trim();

  if (explicit) {
    return explicit;
  }

  // SÃ©curitÃ© absolue : mÃªme si le rÃ©fÃ©rentiel Mon Cahier nâ€™a pas renseignÃ©
  // room_type_required, une matiÃ¨re EPS reconnue doit demander un terrain EPS.
  if (isEpsBlock(block, context)) {
    return "sports_field";
  }

  const subject = context.subjects.find((item) => item.id === block.subjectId);
  const defaultRoomType = String(subject?.defaultRoomType ?? "").trim();

  return defaultRoomType || null;
}

function timeToMinutes(time: string): number {
  const [hoursRaw, minutesRaw] = time.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return 0;
  }

  return hours * 60 + minutes;
}

export function getCandidateTimeRange(
  candidate: CandidateSlot,
  context: SchedulerContext,
): { start: number; end: number; periods: SessionPeriod[] } | null {
  const periods = getPeriodsForRawCandidate(candidate, context);

  if (periods.length === 0) {
    return null;
  }

  return {
    start: timeToMinutes(periods[0].startTime),
    end: timeToMinutes(periods[periods.length - 1].endTime),
    periods,
  };
}


function rulePriorityWeight(priority: InstitutionRulePriority): number {
  if (priority === "hard") return 120000;
  if (priority === "strong") return 42000;
  if (priority === "medium") return 14000;
  return 4500;
}

function getClassForBlock(block: LessonBlock, context: SchedulerContext) {
  return context.classes.find((schoolClass) => schoolClass.id === block.classId) || null;
}

function getSubjectForBlock(block: LessonBlock, context: SchedulerContext) {
  return context.subjects.find((subject) => subject.id === block.subjectId) || null;
}

function valuesMatch(value: string | null | undefined, accepted: string[]): boolean {
  if (accepted.length === 0) return true;
  const normalized = normalizeTextToken(value);
  return accepted.map(normalizeTextToken).includes(normalized);
}

function ruleTargetsBlock(rule: InstitutionSchedulingRule, block: LessonBlock, context: SchedulerContext): boolean {
  if (!rule.enabled) return false;
  if (rule.scope === "all") return true;

  if (rule.scope === "class") {
    return rule.classIds.length === 0 || rule.classIds.includes(block.classId);
  }

  if (rule.scope === "teacher") {
    return rule.teacherIds.length === 0 || rule.teacherIds.includes(block.teacherId);
  }

  if (rule.scope === "level") {
    const schoolClass = getClassForBlock(block, context);
    return valuesMatch(schoolClass?.levelCode, rule.levelCodes);
  }

  if (rule.scope === "subject") {
    const subject = getSubjectForBlock(block, context);
    const accepted = rule.subjectIds;
    if (accepted.length === 0) return true;
    const subjectValues = [block.subjectId, subject?.id, subject?.code, subject?.name, subject?.shortName].map(normalizeTextToken);
    return accepted.map(normalizeTextToken).some((item) => subjectValues.includes(item));
  }

  return true;
}

function ruleHasConcreteTimeWindow(rule: InstitutionSchedulingRule): boolean {
  return Boolean(
    rule.dayIndexes.length > 0 ||
      rule.periodIndexes.length > 0 ||
      rule.halfDays.length > 0 ||
      rule.startTime ||
      rule.endTime
  );
}

function ruleCanBehaveAsCoverageRule(rule: InstitutionSchedulingRule): boolean {
  // Exemple terrain : « avoir cours tous les lundis et vendredis à la première heure ».
  // Ce n'est pas une obligation sur chaque bloc de cours ; c'est une attente de couverture
  // par classe et par jour ciblé. On l'identifie uniquement quand un créneau précis est indiqué.
  return (
    (rule.behavior === "prefer" || rule.behavior === "require") &&
    (rule.scope === "all" || rule.scope === "level" || rule.scope === "class") &&
    rule.dayIndexes.length > 0 &&
    (rule.periodIndexes.length > 0 || Boolean(rule.startTime && rule.endTime))
  );
}

function ruleTargetsClass(rule: InstitutionSchedulingRule, schoolClass: { id: string; levelCode: string }, context: SchedulerContext): boolean {
  if (!rule.enabled) return false;
  if (rule.scope === "all") return true;

  if (rule.scope === "class") {
    return rule.classIds.length === 0 || rule.classIds.includes(schoolClass.id);
  }

  if (rule.scope === "level") {
    return valuesMatch(schoolClass.levelCode, rule.levelCodes);
  }

  // Les règles matière/enseignant sont des règles de placement de bloc, pas des règles de couverture classe.
  void context;
  return false;
}

export function violatesHardInstitutionRule(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
): boolean {
  for (const rule of getActiveInstitutionRules(context)) {
    if (rule.priority !== "hard") continue;
    if (!ruleTargetsBlock(rule, block, context)) continue;
    if (!ruleHasConcreteTimeWindow(rule)) continue;

    const matchesTime = candidateMatchesRuleTime(rule, candidate, context);

    if ((rule.behavior === "forbid" || rule.behavior === "avoid") && matchesTime) {
      return true;
    }

    // Les règles de couverture du type « chaque classe doit avoir cours à telle heure »
    // ne doivent pas être appliquées à chaque bloc, sinon on rendrait le montage impossible.
    if (rule.behavior === "require" && !ruleCanBehaveAsCoverageRule(rule) && !matchesTime) {
      return true;
    }
  }

  return false;
}

function candidateMatchesRuleTime(rule: InstitutionSchedulingRule, candidate: CandidateSlot, context: SchedulerContext): boolean {
  if (rule.dayIndexes.length > 0 && !rule.dayIndexes.includes(candidate.dayIndex)) {
    return false;
  }

  const periods = getPeriodsForRawCandidate(candidate, context);

  if (rule.periodIndexes.length > 0) {
    const periodSet = new Set(periods.map((period) => period.periodIndex));
    if (!rule.periodIndexes.some((periodIndex) => periodSet.has(periodIndex))) {
      return false;
    }
  }

  if (rule.halfDays.length > 0) {
    const halfDaySet = new Set(periods.map((period) => period.halfDay));
    if (!rule.halfDays.some((halfDay) => halfDaySet.has(halfDay))) {
      return false;
    }
  }

  const start = rule.startTime ? timeToMinutes(rule.startTime) : null;
  const end = rule.endTime ? timeToMinutes(rule.endTime) : null;

  if (start !== null || end !== null) {
    const range = getCandidateTimeRange(candidate, context);
    if (!range) return false;
    if (start !== null && range.start < start) return false;
    if (end !== null && range.end > end) return false;
  }

  return true;
}

function candidateTouchesRuleWindow(rule: InstitutionSchedulingRule, candidate: CandidateSlot, context: SchedulerContext): boolean {
  if (rule.dayIndexes.length > 0 && !rule.dayIndexes.includes(candidate.dayIndex)) {
    return false;
  }

  const periods = getPeriodsForRawCandidate(candidate, context);

  if (rule.halfDays.length > 0) {
    const halfDaySet = new Set(periods.map((period) => period.halfDay));
    if (!rule.halfDays.some((halfDay) => halfDaySet.has(halfDay))) {
      return false;
    }
  }

  if (rule.periodIndexes.length > 0) {
    const periodSet = new Set(periods.map((period) => period.periodIndex));
    if (!rule.periodIndexes.some((periodIndex) => periodSet.has(periodIndex))) {
      return false;
    }
  }

  return Boolean(
    rule.dayIndexes.length > 0 ||
      rule.halfDays.length > 0 ||
      rule.periodIndexes.length > 0 ||
      rule.startTime ||
      rule.endTime,
  );
}

export function getActiveInstitutionRules(context: SchedulerContext): InstitutionSchedulingRule[] {
  return getTerrainRules(context).institutionRules.filter((rule) => rule.enabled);
}

export function getInstitutionRuleCandidatePenalty(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
): number {
  let penalty = 0;

  for (const rule of getActiveInstitutionRules(context)) {
    if (!ruleTargetsBlock(rule, block, context)) continue;

    const weight = rulePriorityWeight(rule.priority);
    const matchesTime = candidateMatchesRuleTime(rule, candidate, context);

    if (rule.behavior === "forbid") {
      if (matchesTime) penalty += weight;
      continue;
    }

    if (rule.behavior === "avoid") {
      if (matchesTime) penalty += Math.round(weight * 0.55);
      continue;
    }

    if (rule.behavior === "require") {
      if (ruleCanBehaveAsCoverageRule(rule)) {
        penalty += matchesTime ? -Math.round(weight * 0.10) : Math.round(weight * 0.18);
      } else {
        penalty += matchesTime ? -Math.round(weight * 0.04) : weight;
      }
      continue;
    }

    // prefer : on encourage la bonne fenêtre, sans transformer une préférence souple en interdiction générale.
    if (matchesTime) {
      penalty -= Math.round(weight * 0.12);
    } else if (candidateTouchesRuleWindow(rule, candidate, context)) {
      penalty += Math.round(weight * 0.18);
    }
  }

  return penalty;
}

function placementMatchesRuleWindow(
  placement: Placement,
  rule: InstitutionSchedulingRule,
  context: SchedulerContext,
): boolean {
  return candidateMatchesRuleTime(rule, getCandidateForPlacement(placement), context);
}

export function getInstitutionCoverageCandidatePenalty(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
  placements: Placement[],
): number {
  let penalty = 0;
  const schoolClass = getClassForBlock(block, context);
  if (!schoolClass) return 0;

  for (const rule of getActiveInstitutionRules(context)) {
    if (!ruleCanBehaveAsCoverageRule(rule)) continue;
    if (!ruleTargetsClass(rule, schoolClass, context)) continue;
    if (!rule.dayIndexes.includes(candidate.dayIndex)) continue;

    const alreadyCovered = placements.some(
      (placement) =>
        placement.classId === block.classId &&
        placement.dayIndex === candidate.dayIndex &&
        placementMatchesRuleWindow(placement, rule, context),
    );

    if (alreadyCovered) continue;

    const weight = rulePriorityWeight(rule.priority);
    if (candidateMatchesRuleTime(rule, candidate, context)) {
      penalty -= rule.behavior === "require" ? Math.round(weight * 0.45) : Math.round(weight * 0.30);
    } else {
      penalty += rule.behavior === "require" ? Math.round(weight * 0.16) : Math.round(weight * 0.08);
    }
  }

  return penalty;
}

export function getInstitutionCoverageRuleViolations(
  placements: Placement[],
  context: SchedulerContext,
): Array<{ rule: InstitutionSchedulingRule; classId: string; dayIndex: number }> {
  const violations: Array<{ rule: InstitutionSchedulingRule; classId: string; dayIndex: number }> = [];

  for (const rule of getActiveInstitutionRules(context)) {
    if (!ruleCanBehaveAsCoverageRule(rule)) continue;

    const targetClasses = context.classes.filter((schoolClass) => ruleTargetsClass(rule, schoolClass, context));

    for (const schoolClass of targetClasses) {
      for (const dayIndex of rule.dayIndexes) {
        const covered = placements.some(
          (placement) =>
            placement.classId === schoolClass.id &&
            placement.dayIndex === dayIndex &&
            placementMatchesRuleWindow(placement, rule, context),
        );

        if (!covered) {
          violations.push({ rule, classId: schoolClass.id, dayIndex });
        }
      }
    }
  }

  return violations;
}

function getCandidateForPlacement(placement: Placement): CandidateSlot {
  return {
    dayIndex: placement.dayIndex,
    startPeriodIndex: placement.startPeriodIndex,
    durationUnits: placement.durationUnits,
    roomId: placement.roomId ?? null,
  };
}

export function getInstitutionRuleViolationsForPlacement(
  placement: Placement,
  block: LessonBlock,
  context: SchedulerContext,
): InstitutionSchedulingRule[] {
  const candidate = getCandidateForPlacement(placement);
  const violations: InstitutionSchedulingRule[] = [];

  for (const rule of getActiveInstitutionRules(context)) {
    if (!ruleTargetsBlock(rule, block, context)) continue;

    const matchesTime = candidateMatchesRuleTime(rule, candidate, context);

    if ((rule.behavior === "forbid" || rule.behavior === "avoid") && matchesTime) {
      violations.push(rule);
      continue;
    }

    if (rule.behavior === "require" && !matchesTime) {
      violations.push(rule);
      continue;
    }

    if (rule.behavior === "prefer" && !matchesTime && candidateTouchesRuleWindow(rule, candidate, context)) {
      violations.push(rule);
    }
  }

  return violations;
}

export function isAfternoonEpsCandidate(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
): boolean {
  if (!isEpsBlock(block, context)) {
    return false;
  }

  const range = getCandidateTimeRange(candidate, context);

  return Boolean(range && range.start >= 15 * 60);
}

export function isEpsCandidateFavorable(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
): boolean {
  if (!isEpsBlock(block, context)) {
    return true;
  }

  const range = getCandidateTimeRange(candidate, context);

  if (!range) {
    return false;
  }

  const ten = 10 * 60;
  const fifteen = 15 * 60;
  const eighteen = 18 * 60;

  // Terrain : EPS favorable le matin avant 10h.
  if (range.end <= ten) {
    return true;
  }

  // Terrain : lâ€™aprÃ¨s-midi, on accepte seulement les crÃ©neaux qui commencent
  // Ã  15h ou aprÃ¨s. Un EPS placÃ© avant 15h lâ€™aprÃ¨s-midi est refusÃ©.
  return range.start >= fifteen && range.end <= eighteen;
}

