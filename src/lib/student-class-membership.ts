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

export function studentFullNameMatchRank(student: StudentIdentity, fullName: string): number {
  const requested = studentIdentityWords(fullName);
  const surname = studentIdentityWords(student.last_name);
  const firstNames = new Set(studentIdentityWords(student.first_name));
  if (!surname.length || requested.length <= surname.length) return 0;

  const storedSurname = surname.join(" ");
  let rank = 0;
  for (const surnameFirst of [true, false]) {
    const split = surnameFirst ? surname.length : requested.length - surname.length;
    const requestedSurname = (surnameFirst ? requested.slice(0, split) : requested.slice(split)).join(" ");
    const requestedFirstNames = surnameFirst ? requested.slice(split) : requested.slice(0, split);
    if (!requestedFirstNames.every((name) => firstNames.has(name))) continue;
    if (requestedSurname === storedSurname) return 2;
    // Offer a possible spelling variant only with an exact given name.
    if (Math.min(storedSurname.length, requestedSurname.length) < 5 ||
        Math.abs(storedSurname.length - requestedSurname.length) > 1) continue;
    let mismatch = 0;
    while (mismatch < storedSurname.length && storedSurname[mismatch] === requestedSurname[mismatch]) mismatch++;
    const storedSuffix = storedSurname.slice(mismatch + (storedSurname.length >= requestedSurname.length ? 1 : 0));
    const requestedSuffix = requestedSurname.slice(mismatch + (requestedSurname.length >= storedSurname.length ? 1 : 0));
    if (storedSuffix === requestedSuffix) rank = 1;
  }
  return rank;
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
