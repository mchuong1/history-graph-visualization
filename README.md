# history-graph-visualization

An animated bar-chart-race built with **Remotion**, **React**, **TypeScript**, **TailwindCSS**, **Radix UI** and **Recharts**.

It visualises the **top 10** items in a dataset over time, with smooth interpolated transitions between each time period.

![Preview frame](out/preview-frame0.png)

---

## Tech stack

| Package | Role |
|---|---|
| [Remotion](https://www.remotion.dev/) | Programmatic video / animation engine |
| [Recharts](https://recharts.org/) | Bar-chart rendering |
| [TailwindCSS v4](https://tailwindcss.com/) | Utility-first styling |
| [Radix UI](https://www.radix-ui.com/) | Accessible UI primitives (Select, Slider, Tabs, Tooltip) |
| TypeScript | Type safety throughout |

---

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Open the Remotion Studio in your browser (live preview + scrubbing)
npm start

# 3. Render to MP4
npm run build

# 4. Render a single still frame (PNG)
npm run still
```

> **Note:** `npm run build` and `npm run still` require a Chrome / Chromium installation.
> Remotion will download Chrome Headless Shell automatically on first run, or you can
> point it at your own install:
> ```bash
> remotion still src/index.tsx BarChartRace out/preview.png --browser-executable=/usr/bin/google-chrome
> ```

---

## Project structure

```
src/
├── index.tsx                  # Remotion entry point (registerRoot)
├── styles/
│   └── global.css             # TailwindCSS v4 import
├── types/
│   └── index.ts               # Shared TypeScript interfaces
├── data/
│   └── programmingLanguages.ts  # Sample dataset (swap in your own)
├── utils/
│   └── dataHelpers.ts         # Date helpers, interpolation, sorting
└── components/
    ├── AnimatedBarChart.tsx   # Recharts horizontal bar chart
    └── BarChartRace.tsx       # Remotion composition (animation logic)
```

---

## Bringing your own data

Replace (or extend) `src/data/programmingLanguages.ts` with any dataset that
follows the `Dataset` type defined in `src/types/index.ts`:

```ts
interface DataEntry {
  name: string;   // entity label
  value: number;  // numeric ranking criterion
  date: string;   // ISO date string, e.g. "2020-01-01"
  color?: string; // optional hex colour
}

interface Dataset {
  title: string;       // chart heading
  valueLabel: string;  // axis / tooltip label
  entries: DataEntry[];
}
```

Entries are grouped by `date` and sorted descending by `value`.  
The top **N** (default 10) are shown per frame — change `TOP_N` in `src/index.tsx`.

---

## Configuration

| Constant | File | Default | Description |
|---|---|---|---|
| `TOP_N` | `src/index.tsx` | `10` | How many bars to show |
| `FPS` | `src/index.tsx` | `30` | Frames per second |
| `HOLD_FRAMES` | `src/components/BarChartRace.tsx` | `60` | Frames each year is held |
| `TRANSITION_FRAMES` | `src/components/BarChartRace.tsx` | `30` | Frames for the transition |
