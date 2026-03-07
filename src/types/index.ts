/**
 * Represents a single data entry for one entity at a specific point in time.
 */
export interface DataEntry {
  /** The name / label of the entity (e.g. "JavaScript", "Python") */
  name: string;
  /** Numeric value used to rank entities (e.g. usage percentage, count) */
  value: number;
  /** ISO date string representing the time period (e.g. "2020-01-01") */
  date: string;
  /** Optional hex color for this entity */
  color?: string;
}

/**
 * A snapshot of the top-N entities for a single time period.
 */
export interface TimeSnapshot {
  date: string;
  label: string;
  entries: DataEntry[];
}

/**
 * The full dataset used by the visualisation.
 */
export interface Dataset {
  title: string;
  valueLabel: string;
  entries: DataEntry[];
}

/**
 * Props passed to the Remotion composition.
 * Extends Record<string, unknown> to satisfy Remotion's Composition<Props> constraint.
 */
export interface BarChartRaceProps extends Record<string, unknown> {
  dataset: Dataset;
  topN: number;
  colorScheme: string[];
}
