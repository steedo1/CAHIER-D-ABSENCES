export type CycleCode = "college" | "lycee";

export type LevelDefinition = {
  code: string;
  label: string;
  cycle: CycleCode;
  displayOrder: number;
};

export type SubjectDefinition = {
  id: string;
  code: string;
  name: string;
  shortName: string;
  category:
    | "scientific"
    | "literary"
    | "language"
    | "sport"
    | "art"
    | "civic"
    | "technical"
    | "other";
  isHeavy: boolean;
  defaultRoomType?: string | null;
  color?: string;
  displayOrder: number;
};

export type DefaultSubjectHour = {
  levelCode: string;
  seriesCode?: string | null;
  subjectId: string;
  weeklyUnits: number;
  splitPattern: string;
  isOptional?: boolean;
  roomTypeRequired?: string | null;
  notes?: string;
};