type GeneralLevel = {
  grade: string;
  series: string[];
};

type LevelClass = {
  level?: unknown;
  label?: unknown;
  name?: unknown;
  official_track_code?: unknown;
};

function compact(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\bet\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function parseSeries(value: string): string[] | null {
  if (!value || /^\d+$/.test(value)) return [];
  // C1/D2 are class divisions; A1/A2 are distinct official tracks.
  if (/^[a-z](?:\d+)?$/.test(value)) {
    const track = /^a[12]$/.test(value) ? value : value[0];
    return [track];
  }
  if (!/^(?:a[12]?|[b-z])+$/.test(value)) return null;
  return value.match(/a[12]?|[b-z]/g) || [];
}

function parseLevel(value: unknown): GeneralLevel | null {
  const raw = compact(value);
  const lower: Array<[string, RegExp]> = [
    ["6e", /^(?:sixieme|6eme|6e)(\d*)$/],
    ["5e", /^(?:cinquieme|5eme|5e)(\d*)$/],
    ["4e", /^(?:quatrieme|4eme|4e)(\d*)$/],
    ["3e", /^(?:troisieme|3eme|3e)(\d*)$/],
  ];
  for (const [grade, expression] of lower) {
    if (expression.test(raw)) return { grade, series: [] };
  }

  const upper: Array<[string, RegExp]> = [
    ["2nde", /^(?:secondes?|2nde|2nd|2de|2eme|2)(.*)$/],
    ["1ere", /^(?:premieres?|1ere|1re|1er|1)(.*)$/],
    ["tle", /^(?:terminales?|tles?|t)(.*)$/],
  ];
  for (const [grade, expression] of upper) {
    const match = raw.match(expression);
    if (!match) continue;
    const series = parseSeries(match[1]);
    return series === null ? null : { grade, series };
  }
  return null;
}

function classLevel(row: LevelClass): GeneralLevel | null {
  // The official track disambiguates labels such as 1A1 (division 1 of A2).
  const official = parseLevel(row?.official_track_code);
  if (official) return official;
  const level = parseLevel(row?.level);
  if (level?.series.length) return level;
  const label = parseLevel(row?.label || row?.name);
  if (level && label?.grade === level.grade && label.series.length) return label;
  return level || label;
}

export function matchesTextbookGeneralLevel(
  progression: { level?: unknown; series?: unknown },
  row: LevelClass,
) {
  const raw = compact(progression?.level);
  if (!raw) return false;

  const expected = parseLevel(progression?.level);
  const actual = classLevel(row);
  if (!expected || !actual) {
    return raw === compact(row?.level) || raw === compact(row?.label || row?.name);
  }
  if (expected.grade !== actual.grade) return false;

  const series = expected.series.length
    ? expected.series
    : parseSeries(compact(progression?.series));
  if (series === null) return false;
  if (!series.length) return true;
  return series.some((track) =>
    actual.series.some(
      (candidate) => candidate === track || (track === "a" && /^a[12]$/.test(candidate)),
    ),
  );
}
