/**
 * Reads both search-engine CSV datasets, merges them, and writes
 * src/data/searchEngines.ts as a static TypeScript data file.
 *
 * Usage: node scripts/generateSearchEngines.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ---------- colours per engine ----------
const ENGINE_COLORS = {
  Google: "#4285F4",
  bing: "#00B2A9",
  "Yahoo!": "#720E9E",
  Baidu: "#2932E1",
  YANDEX: "#FF0000",
  "YANDEX RU": "#CC1100",
  "Ask Jeeves": "#FF8C00",
  DuckDuckGo: "#DE5833",
  Naver: "#03C75A",
  AOL: "#FF0B00",
  Haosou: "#FF6600",
  Sogou: "#FB6140",
  Babylon: "#1F6FEB",
  Shenma: "#1677FF",
  Seznam: "#CC0000",
  Conduit: "#6A0DAD",
  MSN: "#00A4EF",
  "Mail.ru": "#005FF9",
  Ecosia: "#5F9B32",
  Webcrawler: "#888888",
  Daum: "#FF5A00",
  CocCoc: "#1EA7FF",
  "StartPagina (Google)": "#34A853",
  "AVG Search": "#8B0000",
  SweetIM: "#FF69B4",
  "Windows Live": "#00B4D8",
};

const EXCLUDE = new Set(["Other"]);

function parseCSV(raw) {
  const lines = raw.replace(/\r/g, "").trim().split("\n");
  // Strip surrounding quotes from header tokens
  const headers = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim());
  const entries = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple split — none of the engine names contain commas
    const cols = line.split(",");
    const rawDate = cols[0].trim().replace(/^"|"$/g, "");
    const date = rawDate + "-01"; // YYYY-MM → YYYY-MM-01

    for (let j = 1; j < headers.length; j++) {
      const name = headers[j];
      if (EXCLUDE.has(name)) continue;

      const value = parseFloat(cols[j]);
      if (!isFinite(value) || value <= 0) continue;

      entries.push({
        name,
        value: Math.round(value * 100) / 100, // 2 dp
        date,
        color: ENGINE_COLORS[name] ?? undefined,
      });
    }
  }
  return entries;
}

function mergeEntries(a, b) {
  const seen = new Set();
  const result = [];
  for (const entry of [...a, ...b]) {
    const key = `${entry.date}|${entry.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(entry);
    }
  }
  return result;
}

// ---------- parse ----------
const csv1 = readFileSync(resolve(ROOT, "datasets/search_engine_data.csv"), "utf8");
const csv2 = readFileSync(resolve(ROOT, "datasets/search_engine_data_2.csv"), "utf8");

const entries = mergeEntries(parseCSV(csv1), parseCSV(csv2));

// ---------- render TypeScript ----------
const entryLines = entries
  .map((e) => {
    const colorPart = e.color ? `, color: "${e.color}"` : "";
    const nameSafe = e.name.replace(/"/g, '\\"');
    return `  { name: "${nameSafe}", value: ${e.value}, date: "${e.date}"${colorPart} },`;
  })
  .join("\n");

const output = `// AUTO-GENERATED — do not edit manually.
// Re-generate with: node scripts/generateSearchEngines.mjs
import type { Dataset } from "../types/index";

export const searchEnginesDataset: Dataset = {
  title: "Search Engine Market Share (2009–2024)",
  valueLabel: "Market Share (%)",
  dateFormat: "month-year",
  entries: [
${entryLines}
  ],
};
`;

const outPath = resolve(ROOT, "src/data/searchEngines.ts");
writeFileSync(outPath, output, "utf8");
console.log(`Written ${entries.length} entries → ${outPath}`);
