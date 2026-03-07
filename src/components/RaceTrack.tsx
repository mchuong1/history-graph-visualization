import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate, Audio, Sequence, staticFile } from "remotion";
import type { BarChartRaceProps, TimeSnapshot } from "../types/index";
import {
  buildExpandedTimeSnapshots,
  interpolateSnapshots,
  easeInOut,
} from "../utils/dataHelpers";

// ─── Timing constants ────────────────────────────────────────────────────────
const HOLD_FRAMES = 120;
const TRANSITION_FRAMES = 30;
const SYNTHETIC_STEPS = 7;
const SYNTHETIC_HOLD_FRAMES = 0;
const SYNTHETIC_TRANSITION_FRAMES = 15;
const LABEL_TRANSITION_THRESHOLD = 0.5;
const MAX_VALUE_PADDING = 1.05;

function localSceneFrames(
  s: TimeSnapshot,
  hold: number,
  trans: number
): number {
  if (s.isSynthetic) return SYNTHETIC_HOLD_FRAMES + SYNTHETIC_TRANSITION_FRAMES;
  return hold + trans;
}

export function computeDurationFrames(
  snapshots: TimeSnapshot[],
  opts?: { hold?: number; transition?: number }
): number {
  const hold = opts?.hold ?? HOLD_FRAMES;
  const trans = opts?.transition ?? TRANSITION_FRAMES;
  return snapshots.reduce(
    (sum, s) => sum + localSceneFrames(s, hold, trans),
    0
  );
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// ─── Component ───────────────────────────────────────────────────────────────
export function RaceTrack({
  dataset,
  topN,
  holdFramesOverride,
  transFramesOverride,
  audioFollowsRank = false,
}: BarChartRaceProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const snapshots = buildExpandedTimeSnapshots(dataset, topN + 5, SYNTHETIC_STEPS);

  const localHold = holdFramesOverride ?? HOLD_FRAMES;
  const localTrans = transFramesOverride ?? TRANSITION_FRAMES;

  // Precompute cumulative scene start frames
  const sceneStarts: number[] = [];
  let acc = 0;
  for (const s of snapshots) {
    sceneStarts.push(acc);
    acc += localSceneFrames(s, localHold, localTrans);
  }

  // Find current scene
  let sceneIndex = snapshots.length - 1;
  for (let i = 0; i < snapshots.length; i++) {
    if (
      frame <
      sceneStarts[i] + localSceneFrames(snapshots[i], localHold, localTrans)
    ) {
      sceneIndex = i;
      break;
    }
  }

  const frameInScene = frame - sceneStarts[sceneIndex];
  const currentSnapshot = snapshots[sceneIndex];
  const nextSnapshot = snapshots[Math.min(sceneIndex + 1, snapshots.length - 1)];

  if (!currentSnapshot || !nextSnapshot) return null;

  const h = currentSnapshot.isSynthetic ? SYNTHETIC_HOLD_FRAMES : localHold;
  const t = currentSnapshot.isSynthetic ? SYNTHETIC_TRANSITION_FRAMES : localTrans;
  const isTransitioning = frameInScene >= h;
  const rawProgress = isTransitioning ? (frameInScene - h) / t : 0;
  const easedProgress = easeInOut(Math.min(rawProgress, 1));

  const displayEntries = isTransitioning
    ? interpolateSnapshots(currentSnapshot.entries, nextSnapshot.entries, easedProgress)
    : currentSnapshot.entries;

  // Date label fade
  const labelProgress = isTransitioning ? rawProgress : 0;
  const labelOpacity = interpolate(
    labelProgress,
    [0, 0.3, 0.7, 1],
    [1, 0, 0, 1]
  );
  const showLabel = !currentSnapshot.isSynthetic;
  const displayLabel =
    labelProgress < LABEL_TRANSITION_THRESHOLD
      ? currentSnapshot.label
      : nextSnapshot.label;

  // ── Audio segments (same logic as BarChartRace) ────────────────────────────
  const totalFrames =
    sceneStarts[sceneStarts.length - 1] +
    localSceneFrames(snapshots[snapshots.length - 1], localHold, localTrans);
  const audioSegments: Array<{ from: number; duration: number; audioSrc: string }> = [];
  let openSeg: { from: number; audioSrc: string } | null = null;

  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i];
    if (s.isSynthetic) continue;
    const audioSrc = s.entries[0]?.audioSrc;
    if (!audioSrc) {
      if (openSeg) {
        audioSegments.push({ from: openSeg.from, duration: sceneStarts[i] - openSeg.from, audioSrc: openSeg.audioSrc });
        openSeg = null;
      }
      continue;
    }
    if (openSeg && openSeg.audioSrc === audioSrc) {
      // same song — keep stretching
    } else {
      if (openSeg) {
        audioSegments.push({ from: openSeg.from, duration: sceneStarts[i] - openSeg.from, audioSrc: openSeg.audioSrc });
      }
      openSeg = { from: sceneStarts[i], audioSrc };
    }
  }
  if (openSeg) {
    audioSegments.push({ from: openSeg.from, duration: totalFrames - openSeg.from, audioSrc: openSeg.audioSrc });
  }

  // Stable rank order from snapshot boundaries for smooth Y-position transitions
  const currentTopRT = [...currentSnapshot.entries]
    .sort((a, b) => b.value - a.value)
    .slice(0, topN);
  const nextTopRT = [...nextSnapshot.entries]
    .sort((a, b) => b.value - a.value)
    .slice(0, topN);
  const currentRankMapRT = new Map<string, number>(
    currentTopRT.map((e, i) => [e.name, i])
  );
  const nextRankMapRT = new Map<string, number>(
    nextTopRT.map((e, i) => [e.name, i])
  );
  // Display value map from interpolated entries (drives X/horizontal position)
  const displayValMapRT = new Map<string, number>(
    displayEntries.map((e) => [e.name, e.value])
  );
  // Metadata map (color, imageSrc, etc.)
  const entryMetaMapRT = new Map<string, (typeof displayEntries)[0]>();
  for (const e of [...currentSnapshot.entries, ...nextSnapshot.entries]) {
    if (!entryMetaMapRT.has(e.name)) entryMetaMapRT.set(e.name, e);
  }
  // Union of current top-N and next top-N — includes entering/exiting entries
  const renderNamesRT = isTransitioning
    ? new Set([...currentTopRT.map((e) => e.name), ...nextTopRT.map((e) => e.name)])
    : new Set(currentTopRT.map((e) => e.name));
  const renderEntriesRT = Array.from(renderNamesRT).map((name) => {
    const meta = entryMetaMapRT.get(name)!;
    const fromIndex = currentRankMapRT.has(name) ? currentRankMapRT.get(name)! : topN;
    const toIndex = nextRankMapRT.has(name) ? nextRankMapRT.get(name)! : topN;
    const interpolatedIndex = isTransitioning
      ? fromIndex + (toIndex - fromIndex) * rawProgress
      : fromIndex;
    const displayValue = displayValMapRT.get(name) ?? meta.value;
    return { ...meta, interpolatedIndex, displayValue };
  });

  // Global max across all snapshots (stable X-axis scale)
  const globalMax =
    Math.max(...snapshots.flatMap((s) => s.entries.map((e) => e.value))) *
    MAX_VALUE_PADDING;

  // ── Layout ─────────────────────────────────────────────────────────────────
  const LABEL_WIDTH = 200; // Left column: rank + name + score
  const PAD_RIGHT = 48;
  const TRACK_W = 1280 - LABEL_WIDTH - PAD_RIGHT;
  const AVATAR_SIZE = 50;
  const LANE_H = 63;
  const LANES_TOP = 68;

  // Running "bob" animation: subtle vertical sine wave
  const bobOffset = Math.sin((frame / fps) * Math.PI * 3) * 2.5;

  return (    <>    <div
      style={{
        width: 1280,
        height: 720,
        backgroundColor: "#0d0d12",
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* ── Lane backgrounds ── */}
      {Array.from({ length: topN }).map((_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: LANES_TOP + i * LANE_H,
            left: LABEL_WIDTH,
            width: TRACK_W,
            height: LANE_H - 2,
            backgroundColor:
              i % 2 === 0 ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.01)",
          }}
        />
      ))}

      {/* ── Vertical grid markers (25 / 50 / 75 / 100 %) ── */}
      {[0.25, 0.5, 0.75, 1.0].map((pct) => {
        const x = LABEL_WIDTH + pct * TRACK_W;
        const isFinish = pct === 1.0;
        return (
          <React.Fragment key={pct}>
            <div
              style={{
                position: "absolute",
                top: LANES_TOP - 6,
                left: x,
                width: isFinish ? 3 : 1,
                height: topN * LANE_H + 12,
                backgroundColor: isFinish
                  ? "rgba(255,210,0,0.5)"
                  : "rgba(255,255,255,0.07)",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: LANES_TOP + topN * LANE_H + 10,
                left: x - 14,
                color: "rgba(255,255,255,0.22)",
                fontSize: 9,
                fontWeight: 600,
              }}
            >
              {isFinish ? "MAX" : `${pct * 100}%`}
            </div>
          </React.Fragment>
        );
      })}

      {/* ── Title ── */}
      <div
        style={{
          position: "absolute",
          top: 14,
          left: 20,
          color: "rgba(255,255,255,0.9)",
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: -0.4,
          maxWidth: 600,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {dataset.title}
      </div>

      {/* ── Date label ── */}
      {showLabel && (
        <div
          style={{
            position: "absolute",
            top: 12,
            right: PAD_RIGHT + 4,
            color: "rgba(255,255,255,0.88)",
            fontSize: 26,
            fontWeight: 800,
            opacity: labelOpacity,
            letterSpacing: -0.6,
          }}
        >
          {displayLabel}
        </div>
      )}

      {/* ── Column headers ── */}
      <div
        style={{
          position: "absolute",
          top: LANES_TOP - 18,
          left: LABEL_WIDTH,
          color: "rgba(255,255,255,0.25)",
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: 0.5,
          textTransform: "uppercase",
        }}
      >
        {dataset.valueLabel} →
      </div>

      {/* ── Runners ── */}
      {renderEntriesRT.map((entry) => {
        const visualRank = Math.round(entry.interpolatedIndex);
        const isLeader = visualRank === 0;
        const xRatio = entry.displayValue / globalMax;
        // Avatar centre X relative to track start
        const avatarCx = xRatio * (TRACK_W - AVATAR_SIZE) + AVATAR_SIZE / 2;
        const avatarLeft = LABEL_WIDTH + avatarCx - AVATAR_SIZE / 2;
        const avatarTop = LANES_TOP + entry.interpolatedIndex * LANE_H + (LANE_H - AVATAR_SIZE) / 2;

        // Leader bob, others static
        const yOffset = isLeader ? bobOffset : 0;

        // Speed streaks behind the leader
        const streakWidth = isLeader ? 40 + xRatio * 60 : 0;

        // Glow pulse amplitude (subtle sine)
        const glowStrength = isLeader
          ? 8 + 5 * Math.abs(Math.sin((frame / fps) * Math.PI * 1.5))
          : 0;

        return (
          <React.Fragment key={entry.name}>
            {/* Speed streaks (leader only) */}
            {isLeader && (
              <>
                {[0, 8, 16].map((offset) => (
                  <div
                    key={offset}
                    style={{
                      position: "absolute",
                      top: avatarTop + AVATAR_SIZE / 2 - 1 + yOffset + offset - 12,
                      left: avatarLeft - streakWidth,
                      width: streakWidth,
                      height: 1.5,
                      background:
                        "linear-gradient(to right, transparent, rgba(255,210,0,0.25))",
                      pointerEvents: "none",
                    }}
                  />
                ))}
              </>
            )}

            {/* Avatar */}
            <div
              style={{
                position: "absolute",
                top: avatarTop + yOffset,
                left: avatarLeft,
                width: AVATAR_SIZE,
                height: AVATAR_SIZE,
                borderRadius: "50%",
                overflow: "hidden",
                border: `2.5px solid ${isLeader ? "gold" : entry.color ?? "#666"}`,
                boxShadow: isLeader
                  ? `0 0 ${glowStrength}px ${glowStrength / 2}px rgba(255,200,0,0.5)`
                  : `0 0 6px 1px ${entry.color ?? "#444"}44`,
                backgroundColor: entry.color ?? "#333",
                zIndex: isLeader ? 10 : 5,
              }}
            >
              {entry.imageSrc ? (
                <img
                  src={entry.imageSrc}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                  alt={entry.name}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                    fontWeight: 800,
                    color: "#fff",
                    backgroundColor: entry.color ?? "#555",
                  }}
                >
                  {getInitials(entry.name)}
                </div>
              )}
            </div>

            {/* Rank badge */}
            <div
              style={{
                position: "absolute",
                top: avatarTop + yOffset - 8,
                left: avatarLeft + AVATAR_SIZE - 14,
                width: 22,
                height: 22,
                borderRadius: "50%",
                backgroundColor: isLeader ? "gold" : "rgba(20,20,30,0.95)",
                border: `1.5px solid ${isLeader ? "#fff" : "rgba(255,255,255,0.25)"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                fontWeight: 800,
                color: isLeader ? "#000" : "rgba(255,255,255,0.8)",
                zIndex: 20,
              }}
            >
              {visualRank + 1}
            </div>
          </React.Fragment>
        );
      })}

      {/* ── Left label column (stable reference) ── */}
      {renderEntriesRT.map((entry) => {
        const visualRank = Math.round(entry.interpolatedIndex);
        const isLeader = visualRank === 0;
        const yCenter = LANES_TOP + entry.interpolatedIndex * LANE_H + LANE_H / 2;
        return (
          <div
            key={`lbl-${entry.name}`}
            style={{
              position: "absolute",
              top: yCenter - 16,
              left: 8,
              width: LABEL_WIDTH - 12,
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 32,
            }}
          >
            {/* Rank number */}
            <div
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: isLeader ? "gold" : "rgba(255,255,255,0.38)",
                minWidth: 24,
                textAlign: "right",
              }}
            >
              #{visualRank + 1}
            </div>

            {/* Song name */}
            <div
              style={{
                flex: 1,
                fontSize: 11,
                fontWeight: isLeader ? 700 : 400,
                color: isLeader
                  ? "rgba(255,215,0,0.95)"
                  : "rgba(255,255,255,0.6)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {entry.name}
            </div>

            {/* Score */}
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "rgba(255,255,255,0.3)",
                minWidth: 26,
                textAlign: "right",
              }}
            >
              {Math.round(entry.value)}
            </div>
          </div>
        );
      })}

      {/* ── Bottom bar ── */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 3,
          background:
            "linear-gradient(to right, transparent, rgba(255,200,0,0.4), transparent)",
        }}
      />
    </div>

    {/* Audio */}
    {audioSegments.map(({ from: segFrom, duration: segDuration, audioSrc }, i) => (
      <Sequence key={`audio-${i}`} from={segFrom} durationInFrames={segDuration} layout="none">
        <Audio
          src={audioSrc.startsWith("/") ? staticFile(audioSrc.slice(1)) : audioSrc}
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
