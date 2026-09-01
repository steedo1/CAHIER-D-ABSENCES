export type StudentIdentity = {
  first_name: string | null;
  last_name: string | null;
};

export function studentIdentityWords(value: string | null | undefined): string[] {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function studentMatchesIdentity(
  student: StudentIdentity,
  identity: { lastName: string; firstName: string },
): boolean {
  const requestedLastName = studentIdentityWords(identity.lastName).join(" ");
  const storedLastName = studentIdentityWords(student.last_name).join(" ");
  const requestedFirstNames = studentIdentityWords(identity.firstName);
  const storedFirstNames = new Set(studentIdentityWords(student.first_name));

  if (!requestedLastName || requestedFirstNames.length === 0) return false;

  return (
    storedLastName === requestedLastName &&
    requestedFirstNames.every((firstName) => storedFirstNames.has(firstName))
  );
}

// Une clé complète pour détecter un doublon potentiel, distincte de la
// recherche partielle qui accepte un seul prénom.
export function studentFullIdentityKey(value: string | null | undefined): string {
  return studentIdentityWords(value).join(" ");
}

export function safeEnrollmentEndDate(
  startDate: string | null | undefined,
  today: string,
): string {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(today)) {
    throw new Error("invalid_today");
  }

  const normalizedStartDate = String(startDate ?? "").slice(0, 10);
  if (!datePattern.test(normalizedStartDate)) return today;

  return normalizedStartDate > today ? normalizedStartDate : today;
}
