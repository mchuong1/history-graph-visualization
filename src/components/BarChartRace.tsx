import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import type { BarChartRaceProps } from "../types/index";
import { AnimatedBarChart } from "./AnimatedBarChart";
import {
  buildTimeSnapshots,
  interpolateSnapshots,
  easeInOut,
} from "../utils/dataHelpers";

const DEFAULT_COLOR_SCHEME = [
  "#6366f1",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
  "#84cc16",
];

/** Frames each snapshot is held before transitioning to the next */
const HOLD_FRAMES = 60;
/** Frames for the transition between snapshots */
const TRANSITION_FRAMES = 30;
/** Frames per "scene" (hold + transition) */
const FRAMES_PER_SCENE = HOLD_FRAMES + TRANSITION_FRAMES;
/** Progress threshold at which the year label flips to the next year */
const LABEL_TRANSITION_THRESHOLD = 0.5;
/** Multiplier added to the global max value to keep bars from hitting the chart edge */
const MAX_VALUE_PADDING = 1.05;

export function BarChartRace({
  dataset,
  topN,
  colorScheme,
}: BarChartRaceProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const snapshots = buildTimeSnapshots(dataset, topN + 5); // extra buffer for interpolation

  const sceneIndex = Math.min(
    Math.floor(frame / FRAMES_PER_SCENE),
    snapshots.length - 1
  );

  const frameInScene = frame % FRAMES_PER_SCENE;

  const currentSnapshot = snapshots[sceneIndex];
  const nextSnapshot = snapshots[Math.min(sceneIndex + 1, snapshots.length - 1)];

  if (!currentSnapshot || !nextSnapshot) return null;

  // During HOLD_FRAMES: show current. During TRANSITION_FRAMES: interpolate.
  const isTransitioning = frameInScene > HOLD_FRAMES;
  const rawProgress = isTransitioning
    ? (frameInScene - HOLD_FRAMES) / TRANSITION_FRAMES
    : 0;
  const progress = easeInOut(Math.min(rawProgress, 1));

  const displayEntries = isTransitioning
    ? interpolateSnapshots(
        currentSnapshot.entries,
        nextSnapshot.entries,
        progress
      )
    : currentSnapshot.entries;

  const topEntries = displayEntries.slice(0, topN);

  // Animate the year label opacity
  const yearOpacity = isTransitioning
    ? interpolate(rawProgress, [0, 0.3, 0.7, 1], [1, 0.4, 0.4, 1])
    : 1;

  const currentLabel = isTransitioning && rawProgress > LABEL_TRANSITION_THRESHOLD
    ? nextSnapshot.label
    : currentSnapshot.label;

  // Compute a consistent max value across all snapshots so bars don't rescale wildly
  const globalMax = Math.max(
    ...snapshots.flatMap((s) => s.entries.map((e) => e.value))
  ) * MAX_VALUE_PADDING;

  const colors = colorScheme.length > 0 ? colorScheme : DEFAULT_COLOR_SCHEME;

  return (
    <div
      style={{ fontFamily: "Inter, system-ui, sans-serif" }}
      className="w-full h-full bg-gray-950 flex flex-col p-6 gap-4"
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-white text-2xl font-bold leading-tight">
            {dataset.title}
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Top {topN} ranked by {dataset.valueLabel}
          </p>
        </div>
        <div
          style={{ opacity: yearOpacity }}
          className="text-right"
        >
          <span className="text-6xl font-black text-gray-700 leading-none select-none">
            {currentLabel}
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        <AnimatedBarChart
          entries={topEntries}
          colorScheme={colors}
          valueLabel={dataset.valueLabel}
          maxValue={globalMax}
        />
      </div>

      {/* Footer */}
      <div className="text-xs text-gray-600 text-right">
        history-graph-visualization
      </div>
    </div>
  );
}

/**
 * Exported helper so callers can compute the required duration for a dataset.
 */
export function computeDurationFrames(snapshotCount: number): number {
  return snapshotCount * FRAMES_PER_SCENE;
}
