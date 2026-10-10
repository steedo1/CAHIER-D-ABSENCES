import { parsePhoneNumberFromString } from "libphonenumber-js/max";

/** CI local numbers retain their initial zero (01/05/07). */
export function parentConnectPhone(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40 || !/^[+\d\s().-]+$/.test(value.trim())) return null;
  const raw = value.trim().replace(/^00/, "+");
  const phone = parsePhoneNumberFromString(raw, "CI");
  return phone?.isValid() ? phone.number : null;
}
