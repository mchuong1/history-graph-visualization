# GitHub Copilot Instructions

## Token Economy

- **Thinking**: every internal reasoning step must be ≤10 words.
- **No preamble**: never start with "I will now…", "Here's the answer:", "Certainly!", etc.
- **Parallel tools**: batch independent tool calls together; do not run them sequentially.
- **Stop early**: once sufficient context is gathered, act — do not keep researching.
- **Concise replies**: match response depth to task complexity; prefer 1–3 sentences for simple answers.

## Project Context

| Item | Detail |
|---|---|
| Framework | React 19 + TypeScript |
| Build | Vite (dev) via Remotion Studio; `remotion render` for video output |
| Runtime | Remotion v4 (`remotion`, `@remotion/cli`, `@remotion/player`) |
| Styling | Tailwind CSS v4 via `@remotion/tailwind-v4` (inline classes, no config file) |
| Charts | Recharts v3 (`BarChart`, `Bar`, `Cell`, `LabelList`, `ResponsiveContainer`) |
| UI primitives | Radix UI (Select, Slider, Tabs, Tooltip) |
| Output | 1280×720 @ 30 fps → `out/video.mp4`; still → `out/preview.png` |

**Key constants** (all in `src/components/BarChartRace.tsx`):

| Constant | Default | Purpose |
|---|---|---|
| `FPS` | `30` | Frames per second (set in `src/index.tsx`) |
| `TOP_N` | `10` | Visible bars in composition |
| `SNAPSHOT_BUFFER` | `5` | Extra entries beyond `topN` for off-screen interpolation |
| `HOLD_FRAMES` | `60` | Frames each snapshot is held |
| `TRANSITION_FRAMES` | `30` | Frames to interpolate between snapshots |
| `MAX_VALUE_PADDING` | `1.05` | Global max value multiplier to avoid clipping |

**Key files**:

- `src/index.tsx` — Remotion root; registers `BarChartRace` composition and computes `durationInFrames`
- `src/types/index.ts` — domain types (`DataEntry`, `TimeSnapshot`, `Dataset`, `BarChartRaceProps`)
- `src/data/programmingLanguages.ts` — sample `Dataset`; follow this shape for new datasets
- `src/utils/dataHelpers.ts` — pure functions: `getUniqueDates`, `getTopNForDate`, `interpolateSnapshots`, `buildTimeSnapshots`, `buildExpandedTimeSnapshots`, `formatDateLabel`, `easeInOut`, `getColor`
- `src/components/BarChartRace.tsx` — orchestrates frame logic, snapshot selection, and label animation
- `src/components/AnimatedBarChart.tsx` — presentational Recharts wrapper; accepts `entries`, `colorScheme`, `valueLabel`, `maxValue`
- `src/components/RaceTrack.tsx` — alternative race-track layout composition
- `src/components/PhysicsBarChart.tsx` — physics-based bar chart composition
- `src/styles/global.css` — Tailwind v4 entry (`@import "tailwindcss"`) + custom theme tokens

## Code Style & Conventions

- **Pure logic** → `src/utils/`; **frame/animation logic** → `src/components/BarChartRace.tsx`; **presentational UI** → `src/components/AnimatedBarChart.tsx`.
- Use existing types from `src/types/index.ts`; never duplicate type definitions.
- New datasets must conform to the `Dataset` interface and live in `src/data/`.
- Animation timing constants (`HOLD_FRAMES`, `TRANSITION_FRAMES`, etc.) belong at the top of `BarChartRace.tsx`, not inlined.
- `colorScheme` is passed as a prop; entity-specific overrides use `color` on `DataEntry`. Entity colors are hardcoded per entry — do not move them to a Tailwind theme.
- Remotion hooks (`useCurrentFrame`, `useVideoConfig`, `interpolate`) are only valid inside a Remotion component tree; never call them in utils or outside a composition.
- Mirror existing patterns before introducing new abstractions.

## Remotion-Specific Rules

- `durationInFrames` must be computed from snapshot count before `registerRoot`; never hardcode it.
- Always export a `computeDurationFrames` helper alongside any new composition component so `src/index.tsx` can stay declarative.
- Use `interpolate` (from `remotion`) for clamped linear interpolation; use `easeInOut` (from `dataHelpers`) for smooth easing.
- The `SNAPSHOT_BUFFER` pattern (building `topN + N` snapshots) is intentional — preserve it to keep off-screen entries available for smooth entry/exit animations.
