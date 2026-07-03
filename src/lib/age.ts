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
  const birth = new Date(normalized);
  if (Number.isNaN(birth.getTime())) return 0;

  let age = asOf.getFullYear() - birth.getFullYear();
  const monthDiff = asOf.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && asOf.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

export function seasonStartDate(seasonLabel: string = PROJECTION_SEASON): Date {
  const startYear = Number(seasonLabel.split("-")[0]);
  return new Date(startYear, 9, 1); // Oct 1
}
