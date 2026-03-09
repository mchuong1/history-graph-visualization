import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate, Audio, Sequence, staticFile, Img } from "remotion";
import { useAudioData, visualizeAudio } from "@remotion/media-utils";
import type { BarChartRaceProps, DataEntry, TimeSnapshot } from "../types/index";
import {
  buildExpandedTimeSnapshots,
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

// ─── Particle burst ──────────────────────────────────────────────────────────
/**
 * Renders a burst of particles from (cx, cy) that fire outward.
 * `birthFrame` is the absolute frame when the burst started.
 */
function ParticleBurst({
  cx,
  cy,
  birthFrame,
  color,
}: {
  cx: number;
  cy: number;
  birthFrame: number;
  color: string;
}) {
  const frame = useCurrentFrame();
  const age = frame - birthFrame;
  const DURATION = 28;
  if (age < 0 || age > DURATION) return null;

  const t = age / DURATION; // 0 → 1
  const opacity = interpolate(t, [0, 0.2, 1], [0, 1, 0]);

  const particles = Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * Math.PI * 2;
    const dist = easeInOut(t) * 36;
    const x = cx + Math.cos(angle) * dist;
    const y = cy + Math.sin(angle) * dist;
    const size = interpolate(t, [0, 0.3, 1], [3, 5, 2]);
    return { x, y, size };
  });

  return (
    <>
      {particles.map((p, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: p.y - p.size / 2,
            left: p.x - p.size / 2,
            width: p.size,
            height: p.size,
            borderRadius: "50%",
            backgroundColor: color,
            opacity,
            pointerEvents: "none",
            zIndex: 50,
          }}
        />
      ))}
    </>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────
export function PhysicsBarChart({
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

  // Nearest real (non-synthetic) snapshot — must be computed before any early return
  // so hooks below are always called unconditionally.
  const nearestRealIdx = (() => {
    for (let i = sceneIndex; i >= 0; i--) {
      if (!snapshots[i].isSynthetic) return i;
    }
    return 0;
  })();

  // Rank-1 audioSrc locked to the current real month.
  // Strip leading slash and resolve through staticFile() so Remotion can locate
  // the local file in public/ and decode it with useAudioData.
  const rawAudioSrc = snapshots[nearestRealIdx].entries[0]?.audioSrc ?? null;
  const rank1AudioSrc = rawAudioSrc ? staticFile(rawAudioSrc.replace(/^\//, "")) : null;

  // Frame offset into the audio file so visualizeAudio analyses the right position
  let audioStartFrame = sceneStarts[nearestRealIdx] ?? 0;
  if (rawAudioSrc) {
    for (let i = nearestRealIdx - 1; i >= 0; i--) {
      if (snapshots[i].isSynthetic) continue;
      if (snapshots[i].entries[0]?.audioSrc === rawAudioSrc) {
        audioStartFrame = sceneStarts[i] ?? 0;
      } else {
        break;
      }
    }
  }
  const audioFrame = Math.max(0, frame - audioStartFrame);

  // Hook — must be called unconditionally (before any early returns).
  // Cast handles the null case at the type level; the hook returns null when src is falsy.
  const audioData = useAudioData(rank1AudioSrc as string);

  if (!currentSnapshot || !nextSnapshot) return null;

  const h = currentSnapshot.isSynthetic ? SYNTHETIC_HOLD_FRAMES : localHold;
  const t = currentSnapshot.isSynthetic ? SYNTHETIC_TRANSITION_FRAMES : localTrans;
  const isTransitioning = frameInScene >= h;
  const rawProgress = isTransitioning ? (frameInScene - h) / t : 0;

  // Spring progress drives the bar width — overshoot creates the bounce
  const springProgress =
    isTransitioning && !currentSnapshot.isSynthetic
      ? spring({
          frame: frameInScene - h,
          fps,
          config: { damping: 11, stiffness: 185, mass: 0.8 },
          durationInFrames: t + 10,
        })
      : isTransitioning
      ? easeInOut(Math.min(rawProgress, 1))
      : 0;

  // Date label
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

  // Current & next entries sorted by value desc → stable top-N
  const currentSorted = [...currentSnapshot.entries].sort(
    (a, b) => b.value - a.value
  );
  const nextSorted = [...nextSnapshot.entries].sort(
    (a, b) => b.value - a.value
  );

  const currentTop = currentSorted.slice(0, topN);
  const nextTop = nextSorted.slice(0, topN);

  // Build rank maps: name → rank index (0-based)
  const currentRankMap = new Map<string, number>(
    currentTop.map((e, i) => [e.name, i])
  );
  const nextRankMap = new Map<string, number>(
    nextTop.map((e, i) => [e.name, i])
  );

  // Full value maps for smooth entry/exit interpolation (includes entries outside topN)
  const currentFullValMap = new Map<string, number>(
    currentSnapshot.entries.map((e) => [e.name, e.value])
  );
  const nextFullValMap = new Map<string, number>(
    nextSnapshot.entries.map((e) => [e.name, e.value])
  );
  // Metadata map (color, imageSrc, etc.) — prefer current snapshot's entry
  const entryMetaMap = new Map<string, DataEntry>();
  for (const e of [...currentSnapshot.entries, ...nextSnapshot.entries]) {
    if (!entryMetaMap.has(e.name)) entryMetaMap.set(e.name, e);
  }

  // Union of current top-N and next top-N — includes entering/exiting entries
  const transitionNames = isTransitioning
    ? new Set([...currentTop.map((e) => e.name), ...nextTop.map((e) => e.name)])
    : new Set(currentTop.map((e) => e.name));

  const displayRows = Array.from(transitionNames).map((name) => {
    const meta = entryMetaMap.get(name)!;
    const fromIndex = currentRankMap.has(name) ? currentRankMap.get(name)! : topN;
    const toIndex = nextRankMap.has(name) ? nextRankMap.get(name)! : topN;
    const fromValue = currentFullValMap.get(name) ?? 0;
    const toValue = nextFullValMap.get(name) ?? 0;
    const displayValue = isTransitioning
      ? fromValue + (toValue - fromValue) * springProgress
      : fromValue;
    // Smoothly interpolate vertical rank position
    const interpolatedIndex = isTransitioning
      ? fromIndex + (toIndex - fromIndex) * springProgress
      : fromIndex;
    const rankDelta = toIndex - fromIndex; // negative = improved
    return { ...meta, displayValue, rankDelta, fromValue, toValue, interpolatedIndex };
  });

  // Global max
  const globalMax =
    Math.max(...snapshots.flatMap((s) => s.entries.map((e) => e.value))) *
    MAX_VALUE_PADDING;

  // ── Bar oscillation + shimmer constants ────────────────────────────────────
  const OSCILLATION_AMPLITUDE = 0.5; // fraction of barWidth (0.5 = ±50%)
  const SHIMMER_SPEED = 3;          // px / frame

  // BPM drives oscillation direction frequency; nearestRealIdx resolved above the early return
  const rank1Bpm = snapshots[nearestRealIdx].entries[0]?.bpm ?? 120;
  const rank1OscFreq = (rank1Bpm / 60) * (2 * Math.PI) / fps; // rad / frame

  // Audio amplitude (0–1): average of bass/mid frequency bands from the actual audio waveform.
  // Falls back to |sin| of the BPM beat when no audio data is available yet.
  const audioAmplitude = audioData
    ? (() => {
        const bars = visualizeAudio({ fps, frame: audioFrame, audioData, numberOfSamples: 32 });
        const bass = bars.slice(0, 16);
        return bass.reduce((s, v) => s + v, 0) / bass.length;
      })()
    : Math.abs(Math.sin(frame * rank1OscFreq));

  // ── Audio segments ────────────────────────────────────────────────
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

  // Layout
  const THUMB_SIZE = 36;
  const NAME_W = 220;
  const PAD_L = 24;
  const PAD_R = 24;
  const BAR_AREA_W = 1280 - PAD_L - THUMB_SIZE - NAME_W - PAD_R - 16 * 3;
  const ROW_H = Math.floor((720 - 80) / topN);
  const BAR_H = Math.min(ROW_H - 14, 40);
  const ROWS_TOP = 64;

  // Track burst birth frames: fire when rank improves ≥2 on real snapshot boundary
  // We derive burst events from scene start frame
  const burstEvents: Array<{
    name: string;
    barEndX: number;
    barY: number;
    color: string;
    birthFrame: number;
  }> = [];

  if (!currentSnapshot.isSynthetic && isTransitioning) {
    displayRows.forEach((row) => {
      const improved = row.rankDelta <= -2;
      if (improved) {
        const barEndX =
          PAD_L +
          THUMB_SIZE +
          16 +
          NAME_W +
          16 +
          (row.displayValue / globalMax) * BAR_AREA_W;
        const barY =
          ROWS_TOP + row.interpolatedIndex * ROW_H + (ROW_H - BAR_H) / 2 + BAR_H / 2;
        burstEvents.push({
          name: row.name,
          barEndX,
          barY,
          color: row.color ?? "#f59e0b",
          birthFrame: sceneStarts[sceneIndex] + h,
        });
      }
    });
  }

  return (
    <>
    <div
      style={{
        width: 1280,
        height: 720,
        backgroundColor: "#0c0c12",
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* ── Title ── */}
      <div
        style={{
          position: "absolute",
          top: 14,
          left: PAD_L,
          color: "rgba(255,255,255,0.9)",
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: -0.4,
          maxWidth: 700,
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
            right: PAD_R - 10,
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

      {/* ── Bars + Particle bursts ── */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
        }}
      >
      {/* ── Bars ── */}
      {displayRows.map((row) => {
        const rowTop = ROWS_TOP + row.interpolatedIndex * ROW_H;
        const barTop = rowTop + (ROW_H - BAR_H) / 2;
        const barPct = Math.max(0, Math.min(1, row.displayValue / globalMax));
        const barWidth = barPct * BAR_AREA_W;
        const visualRank = Math.round(row.interpolatedIndex);
        const isLeader = visualRank === 0;

        // Rank delta badge
        const deltaImproved = row.rankDelta < 0;
        const deltaDeclined = row.rankDelta > 0;
        const deltaColor = deltaImproved
          ? "#4ade80"
          : deltaDeclined
          ? "#f87171"
          : "rgba(255,255,255,0.35)";
        const deltaLabel = deltaImproved
          ? `▲${Math.abs(row.rankDelta)}`
          : deltaDeclined
          ? `▼${Math.abs(row.rankDelta)}`
          : "–";

        // Bar fill: gradient from entity color to a lighter version
        const barColor = row.color ?? "#6366f1";

        // Rank-1 bar: right edge pulses in/out at BPM frequency
        // Beat sign (-1 to 1) drives in/out direction; audioAmplitude scales magnitude by loudness
        const beatSign = Math.sin(frame * rank1OscFreq);
        const barWidthPulse = isLeader && barWidth > 1
          ? beatSign * audioAmplitude * barWidth * OSCILLATION_AMPLITUDE
          : 0;
        const displayBarWidth = Math.min(Math.max(0, barWidth + barWidthPulse), BAR_AREA_W);

        return (
          <React.Fragment key={row.name}>
            {/* Row background */}
            <div
              style={{
                position: "absolute",
                top: rowTop,
                left: PAD_L,
                right: 0,
                height: ROW_H - 2,
                backgroundColor: isLeader
                  ? "rgba(255,215,0,0.04)"
                  : visualRank % 2 === 0
                  ? "rgba(255,255,255,0.018)"
                  : "transparent",
              }}
            />

            {/* Thumbnail */}
            <div
              style={{
                position: "absolute",
                top: rowTop + (ROW_H - THUMB_SIZE) / 2,
                left: PAD_L,
                width: THUMB_SIZE,
                height: THUMB_SIZE,
                borderRadius: 6,
                overflow: "hidden",
                backgroundColor: barColor + "55",
                border: `2px solid ${isLeader ? "gold" : barColor + "88"}`,
                flexShrink: 0,
              }}
            >
              {row.imageSrc ? (
                <Img
                  src={row.imageSrc.startsWith("/") ? staticFile(row.imageSrc.slice(1)) : row.imageSrc}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  alt={row.name}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 800,
                    color: "#fff",
                  }}
                >
                  {getInitials(row.name)}
                </div>
              )}
            </div>

            {/* Rank number */}
            <div
              style={{
                position: "absolute",
                top: rowTop + (ROW_H - 28) / 2,
                left: PAD_L + THUMB_SIZE + 6,
                width: 24,
                height: 28,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontWeight: 800,
                color: isLeader ? "gold" : "rgba(255,255,255,0.32)",
              }}
            >
              {visualRank + 1}
            </div>

            {/* Song name */}
            <div
              style={{
                position: "absolute",
                top: rowTop + (ROW_H - 32) / 2,
                left: PAD_L + THUMB_SIZE + 34,
                width: NAME_W - 34,
                height: 32,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: isLeader ? 700 : 500,
                  color: isLeader
                    ? "rgba(255,215,0,0.95)"
                    : "rgba(255,255,255,0.8)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  lineHeight: 1.3,
                }}
              >
                {row.name}
              </div>
              {/* Rank delta */}
              {isTransitioning && row.rankDelta !== 0 && (
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: deltaColor,
                    marginTop: 1,
                  }}
                >
                  {deltaLabel}
                </div>
              )}
            </div>

            {/* Bar track background */}
            <div
              style={{
                position: "absolute",
                top: barTop,
                left: PAD_L + THUMB_SIZE + NAME_W + 16,
                width: BAR_AREA_W,
                height: BAR_H,
                borderRadius: 4,
                backgroundColor: "rgba(255,255,255,0.05)",
              }}
            />

            {/* Bar fill */}
            <div
              style={{
                position: "absolute",
                top: barTop,
                left: PAD_L + THUMB_SIZE + NAME_W + 16,
                width: displayBarWidth,
                height: BAR_H,
                borderRadius: 4,
                background: isLeader
                  ? `linear-gradient(to right, ${barColor}, gold)`
                  : `linear-gradient(to right, ${barColor}cc, ${barColor})`,
                boxShadow: isLeader
                  ? `0 0 12px 2px rgba(255,210,0,0.35)`
                  : "none",
                overflow: "hidden",
              }}
            >
              {/* Shine overlay */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: "40%",
                  background:
                    "linear-gradient(to bottom, rgba(255,255,255,0.12), transparent)",
                  borderRadius: "4px 4px 0 0",
                }}
              />

              {/* Shimmer sweep — all bars, staggered by rank so they don't move in unison */}
              {displayBarWidth > 1 && (() => {
                const shimmerBandW = displayBarWidth * 0.45;
                const cycle = displayBarWidth + shimmerBandW;
                const shimmerLeft =
                  ((frame * SHIMMER_SPEED + visualRank * 20) % cycle) - shimmerBandW;
                return (
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: shimmerLeft,
                      width: shimmerBandW,
                      height: "100%",
                      background:
                        "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.22) 50%, transparent 100%)",
                      pointerEvents: "none",
                    }}
                  />
                );
              })()}
            </div>


          </React.Fragment>
        );
      })}

      {/* ── Particle bursts ── */}
      {burstEvents.map((evt) => (
        <ParticleBurst
          key={`${evt.name}-${evt.birthFrame}`}
          cx={evt.barEndX}
          cy={evt.barY}
          birthFrame={evt.birthFrame}
          color={evt.color}
        />
      ))}
      </div>

      {/* Bottom gradient bar */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 3,
          background:
            "linear-gradient(to right, transparent, rgba(99,102,241,0.5), transparent)",
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
