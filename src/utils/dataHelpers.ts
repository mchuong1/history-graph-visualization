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
      // Spread all fields from the source entry (preserves imageSrc, audioSrc, artist, etc.)
      ...(t ?? f!),
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
  const fmt = dataset.dateFormat ?? 'year';

  return dates.map((date) => ({
    date,
    label: formatDateLabel(date, fmt),
    entries: getTopNForDate(dataset, date, topN),
  }));
}

/**
 * Builds a TimeSnapshot array with synthetic interpolated snapshots inserted
 * between each pair of real snapshots, so values visibly count between dates.
 *
 * @param syntheticSteps - number of synthetic sub-steps between each real date pair
 */
export function buildExpandedTimeSnapshots(
  dataset: Dataset,
  topN: number,
  syntheticSteps: number = 7
): TimeSnapshot[] {
  const real = buildTimeSnapshots(dataset, topN);
  if (real.length === 0) return [];

  const expanded: TimeSnapshot[] = [];

  for (let i = 0; i < real.length; i++) {
    // Push the real snapshot
    expanded.push({ ...real[i], isSynthetic: false });

    // Insert synthetic steps between this and the next real snapshot
    if (i < real.length - 1) {
      const from = real[i];
      const to = real[i + 1];

      for (let step = 1; step <= syntheticSteps; step++) {
        const progress = step / (syntheticSteps + 1);
        const interpolated = interpolateSnapshots(from.entries, to.entries, progress);
        expanded.push({
          date: from.date,
          label: from.label,
          entries: interpolated,
          isSynthetic: true,
        });
      }
    }
  }

  return expanded;
}

/**
 * Formats an ISO date string as a human-readable label.
 * @param dateFormat - 'year' returns e.g. "2020"; 'month-year' returns e.g. "Jan 2020"
 */
export function formatDateLabel(
  date: string,
  dateFormat: 'year' | 'month-year' = 'year'
): string {
  const d = new Date(date);
  if (dateFormat === 'month-year') {
    return d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
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
