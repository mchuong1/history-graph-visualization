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
  /** Optional URL for a short audio clip to play while this entry is #1 */
  audioSrc?: string;
}

/**
 * A snapshot of the top-N entities for a single time period.
 */
export interface TimeSnapshot {
  date: string;
  label: string;
  entries: DataEntry[];
  /** True for interpolated sub-steps inserted between real data dates */
  isSynthetic?: boolean;
}

/**
 * The full dataset used by the visualisation.
 */
export interface Dataset {
  title: string;
  valueLabel: string;
  entries: DataEntry[];
  /** Controls how snapshot date labels are formatted. Defaults to 'year'. */
  dateFormat?: 'year' | 'month-year';
}

/**
 * Props passed to the Remotion composition.
 * Extends Record<string, unknown> to satisfy Remotion's Composition<Props> constraint.
 */
export interface BarChartRaceProps extends Record<string, unknown> {
  dataset: Dataset;
  topN: number;
  colorScheme: string[];
  /** Override the hold-phase frame count for real snapshots (default: 60) */
  holdFramesOverride?: number;
  /** Override the transition-phase frame count for real snapshots (default: 30) */
  transFramesOverride?: number;
  /**
   * When true, audio cross-fades as the #1 entity changes during transitions.
   * When false (default), each snapshot's #1 audio plays for the full scene duration.
   */
  audioFollowsRank?: boolean;
}
