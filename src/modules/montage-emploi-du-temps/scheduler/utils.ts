import type { BlockType, ServiceAssignment } from "./types";

export function createId(prefix = "id"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function parseSplitPattern(pattern: string): number[] {
  const cleaned = pattern
    .replace(/\s/g, "")
    .replace(/\(/g, "")
    .replace(/\)/g, "")
    .replace(/h/g, ".")
    .replace(/H/g, ".");

  if (!cleaned) {
    return [];
  }

  return cleaned
    .split("+")
    .map((part: string) => part.trim())
    .filter((part: string) => part.length > 0)
    .map((part: string) => {
      if (part === "30") return 0.5;
      if (part === "1.30") return 1.5;
      if (part === "2.30") return 2.5;

      const value = Number(part.replace(",", "."));

      if (Number.isNaN(value) || value <= 0) {
        throw new Error(`Découpage horaire invalide : ${pattern}`);
      }

      return value;
    });
}

export function inferBlockType(
  assignment: ServiceAssignment,
  durationUnits: number,
): BlockType {
  const roomType = assignment.roomTypeRequired;

  if (assignment.subjectId.toLowerCase().includes("eps")) {
    return "eps";
  }

  if (roomType === "sports_field") {
    return "eps";
  }

  if (roomType === "pc_lab" || roomType === "svt_lab") {
    return "tp";
  }

  if (durationUnits >= 2) {
    return "double";
  }

  return "normal";
}

export function sumDurations(values: number[]): number {
  return values.reduce((total: number, value: number) => total + value, 0);
}