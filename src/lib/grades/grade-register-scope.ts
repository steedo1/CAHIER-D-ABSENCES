/** Le primaire suit les évaluations de l'année, sans trimestre obligatoire. */
export function isPrimaryGradeRegisterClass(
  row: { level?: string | null; label?: string | null } | null | undefined,
): boolean {
  const level = String(row?.level || row?.label || "").trim();
  return /^(?:CP[12]|CE[12]|CM[12])(?:$|[\s—-])/i.test(level);
}
