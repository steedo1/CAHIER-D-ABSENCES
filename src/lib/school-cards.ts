import { EPC_DIMBOKRO_CODE } from "./school-student-programs";

export const CARD_WIDTH_MM = 85.6;
export const CARD_HEIGHT_MM = 54;
export const CARDS_PER_SHEET = 10;
export const CARD_PDF_BATCH = 100;
export const SCHOOL_CARD_FOOTER = "Mon Cahier par Nexa Digital SARL · www.mon-cahier.com";
export const CARD_READ_ROLES = ["admin", "super_admin", "file_correspondent", "educator"] as const;
export const CARD_WRITE_ROLES = ["admin", "super_admin"] as const;
export const CARD_SLOTS = ["general", "french", "arabic"] as const;
export type CardSlot = typeof CARD_SLOTS[number];
export type CardAsset = { original: string; processed: string; updatedAt: string };
export type CardConfiguration = {
  enabled: boolean;
  signatures: Partial<Record<CardSlot, CardAsset>>;
  stamps?: Partial<Record<CardSlot, CardAsset>>;
  automaticSignature: boolean;
  // Separate choices; existing bulletin/attestation engines are untouched.
  documentPolicies: { cards: boolean; bulletins: false; attestations: false; other: false };
};
export function defaultCardConfiguration(): CardConfiguration {
  return { enabled: true, signatures: {}, stamps: {}, automaticSignature: false,
    documentPolicies: { cards: false, bulletins: false, attestations: false, other: false } };
}
export type CardSchool = {
  id: string; code?: string | null; name: string; phone: string | null; logo_url: string | null;
  country_name: string | null; country_motto: string | null; ministry_name: string | null;
  head_name: string | null; head_title: string | null;
};
export function usesEpcSchoolCardLayout(school: Pick<CardSchool, "code">) {
  return school.code === EPC_DIMBOKRO_CODE;
}

export const EPC_CARD_WATERMARK_OPACITY = 0.16;
export const EPC_CARD_USAGE = "Carte personnelle, à présenter pour les démarches scolaires et administratives.";
export const EPC_CARD_REPRODUCTION = "Toute reproduction ou utilisation frauduleuse est interdite.";
export const EPC_CARD_DIRECTOR = {
  french: "Directeur des études françaises",
  arabic: "Directeur des études arabes",
} as const;

export type CardYear = { code: string; start_date: string; end_date: string; is_current: boolean };
export type CardClass = { id: string; label: string; level: string | null; academic_year: string };
export type SchoolCard = {
  enrollmentId: string; studentId: string; classId: string; year: string;
  name: string; matricule: string; birthdate: string; birthPlace: string; gender: string;
  classLabel: string; level: string; classes?: CardTeachingClass[]; tracks: string[]; cardTrack?: CardSlot | null; photoUrl: string | null;
  revoked: boolean; warnings: string[];
};
export type CardTeachingClass = { id: string; label: string; level: string; track: CardSlot | null };

export function schoolCardClasses(card: Pick<SchoolCard, "classId" | "classLabel" | "level" | "cardTrack" | "classes">) {
  return card.classes ?? [{ id: card.classId, label: card.classLabel, level: card.level, track: card.cardTrack ?? null }];
}

export type PreparedCard = SchoolCard & {
  token: string; verificationUrl: string; fingerprint: string;
  signatureSlot: CardSlot | null; signatoryName: string;
};
// Official source checked 2026-10-25: education.gouv.ci/index.php/Flash/details/46
// Decree 2026-509 (2026-08-05). Only card headers change, never old documents.
export function schoolCardMinistry(school: Pick<CardSchool, "country_name" | "ministry_name">, year: string) {
  const country = (school.country_name || "Côte d’Ivoire").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  const ministry = school.ministry_name || "";
  const normalized = ministry.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  if (country.includes("cotedivoire") && Number(year.slice(0,4)) >= 2026 && (!ministry || normalized === "ministeredeleducationnationaleetdelalphabetisation")) {
    return "Ministère de l’Éducation Nationale, de l’Alphabétisation et de l’Enseignement Technique";
  }
  return ministry;
}
export type CardRoster = {
  school: CardSchool; years: CardYear[]; year: string; classes: CardClass[];
  items: SchoolCard[]; configuration: CardConfiguration; revision: number;
  canConfigure: boolean; nextOffset: number | null;
  signatureImages: Partial<Record<CardSlot, string>>;
  stampImages?: Partial<Record<CardSlot, string>>;
};
export function cardWarnings(row: Pick<SchoolCard, "name" | "matricule" | "birthdate" | "birthPlace" | "gender" | "photoUrl">) {
  return [[row.name, "Nom absent"], [row.matricule, "Matricule absent"],
    [row.birthdate, "Date de naissance absente"], [row.birthPlace, "Lieu de naissance absent"],
    [row.gender, "Sexe absent"], [row.photoUrl, "Photo absente"]]
    .filter(([value]) => !value).map(([, warning]) => warning as string);
}
/** A bilingual pupil follows two programs, but each single-track class may
 * authorize its own director. Never infer a track from a class label. */
export function cardTeachingTrackForClass(studentTracks: string[], classTracks: string[]): CardSlot | null {
  if (classTracks.length === 1 && (classTracks[0] === "french" || classTracks[0] === "arabic"))
    return studentTracks.includes(classTracks[0]) ? classTracks[0] : null;
  return studentTracks.length === 1 && (studentTracks[0] === "french" || studentTracks[0] === "arabic")
    ? studentTracks[0] : null;
}
export function signatureSlotForTracks(tracks: string[], bilingual: boolean): CardSlot | null {
  if (!bilingual) return "general";
  // Do not guess a director from the class label, UI filter or student name.
  return tracks.length === 1 && (tracks[0] === "french" || tracks[0] === "arabic") ? tracks[0] : null;
}
export function cardSheetPosition(index: number, side: "front" | "back", flip: "long" | "short" = "long") {
  const column = index % 2, row = Math.floor(index / 2);
  return { x: 16.9 + (side === "back" && flip === "long" ? 1 - column : column) * 90.6,
    y: 5.5 + (side === "back" && flip === "short" ? 4 - row : row) * 58 };
}
