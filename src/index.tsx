import "./styles/global.css";
import { Composition, registerRoot } from "remotion";
import { BarChartRace, computeDurationFrames } from "./components/BarChartRace";
import { RaceTrack, computeDurationFrames as computeRaceTrackDuration } from "./components/RaceTrack";
import { PhysicsBarChart, computeDurationFrames as computePhysicsDuration } from "./components/PhysicsBarChart";
import { programmingLanguagesDataset } from "./data/programmingLanguages";
import { searchEnginesDataset } from "./data/searchEngines";
import { billboardDataset } from "./data/billboardHot100";
import { buildExpandedTimeSnapshots } from "./utils/dataHelpers";

const FPS = 30;
const TOP_N = 10;

// Build +5 extra entries beyond topN so interpolation has data for items
// that are just outside the visible top-N and may animate into view.
const SNAPSHOT_BUFFER = 5;

// Number of synthetic in-between steps — must match the constant in BarChartRace.tsx
const SYNTHETIC_STEPS = 7;

const langSnapshots = buildExpandedTimeSnapshots(programmingLanguagesDataset, TOP_N + SNAPSHOT_BUFFER, SYNTHETIC_STEPS);
const langDuration = computeDurationFrames(langSnapshots);

const seSnapshots = buildExpandedTimeSnapshots(searchEnginesDataset, TOP_N + SNAPSHOT_BUFFER, SYNTHETIC_STEPS);
const seDuration = computeDurationFrames(seSnapshots);

// Billboard: 5 s per month = 120 hold + 30 transition at 30 fps
const BILLBOARD_HOLD = 120;
const BILLBOARD_TRANS = 30;
const bbSnapshots = buildExpandedTimeSnapshots(billboardDataset, TOP_N + SNAPSHOT_BUFFER, SYNTHETIC_STEPS);
const bbDuration = computeDurationFrames(bbSnapshots, { hold: BILLBOARD_HOLD, transition: BILLBOARD_TRANS });

const raceTrackDuration = computeRaceTrackDuration(bbSnapshots, { hold: BILLBOARD_HOLD, transition: BILLBOARD_TRANS });
const physicsDuration = computePhysicsDuration(bbSnapshots, { hold: BILLBOARD_HOLD, transition: BILLBOARD_TRANS });

function Root() {
  return (
    <>
      <Composition
        id="BarChartRace"
        component={BarChartRace}
        durationInFrames={langDuration}
        fps={FPS}
        width={1280}
        height={720}
        defaultProps={{
          dataset: programmingLanguagesDataset,
          topN: TOP_N,
          colorScheme: [],
        }}
      />
      <Composition
        id="SearchEngineRace"
        component={BarChartRace}
        durationInFrames={seDuration}
        fps={FPS}
        width={1280}
        height={720}
        defaultProps={{
          dataset: searchEnginesDataset,
          topN: TOP_N,
          colorScheme: [],
        }}
      />
      {/* Billboard Hot 100 — no audio crossfade (static) */}
      <Composition
        id="BillboardRace"
        component={BarChartRace}
        durationInFrames={Math.max(bbDuration, 1)}
        fps={FPS}
        width={1280}
        height={720}
        defaultProps={{
          dataset: billboardDataset,
          topN: TOP_N,
          colorScheme: [],
          holdFramesOverride: BILLBOARD_HOLD,
          transFramesOverride: BILLBOARD_TRANS,
          audioFollowsRank: false,
        }}
      />
      {/* Billboard Hot 100 — audio cross-fades as #1 changes */}
      <Composition
        id="BillboardRaceDynamic"
        component={BarChartRace}
        durationInFrames={Math.max(bbDuration, 1)}
        fps={FPS}
        width={1280}
        height={720}
        defaultProps={{
          dataset: billboardDataset,
          topN: TOP_N,
          colorScheme: [],
          holdFramesOverride: BILLBOARD_HOLD,
          transFramesOverride: BILLBOARD_TRANS,
          audioFollowsRank: true,
        }}
      />
      {/* Billboard — horizontal race track with album art avatars */}
      <Composition
        id="BillboardRaceTrack"
        component={RaceTrack}
        durationInFrames={Math.max(raceTrackDuration, 1)}
        fps={FPS}
        width={1280}
        height={720}
        defaultProps={{
          dataset: billboardDataset,
          topN: TOP_N,
          colorScheme: [],
          holdFramesOverride: BILLBOARD_HOLD,
          transFramesOverride: BILLBOARD_TRANS,
        }}
      />
      {/* Billboard — physics bar chart with spring bounce + particles */}
      <Composition
        id="BillboardPhysics"
        component={PhysicsBarChart}
        durationInFrames={Math.max(physicsDuration, 1)}
        fps={FPS}
        width={1280}
        height={720}
        defaultProps={{
          dataset: billboardDataset,
          topN: TOP_N,
          colorScheme: [],
          holdFramesOverride: BILLBOARD_HOLD,
          transFramesOverride: BILLBOARD_TRANS,
        }}
      />
    </>
  );
}

registerRoot(Root);
