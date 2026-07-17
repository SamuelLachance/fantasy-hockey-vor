import { PROJECTION_SEASON } from "./nhl-api";

/** Parse NHL/CapWages birth strings: YYYY-MM-DD or "Jan. 12, 2002" */
export function parseBirthDate(raw: string): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const months: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };

  const m = raw.match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return null;

  const month = months[m[1].slice(0, 3).toLowerCase()];
  if (month === undefined) return null;

  const day = String(m[2]).padStart(2, "0");
  const monthStr = String(month + 1).padStart(2, "0");
  return `${m[3]}-${monthStr}-${day}`;
}

export function ageFromBirthDate(
  birthDate: string,
  asOf: Date = new Date(),
): number {
  const normalized = parseBirthDate(birthDate) ?? birthDate;
  // Compare calendar components directly: new Date("YYYY-MM-DD") parses as
  // UTC midnight, so local-time getters would shift the birthday one day
  // early in every negative-UTC-offset timezone.
  const iso = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  let year: number, month: number, day: number;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]) - 1;
    day = Number(iso[3]);
  } else {
    const birth = new Date(normalized);
    if (Number.isNaN(birth.getTime())) return 0;
    year = birth.getFullYear();
    month = birth.getMonth();
    day = birth.getDate();
  }

  let age = asOf.getFullYear() - year;
  const monthDiff = asOf.getMonth() - month;
  if (monthDiff < 0 || (monthDiff === 0 && asOf.getDate() < day)) {
    age--;
  }
  return age;
}

export function seasonStartDate(seasonLabel: string = PROJECTION_SEASON): Date {
  const startYear = Number(seasonLabel.split("-")[0]);
  return new Date(startYear, 9, 1); // Oct 1
}
