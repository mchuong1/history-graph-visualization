/**
 * Parses datasets/billboard_hot100.csv, groups by calendar month, computes a
 * chart score (101 - rank) per song, enriches each unique #1 track with a
 * Deezer 30-second preview URL (free, no auth required), and writes
 * src/data/billboardHot100.ts.
 *
 * ─── Quick start ────────────────────────────────────────────────────────────
 *  1. Download the Kaggle "Billboard The Hot 100 Songs" dataset:
 *       https://www.kaggle.com/datasets/dhruvildave/billboard-the-hot-100-songs
 *     Save the CSV as: datasets/billboard_hot100.csv
 *
 *  2. Generate with audio (Deezer — no signup, works out of the box):
 *       node scripts/generateBillboard.mjs
 *
 *  3. Generate chart data only, no audio:
 *       node scripts/generateBillboard.mjs --no-audio
 *
 *  Preview URLs are cached in datasets/spotify_preview_cache.json so
 *  subsequent runs only fetch what's missing.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── Paths ───────────────────────────────────────────────────────────────────
const CSV_PATH = resolve(ROOT, "datasets/billboard_hot100.csv");
const CACHE_PATH = resolve(ROOT, "datasets/spotify_preview_cache.json");
const OUT_PATH = resolve(ROOT, "src/data/billboardHot100.ts");

// ─── Config ──────────────────────────────────────────────────────────────────
/** Value assigned to rank #1 — lower ranks score proportionally less. */
const MAX_SCORE = 100;
/** Minimum number of months a song must appear to show up in common runs.
 *  Set to 1 to include every charting month. */
const MIN_MONTHS = 1;
/** Delay (ms) between Deezer API requests to stay within rate limits. */
const DEEZER_DELAY_MS = 300;
/** Inclusive start month filter (YYYY-MM). Set to null to include all. */
const START_MONTH = "2021-01";
/** Inclusive end month filter (YYYY-MM). Set to null to include all. */
const END_MONTH = "2021-12";

// ─── Color helper ─────────────────────────────────────────────────────────────
/** Derive a stable, visually distinct HSL color from an artist name. */
function artistColor(artist) {
  let hash = 5381;
  for (let i = 0; i < artist.length; i++) {
    hash = ((hash << 5) + hash) ^ artist.charCodeAt(i);
    hash |= 0;
  }
  const h = Math.abs(hash) % 360;
  // Use a hand-picked range of saturations/lightnesses that look good on a
  // dark background (matches the bg-gray-950 used in the Remotion composition).
  const s = 55 + (Math.abs(hash >> 8) % 25);  // 55–80 %
  const l = 52 + (Math.abs(hash >> 16) % 16); // 52–68 %
  return `hsl(${h}, ${s}%, ${l}%)`;
}

// ─── CSV parsing ──────────────────────────────────────────────────────────────
function parseCSV(raw) {
  const lines = raw.replace(/\r/g, "").trim().split("\n");
  const rawHeaders = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim().toLowerCase());

  // Flexible column detection
  const colDate = rawHeaders.findIndex((h) => h === "date");
  const colRank = rawHeaders.findIndex((h) => h === "rank");
  const colSong = rawHeaders.findIndex((h) => h === "song");
  const colArtist = rawHeaders.findIndex((h) => h === "artist" || h === "performer");

  if ([colDate, colRank, colSong, colArtist].includes(-1)) {
    console.error("❌  Could not find required columns (date, rank, song, artist).");
    console.error("   Found headers:", rawHeaders);
    process.exit(1);
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Handle quoted fields that may contain commas
    const cols = [];
    let inQuote = false;
    let cur = "";
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === "," && !inQuote) { cols.push(cur); cur = ""; }
      else { cur += ch; }
    }
    cols.push(cur);

    const dateRaw = cols[colDate]?.replace(/^"|"$/g, "").trim();
    const rankRaw = parseInt(cols[colRank]?.trim(), 10);
    const song = cols[colSong]?.replace(/^"|"$/g, "").trim();
    const artist = cols[colArtist]?.replace(/^"|"$/g, "").trim();

    if (!dateRaw || isNaN(rankRaw) || !song || !artist) continue;

    // Convert weekly date (YYYY-MM-DD) → month bucket (YYYY-MM)
    const month = dateRaw.slice(0, 7);
    rows.push({ month, rank: rankRaw, song, artist });
  }
  return rows;
}

// ─── Aggregate to monthly ────────────────────────────────────────────────────
/**
 * For each month, for each song, take the best (lowest) rank reached that month.
 * Returns a Map<"YYYY-MM", Array<{song, artist, bestRank}>> sorted ascending by month.
 */
function aggregateMonthly(rows) {
  // key = "YYYY-MM|song|artist"
  const best = new Map();

  for (const { month, rank, song, artist } of rows) {
    if (START_MONTH && month < START_MONTH) continue;
    if (END_MONTH && month > END_MONTH) continue;
    const key = `${month}|${song}|${artist}`;
    const existing = best.get(key);
    if (!existing || rank < existing.rank) {
      best.set(key, { month, song, artist, rank });
    }
  }

  const byMonth = new Map();
  for (const entry of best.values()) {
    if (!byMonth.has(entry.month)) byMonth.set(entry.month, []);
    byMonth.get(entry.month).push(entry);
  }

  // Sort each month's entries by rank ascending
  for (const entries of byMonth.values()) {
    entries.sort((a, b) => a.rank - b.rank);
  }

  // Return sorted by month
  return new Map([...byMonth.entries()].sort());
}

// ─── iTunes helper (no auth required) ───────────────────────────────────────
/**
 * Queries the free Apple iTunes Search API for a 30-second preview URL.
// ─── Deezer helper (no auth required) ────────────────────────────────────────
/**
 * Queries the free Deezer Search API for a 30-second preview URL.
 * No API key or account needed.
 */
async function fetchDeezerPreviewUrl(song, artist) {
  // Strip featured artist suffixes for a cleaner query.
  // e.g. "Dua Lipa Featuring DaBaby" → "Dua Lipa"
  const primaryArtist = artist
    .replace(/\s+(feat\.|featuring|ft\.|&|x)\s+.*/i, "")
    .trim();

  const queries = [
    `track:"${song}" artist:"${primaryArtist}"`,
    `"${song}" "${primaryArtist}"`,
    `"${song}"`,
  ];

  const songLower = song.toLowerCase();
  const artistLower = primaryArtist.toLowerCase();

  for (const q of queries) {
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=10`;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "history-graph-visualization/1.0" },
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data.data?.length) continue;

      // Prefer: preview + title matches + artist matches
      const best =
        data.data.find(
          (r) =>
            r.preview &&
            r.title?.toLowerCase().includes(songLower.slice(0, 8)) &&
            r.artist?.name?.toLowerCase().includes(artistLower.split(" ")[0])
        ) ??
        data.data.find(
          (r) =>
            r.preview &&
            r.title?.toLowerCase().includes(songLower.slice(0, 6))
        ) ??
        data.data.find((r) => r.preview);

      if (best?.preview) return best.preview;
    } catch {
      continue;
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(CSV_PATH)) {
    console.error(`❌  CSV not found at ${CSV_PATH}`);
    console.error("   Download it from: https://www.kaggle.com/datasets/dhruvildave/billboard-the-hot-100-songs");
    process.exit(1);
  }

  console.log("📖  Parsing CSV…");
  const raw = readFileSync(CSV_PATH, "utf8");
  const rows = parseCSV(raw);
  console.log(`   ${rows.length.toLocaleString()} chart entries read`);

  const byMonth = aggregateMonthly(rows);
  console.log(`   ${byMonth.size} months discovered`);

  // ── Audio enrichment ───────────────────────────────────────────────────────
  const noAudio = process.argv.includes("--no-audio");
  const doAudio = !noAudio;

  let previewCache = {};
  if (doAudio) {
    if (existsSync(CACHE_PATH)) {
      previewCache = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
      console.log(`🎵  Loaded ${Object.keys(previewCache).length} cached preview URLs`);
    }

    console.log("🎵  Fetching preview URLs via Deezer (no auth needed)…");

    let fetched = 0;
    let skipped = 0;

    // Collect unique song+artist pairs — only the #1 ranked entry per month
    // needs audio; all other bars are silent.
    const uniquePairs = new Set();
    for (const entries of byMonth.values()) {
      const top = entries[0]; // entries are sorted by rank ascending
      if (top) uniquePairs.add(`${top.song}\x00${top.artist}`);
    }

    for (const pair of uniquePairs) {
      const [song, artist] = pair.split("\x00");
      const cacheKey = `${song}|||${artist}`;
      if (cacheKey in previewCache) { skipped++; continue; }

      const url = await fetchDeezerPreviewUrl(song, artist);

      previewCache[cacheKey] = url;
      fetched++;

      if (fetched % 10 === 0) {
        console.log(`   …fetched ${fetched} (${skipped} cached)`);
        writeFileSync(CACHE_PATH, JSON.stringify(previewCache, null, 2), "utf8");
      }

      await sleep(DEEZER_DELAY_MS);
    }

    writeFileSync(CACHE_PATH, JSON.stringify(previewCache, null, 2), "utf8");
    const found = Object.values(previewCache).filter(Boolean).length;
    console.log(`   Done — ${found} / ${Object.keys(previewCache).length} tracks have preview URLs`);
  } else {
    console.log("ℹ️   Skipping audio enrichment (--no-audio flag set).");
  }

  // ── Build DataEntry records ────────────────────────────────────────────────
  console.log("🏗️   Building DataEntry records…");
  const entries = [];
  let withAudio = 0;

  for (const [month, monthEntries] of byMonth.entries()) {
    const dateIso = `${month}-01`;

    for (const { song, artist, rank } of monthEntries) {
      const value = Math.max(1, MAX_SCORE + 1 - rank); // 101-rank clamped ≥ 1
      const color = artistColor(artist);
      const cacheKey = `${song}|||${artist}`;
      const audioSrc = doAudio && rank === 1 ? (previewCache[cacheKey] ?? undefined) : undefined;
      if (audioSrc) withAudio++;

      entries.push({ name: song, value, date: dateIso, color, audioSrc, artist });
    }
  }

  console.log(`   ${entries.length.toLocaleString()} total entries`);
  if (doAudio) console.log(`   ${withAudio.toLocaleString()} entries have preview audio`);

  // ── Render TypeScript ────────────────────────────────────────────────────--
  const firstDate = entries[0]?.date ?? "";
  const lastDate = entries[entries.length - 1]?.date ?? "";

  const entryLines = entries
    .map((e) => {
      const safe = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      let line = `  { name: "${safe(e.name)}", value: ${e.value}, date: "${e.date}", color: "${e.color}"`;
      if (e.audioSrc) line += `, audioSrc: "${safe(e.audioSrc)}"`;
      line += " },";
      return line;
    })
    .join("\n");

  const output = `// AUTO-GENERATED — do not edit manually.
// Re-generate with: node scripts/generateBillboard.mjs
// With audio (Deezer, no auth): node scripts/generateBillboard.mjs
// Chart data only:              node scripts/generateBillboard.mjs --no-audio
import type { Dataset } from "../types/index";

export const billboardDataset: Dataset = {
  title: "Billboard Hot 100 (${firstDate.slice(0, 7)} – ${lastDate.slice(0, 7)})",
  valueLabel: "Chart Score",
  dateFormat: "month-year",
  entries: [
${entryLines}
  ],
};
`;

  writeFileSync(OUT_PATH, output, "utf8");
  console.log(`✅  Written ${entries.length.toLocaleString()} entries → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("❌  Unexpected error:", err);
  process.exit(1);
});
