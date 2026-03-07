import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate, Audio, Sequence } from "remotion";
import type { BarChartRaceProps, TimeSnapshot } from "../types/index";
import { AnimatedBarChart } from "./AnimatedBarChart";
import {
  buildExpandedTimeSnapshots,
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

/** Frames each real snapshot is held before transitioning */
const HOLD_FRAMES = 60;
/** Frames for the transition between real snapshots */
const TRANSITION_FRAMES = 30;
/** Number of synthetic in-between steps inserted between each pair of real dates */
const SYNTHETIC_STEPS = 7;
/** Hold frames for synthetic steps — no pause, jump straight to counting */
const SYNTHETIC_HOLD_FRAMES = 0;
/** Transition frames for synthetic steps — short for a continuous counting feel */
const SYNTHETIC_TRANSITION_FRAMES = 15;
/** Progress threshold at which the year label flips to the next year */
const LABEL_TRANSITION_THRESHOLD = 0.5;
/** Multiplier added to the global max value to keep bars from hitting the chart edge */
const MAX_VALUE_PADDING = 1.05;

/** Per-snapshot hold frame budget */
function holdFrames(s: TimeSnapshot): number {
  return s.isSynthetic ? SYNTHETIC_HOLD_FRAMES : HOLD_FRAMES;
}
/** Per-snapshot transition frame budget */
function transFrames(s: TimeSnapshot): number {
  return s.isSynthetic ? SYNTHETIC_TRANSITION_FRAMES : TRANSITION_FRAMES;
}
/** Total frame budget for a snapshot */
function sceneFrames(s: TimeSnapshot): number {
  return holdFrames(s) + transFrames(s);
}

export function BarChartRace({
  dataset,
  topN,
  colorScheme,
  holdFramesOverride,
  transFramesOverride,
  audioFollowsRank = false,
}: BarChartRaceProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const snapshots = buildExpandedTimeSnapshots(dataset, topN + 5, SYNTHETIC_STEPS);

  // Per-composition timing overrides
  const localHold = holdFramesOverride ?? HOLD_FRAMES;
  const localTrans = transFramesOverride ?? TRANSITION_FRAMES;
  function localSceneFrames(s: TimeSnapshot): number {
    if (s.isSynthetic) return SYNTHETIC_HOLD_FRAMES + SYNTHETIC_TRANSITION_FRAMES;
    return localHold + localTrans;
  }

  // Precompute cumulative scene start frames
  const sceneStarts: number[] = [];
  let acc = 0;
  for (const s of snapshots) {
    sceneStarts.push(acc);
    acc += localSceneFrames(s);
  }

  // Find which scene the current frame belongs to
  let sceneIndex = snapshots.length - 1;
  for (let i = 0; i < snapshots.length; i++) {
    if (frame < sceneStarts[i] + localSceneFrames(snapshots[i])) {
      sceneIndex = i;
      break;
    }
  }

  const frameInScene = frame - sceneStarts[sceneIndex];

  const currentSnapshot = snapshots[sceneIndex];
  const nextSnapshot = snapshots[Math.min(sceneIndex + 1, snapshots.length - 1)];

  if (!currentSnapshot || !nextSnapshot) return null;

  // During hold phase: show current. During transition: interpolate.
  const h = currentSnapshot.isSynthetic ? SYNTHETIC_HOLD_FRAMES : localHold;
  const t = currentSnapshot.isSynthetic ? SYNTHETIC_TRANSITION_FRAMES : localTrans;
  const isTransitioning = frameInScene >= h;
  const rawProgress = isTransitioning
    ? (frameInScene - h) / t
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

  // Resolve the "effective" snapshot for label display
  const effectiveSnapshot =
    isTransitioning && rawProgress > LABEL_TRANSITION_THRESHOLD
      ? nextSnapshot
      : currentSnapshot;
  const currentLabel = effectiveSnapshot.label;
  // Hide label on synthetic (in-between) frames
  const showLabel = !effectiveSnapshot.isSynthetic;

  // Animate the year label opacity
  const yearOpacity = isTransitioning
    ? interpolate(rawProgress, [0, 0.3, 0.7, 1], [1, 0.4, 0.4, 1])
    : 1;

  // Compute a consistent max value across all snapshots so bars don't rescale wildly
  const globalMax = Math.max(
    ...snapshots.flatMap((s) => s.entries.map((e) => e.value))
  ) * MAX_VALUE_PADDING;

  const colors = colorScheme.length > 0 ? colorScheme : DEFAULT_COLOR_SCHEME;

  // Compute audio segments: merge consecutive real snapshots where the same rank-1 song
  // holds #1 into a single segment so the preview continues uninterrupted across months.
  const totalFrames = sceneStarts[sceneStarts.length - 1] + localSceneFrames(snapshots[snapshots.length - 1]);
  const audioSegments: Array<{ from: number; duration: number; audioSrc: string }> = [];

  let openSeg: { from: number; audioSrc: string } | null = null;

  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i];
    if (s.isSynthetic) continue;
    const audioSrc = s.entries[0]?.audioSrc;

    if (!audioSrc) {
      // No audio for this snapshot — close any open segment.
      if (openSeg) {
        audioSegments.push({ from: openSeg.from, duration: sceneStarts[i] - openSeg.from, audioSrc: openSeg.audioSrc });
        openSeg = null;
      }
      continue;
    }

    if (openSeg && openSeg.audioSrc === audioSrc) {
      // Same rank-1 song still holds — stretch the open segment to cover this snapshot.
      // (We'll finalize the duration when a different song appears or we reach the end.)
    } else {
      // New song (or first snapshot) — close old segment, open a new one.
      if (openSeg) {
        audioSegments.push({ from: openSeg.from, duration: sceneStarts[i] - openSeg.from, audioSrc: openSeg.audioSrc });
      }
      openSeg = { from: sceneStarts[i], audioSrc };
    }
  }

  // Close any segment still open after the last snapshot.
  if (openSeg) {
    audioSegments.push({ from: openSeg.from, duration: totalFrames - openSeg.from, audioSrc: openSeg.audioSrc });
  }

  return (
    <>
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
        {showLabel && (
          <div
            style={{ opacity: yearOpacity }}
            className="text-right"
          >
            <span className="text-6xl font-black text-gray-700 leading-none select-none">
              {currentLabel}
            </span>
          </div>
        )}
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

    {/* Audio: play each #1 entry's preview clip for its scene range */}
    {audioSegments.map(({ from: segFrom, duration: segDuration, audioSrc }, i) => (
      <Sequence key={`audio-${i}`} from={segFrom} durationInFrames={segDuration} layout="none">
        <Audio
          src={audioSrc}
          volume={
            audioFollowsRank
              ? (f: number) => {
                  const fadeLen = localTrans;
                  if (f < fadeLen) return (f / fadeLen) * 0.8;
                  if (f > segDuration - fadeLen) return (Math.max(0, segDuration - f) / fadeLen) * 0.8;
                  return 0.8;
                }
              : 0.8
          }
        />
      </Sequence>
    ))}
    </>
  );
}

/**
 * Exported helper so callers can compute the required duration for a dataset.
 * Pass optional timing overrides to match the composition's holdFramesOverride / transFramesOverride.
 */
export function computeDurationFrames(
  snapshots: TimeSnapshot[],
  timing?: { hold?: number; transition?: number }
): number {
  const h = timing?.hold ?? HOLD_FRAMES;
  const t = timing?.transition ?? TRANSITION_FRAMES;
  return snapshots.reduce((sum, s) => {
    if (s.isSynthetic) return sum + SYNTHETIC_HOLD_FRAMES + SYNTHETIC_TRANSITION_FRAMES;
    return sum + h + t;
  }, 0);
}
