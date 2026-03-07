import "./styles/global.css";
import { Composition, registerRoot } from "remotion";
import { BarChartRace, computeDurationFrames } from "./components/BarChartRace";
import { programmingLanguagesDataset } from "./data/programmingLanguages";
import { buildTimeSnapshots } from "./utils/dataHelpers";

const FPS = 30;
const TOP_N = 10;

// Build +5 extra entries beyond topN so interpolation has data for items
// that are just outside the visible top-N and may animate into view.
const SNAPSHOT_BUFFER = 5;
const snapshots = buildTimeSnapshots(programmingLanguagesDataset, TOP_N + SNAPSHOT_BUFFER);
const durationInFrames = computeDurationFrames(snapshots.length);

function Root() {
  return (
    <Composition
      id="BarChartRace"
      component={BarChartRace}
      durationInFrames={durationInFrames}
      fps={FPS}
      width={1280}
      height={720}
      defaultProps={{
        dataset: programmingLanguagesDataset,
        topN: TOP_N,
        colorScheme: [],
      }}
    />
  );
}

registerRoot(Root);
