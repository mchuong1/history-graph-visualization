import type { DataEntry, TimeSnapshot, Dataset } from "../types/index";

/**
 * Returns a sorted list of unique dates from the dataset.
 */
export function getUniqueDates(dataset: Dataset): string[] {
  const dates = new Set(dataset.entries.map((e) => e.date));
  return Array.from(dates).sort();
}

/**
 * Returns the top-N entries for a given date, sorted descending by value.
 */
export function getTopNForDate(
  dataset: Dataset,
  date: string,
  topN: number
): DataEntry[] {
  return dataset.entries
    .filter((e) => e.date === date)
    .sort((a, b) => b.value - a.value)
    .slice(0, topN);
}

/**
 * Interpolates entry values between two snapshots for smooth animation.
 * progress is a number between 0 (start) and 1 (end).
 */
export function interpolateSnapshots(
  from: DataEntry[],
  to: DataEntry[],
  progress: number
): DataEntry[] {
  // Build a map of all names across both snapshots
  const names = new Set([...from.map((e) => e.name), ...to.map((e) => e.name)]);

  const fromMap = new Map(from.map((e) => [e.name, e]));
  const toMap = new Map(to.map((e) => [e.name, e]));

  const interpolated: DataEntry[] = [];

  names.forEach((name) => {
    const f = fromMap.get(name);
    const t = toMap.get(name);

    const fromValue = f?.value ?? 0;
    const toValue = t?.value ?? 0;
    const interpolatedValue = fromValue + (toValue - fromValue) * progress;

    interpolated.push({
      name,
      value: interpolatedValue,
      date: t?.date ?? f?.date ?? "",
      color: t?.color ?? f?.color,
    });
  });

  return interpolated.sort((a, b) => b.value - a.value);
}

/**
 * Converts the raw dataset into an array of TimeSnapshot objects, each with the top-N entries.
 */
export function buildTimeSnapshots(
  dataset: Dataset,
  topN: number
): TimeSnapshot[] {
  const dates = getUniqueDates(dataset);

  return dates.map((date) => ({
    date,
    label: formatDateLabel(date),
    entries: getTopNForDate(dataset, date, topN),
  }));
}

/**
 * Formats an ISO date string as a human-readable label.
 */
export function formatDateLabel(date: string): string {
  const d = new Date(date);
  return d.getUTCFullYear().toString();
}

/**
 * Returns a colour for an entity, using its stored colour or a fallback from the colour scheme.
 */
export function getColor(
  entry: DataEntry,
  fallbackColors: string[],
  index: number
): string {
  if (entry.color) return entry.color;
  return fallbackColors[index % fallbackColors.length] ?? "#8884d8";
}

/**
 * Eases progress using a cubic ease-in-out curve.
 */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}
