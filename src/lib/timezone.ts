// src/lib/timezone.ts
export function nowInTZ(tz: string): Date {
  // Renvoie un Date "horloge locale du tz" (en base JS) – suffisant pour comparer des minutes.
  const s = new Date().toLocaleString('en-US', { timeZone: tz });
  return new Date(s);
}

export function toTZ(dateISO: string | Date, tz: string): Date {
  const d = (typeof dateISO === 'string') ? new Date(dateISO) : dateISO;
  const s = d.toLocaleString('en-US', { timeZone: tz });
  return new Date(s);
}

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function parseHHMM(str: string): number {
  // "HH:MM[:SS]" -> minutes
  const [h, m] = String(str).slice(0,5).split(':').map(n => parseInt(n, 10));
  return (h * 60 + (m || 0)) | 0;
}
