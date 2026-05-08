export type HalfDay = "morning" | "afternoon" | "evening";


export type ScienceTandemScope = "disabled" | "all_classes" | "selected_classes";
export type ScienceTandemMode = "parallel" | "rotation";

export type EpsHotHourMode = "disabled" | "soft" | "strict";

export type TerrainSchedulingRules = {
  /** Règle terrain dure : un bloc de plusieurs créneaux ne traverse pas une récréation. */
  avoidBreakInsideMultiPeriodBlock: boolean;

  /** Option terrain : activer la préparation du tandem P.C / SVT lorsque l’établissement le pratique. */
  enablePcSvtTandem: boolean;
  pcSvtTandemScope: ScienceTandemScope;
  /**
   * Mode de montage P.C/SVT.
   * - parallel : modèle ACE par défaut. P.C et SVT occupent le même créneau en demi-groupes.
   * - rotation : deux phases successives dans la même demi-journée.
   */
  pcSvtTandemMode: ScienceTandemMode;
  pcSvtTandemClassIds: string[];

  /** Fallback terrain : si la ressource spécialisée n’existe pas, le cours peut se faire en salle ordinaire. */
  allowPcInOrdinaryRoomWhenNoLab: boolean;
  allowSvtInOrdinaryRoomWhenNoLab: boolean;
  allowEpsInOrdinaryRoomWhenNoField: boolean;
  allowComputerInOrdinaryRoomWhenNoLab: boolean;

  /**
   * EPS : le terrain est une zone pédagogique, pas une salle de classe classique.
   * Tous les terrains EPS sont partageables, mais avec une capacité réaliste.
   */
  treatSportsFieldAsSharedResource?: boolean;

  /** Nombre maximum de cours EPS simultanés acceptés sur un seul terrain. */
  epsMaxSimultaneousCoursesPerField: number;

  /** EPS : éviter les heures chaudes, en tenant compte des créneaux réels de l’établissement. */
  epsHotHourMode: EpsHotHourMode;

  /** Règles de qualité, non administratives : elles orientent le score sans imposer de quantum. */
  avoidStudentGaps: boolean;
  avoidTeacherGaps: boolean;
  avoidSingleHourReturn: boolean;
  avoidHeavySubjectsBackToBack: boolean;
  avoidSameSubjectSameDay: boolean;
  balanceHalfDays: boolean;
  preferMainClassRoom: boolean;
};

export type BlockType =
  | "normal"
  | "double"
  | "tp"
  | "half_group"
  | "tandem"
  | "eps";

export type PlacementMode = "auto" | "manual";

export type RuleSeverity = "hard" | "soft";

export type SchoolClass = {
  id: string;
  name: string;
  shortName: string;
  levelCode: string;
  seriesCode?: string | null;
  displayOrder: number;
};

export type Subject = {
  id: string;
  code: string;
  name: string;
  shortName: string;
  isHeavy: boolean;
  defaultRoomType?: string | null;
};

export type Teacher = {
  id: string;
  fullName: string;
  shortName?: string | null;
  maxWeeklyUnits?: number | null;
};

export type Room = {
  id: string;
  name: string;
  roomType:
    | "ordinary"
    | "pc_lab"
    | "svt_lab"
    | "computer_lab"
    | "sports_field"
    | "multipurpose"
    | "administrative";
};

export type SessionDay = {
  dayIndex: number;
  label: string;
  isEnabled: boolean;
  /** Demi-journées fermées pour tout l’établissement, ex. mercredi après-midi. */
  closedHalfDays?: HalfDay[];
};

export type SessionPeriod = {
  periodIndex: number;
  label: string;
  startTime: string;
  endTime: string;
  halfDay: HalfDay;
  isTeachingPeriod: boolean;
  isBreakAfter: boolean;
};

export type ClassRoomPreference = {
  classId: string;
  roomId: string;
  priority: number;
  usageType: "main" | "alternative" | "specialized";
  isAllowed: boolean;
};

export type TeacherUnavailability = {
  teacherId: string;
  dayIndex: number;
  periodIndex?: number | null;
  halfDay?: HalfDay | null;
  constraintType: "strict" | "preference";
  reason?: string | null;
};

export type ServiceAssignment = {
  id: string;
  teacherId: string;
  classId: string;
  subjectId: string;
  weeklyUnits: number;
  splitPattern: string;
  roomTypeRequired?: string | null;
};

export type LessonBlock = {
  id: string;
  serviceAssignmentId: string;
  classId: string;
  teacherId: string;
  subjectId: string;
  durationUnits: number;
  blockOrder: number;
  blockType: BlockType;
  roomTypeRequired?: string | null;
  status: "pending" | "placed" | "unplaced" | "locked";
};

export type CandidateSlot = {
  dayIndex: number;
  startPeriodIndex: number;
  durationUnits: number;
  roomId?: string | null;
};

export type Placement = {
  id: string;
  lessonBlockId: string;
  classId: string;
  teacherId: string;
  subjectId: string;
  roomId?: string | null;
  dayIndex: number;
  startPeriodIndex: number;
  durationUnits: number;
  placedBy: PlacementMode;
  score?: number;
  /** Groupe logique pour afficher et contrôler un vrai tandem P.C/SVT. */
  tandemGroupId?: string | null;
  tandemRole?: "pc" | "svt" | null;
  tandemMode?: ScienceTandemMode | null;
  /** Durée réelle de la phase P.C ou SVT, utile quand une rotation occupe plus de créneaux. */
  tandemPhaseDurationUnits?: number | null;
};

export type GenerationWarning = {
  id: string;
  severity: "info" | "warning" | "error" | "critical";
  warningType: string;
  message: string;
  classId?: string | null;
  teacherId?: string | null;
  roomId?: string | null;
  lessonBlockId?: string | null;
};

export type SchedulerContext = {
  days: SessionDay[];
  periods: SessionPeriod[];
  classes: SchoolClass[];
  rooms: Room[];
  teachers: Teacher[];
  subjects: Subject[];
  serviceAssignments: ServiceAssignment[];
  roomPreferences: ClassRoomPreference[];
  teacherUnavailability: TeacherUnavailability[];
  terrainRules?: TerrainSchedulingRules;
};

export type SchedulerResult = {
  placements: Placement[];
  unplacedBlocks: LessonBlock[];
  warnings: GenerationWarning[];
  globalScore: number;
};