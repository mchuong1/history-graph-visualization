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

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── Paths ───────────────────────────────────────────────────────────────────
const CSV_PATH = resolve(ROOT, "datasets/billboard_hot100.csv");
const CACHE_PATH = resolve(ROOT, "datasets/spotify_preview_cache.json");
const COVER_CACHE_PATH = resolve(ROOT, "datasets/billboard_cover_cache.json");
const BPM_CACHE_PATH = resolve(ROOT, "datasets/bpm_cache.json");
const AUDIO_DIR = resolve(ROOT, "public/audio");
const IMAGES_DIR = resolve(ROOT, "public/images");
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

// ─── Deezer helper (no auth required) ────────────────────────────────────────
/**
 * Queries the free Deezer Search API for a 30-second preview URL and album cover.
 * Returns { preview, coverUrl } — either may be null if not found.
 */
async function fetchDeezerData(song, artist, { getBpm = false } = {}) {
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
        data.data.find((r) => r.preview) ??
        data.data[0];

      if (best) {
        // BPM is present in search results for many tracks.
        // Deezer search includes bpm as a numeric field; 0 means unknown.
        let bpm = (typeof best.bpm === "number" && best.bpm > 0) ? best.bpm : null;

        // If caller needs BPM and search result had none, fetch full track object.
        if (getBpm && !bpm && best.id) {
          try {
            const trackRes = await fetch(`https://api.deezer.com/track/${best.id}`, {
              headers: { "User-Agent": "history-graph-visualization/1.0" },
            });
            if (trackRes.ok) {
              const trackData = await trackRes.json();
              bpm = (typeof trackData.bpm === "number" && trackData.bpm > 0) ? trackData.bpm : null;
            }
          } catch { /* ignore */ }
        }

        return {
          preview: best.preview ?? null,
          coverUrl: best.album?.cover_medium ?? best.album?.cover ?? null,
          bpm,
        };
      }
    } catch {
      continue;
    }
  }
  return { preview: null, coverUrl: null, bpm: null };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Downloads a Deezer preview CDN URL to public/audio/<hash>.mp3.
 * Returns the local public path "/audio/<hash>.mp3", or null on failure.
 * Skips download if the file already exists.
 */
async function downloadAudio(cdnUrl, cacheKey) {
  mkdirSync(AUDIO_DIR, { recursive: true });
  // Use a hash of the cache key for a stable, collision-free filename.
  const hash = createHash("sha1").update(cacheKey).digest("hex").slice(0, 16);
  const filename = `${hash}.mp3`;
  const localPath = resolve(AUDIO_DIR, filename);
  const publicPath = `/audio/${filename}`;

  if (existsSync(localPath)) return publicPath; // already downloaded

  try {
    const res = await fetch(cdnUrl, {
      headers: { "User-Agent": "history-graph-visualization/1.0" },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(localPath, buf);
    return publicPath;
  } catch {
    return null;
  }
}

/**
 * Downloads a Deezer cover CDN URL to public/images/<hash>.jpg.
 * Returns the local public path "/images/<hash>.jpg", or null on failure.
 * Skips download if the file already exists.
 */
async function downloadImage(cdnUrl, cacheKey) {
  mkdirSync(IMAGES_DIR, { recursive: true });
  const hash = createHash("sha1").update(cacheKey).digest("hex").slice(0, 16);
  const filename = `${hash}.jpg`;
  const localPath = resolve(IMAGES_DIR, filename);
  const publicPath = `/images/${filename}`;

  if (existsSync(localPath)) return publicPath; // already downloaded

  try {
    const res = await fetch(cdnUrl, {
      headers: { "User-Agent": "history-graph-visualization/1.0" },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(localPath, buf);
    return publicPath;
  } catch {
    return null;
  }
}

/** Renders an inline progress bar that overwrites the current terminal line. */
function renderProgress(done, total, skipped, startMs) {
  const BAR_W = 28;
  const pct = total > 0 ? done / total : 0;
  const filled = Math.round(pct * BAR_W);
  const bar = "█".repeat(filled) + "░".repeat(BAR_W - filled);

  const elapsed = (Date.now() - startMs) / 1000;
  const rate = done > 0 ? elapsed / done : 0;
  const remaining = rate * (total - done);
  const etaStr =
    done === 0
      ? "…"
      : remaining < 60
      ? `${Math.ceil(remaining)}s`
      : `${Math.floor(remaining / 60)}m ${Math.ceil(remaining % 60)}s`;

  const line = `   [${bar}] ${done}/${total} (${Math.round(pct * 100)}%)  cached:${skipped}  ETA: ${etaStr}   `;
  process.stdout.write(`\r${line}`);
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
  let coverCache = {};
  if (doAudio) {
    if (existsSync(CACHE_PATH)) {
      previewCache = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
      // Purge any remaining CDN URLs (hdnea= tokens) — they expire in ~3h.
      // Local /audio/ paths are permanent and never purged.
      let purged = 0;
      for (const [key, url] of Object.entries(previewCache)) {
        if (url && String(url).includes("hdnea=")) {
          delete previewCache[key];
          purged++;
        }
      }
      if (purged > 0) {
        console.log(`⚠️   Purged ${purged} expiring CDN audio URLs — will download locally`);
        writeFileSync(CACHE_PATH, JSON.stringify(previewCache, null, 2), "utf8");
      }
      console.log(`🎵  Loaded ${Object.keys(previewCache).length} locally-cached preview paths`);
    }
    if (existsSync(COVER_CACHE_PATH)) {
      coverCache = JSON.parse(readFileSync(COVER_CACHE_PATH, "utf8"));
      console.log(`🖼️   Loaded ${Object.keys(coverCache).length} cached cover entries`);

      // Migrate any remaining CDN URLs to local files — CDN links can change
      // or expire; local /images/ files are permanent.
      const cdnEntries = Object.entries(coverCache).filter(
        ([, v]) => v && String(v).startsWith("https://")
      );
      if (cdnEntries.length > 0) {
        console.log(`📥  Migrating ${cdnEntries.length} CDN cover URLs → local files…`);
        let migrated = 0;
        const migrateStart = Date.now();
        for (const [key, url] of cdnEntries) {
          const localPath = await downloadImage(url, key);
          coverCache[key] = localPath;
          migrated++;
          renderProgress(migrated, cdnEntries.length, 0, migrateStart);
          if (migrated % 10 === 0) {
            writeFileSync(COVER_CACHE_PATH, JSON.stringify(coverCache, null, 2), "utf8");
          }
        }
        process.stdout.write("\n");
        writeFileSync(COVER_CACHE_PATH, JSON.stringify(coverCache, null, 2), "utf8");
        console.log(`   ✅  Migrated ${migrated} cover images to public/images/`);
      }
    }

    console.log("🎵  Fetching preview + cover URLs via Deezer (no auth needed)…");
    let bpmCache = {};
    if (existsSync(BPM_CACHE_PATH)) {
      bpmCache = JSON.parse(readFileSync(BPM_CACHE_PATH, "utf8"));
      console.log(`\uD83C\uDFBC  Loaded ${Object.keys(bpmCache).length} cached BPM entries`);
    }
    let fetched = 0;
    let skipped = 0;

    // Audio: only the #1 entry per month needs a preview download.
    // Cover art: all entries need it for the visualisations.
    const audioPairs = new Set(); // only rank-1 per month
    const coverPairs = new Set(); // every visible entry
    for (const entries of byMonth.values()) {
      for (let i = 0; i < entries.length; i++) {
        const { song, artist } = entries[i];
        coverPairs.add(`${song}\x00${artist}`);
        if (i === 0) audioPairs.add(`${song}\x00${artist}`); // rank-1 only
      }
    }

    // Merge into one de-duped work list: cover for all, audio only for rank-1s
    const allPairs = [...coverPairs];

    // Count how many actually need fetching
    let toFetch = 0;
    for (const pair of allPairs) {
      const [song, artist] = pair.split("\x00");
      const cacheKey = `${song}|||${artist}`;
      const needsAudio = audioPairs.has(pair) && !(cacheKey in previewCache);
      const needsCover = !(cacheKey in coverCache);
      const needsBpm = audioPairs.has(pair) && !(cacheKey in bpmCache);
      if (needsAudio || needsCover || needsBpm) toFetch++;
      else skipped++;
    }

    console.log(
      `   ${audioPairs.size} #1 tracks for audio, ${coverPairs.size} tracks for covers — ${toFetch} to fetch, ${skipped} already cached`
    );
    if (toFetch === 0) {
      console.log("   ✅  All tracks already cached, skipping API calls.");
    }

    const fetchStart = Date.now();

    for (const pair of allPairs) {
      const [song, artist] = pair.split("\x00");
      const cacheKey = `${song}|||${artist}`;
      const needsAudio = audioPairs.has(pair) && !(cacheKey in previewCache);
      const needsCover = !(cacheKey in coverCache);
      const needsBpm = audioPairs.has(pair) && !(cacheKey in bpmCache);
      if (!needsAudio && !needsCover && !needsBpm) continue;

      const { preview, coverUrl, bpm } = await fetchDeezerData(song, artist, { getBpm: needsBpm });

      if (needsAudio) {
        // Download the mp3 locally so it never expires
        const localPath = preview ? await downloadAudio(preview, cacheKey) : null;
        previewCache[cacheKey] = localPath;
      }
      if (needsCover) {
        // Download the image locally so it never depends on CDN availability
        const localImagePath = coverUrl ? await downloadImage(coverUrl, cacheKey) : null;
        coverCache[cacheKey] = localImagePath;
      }
      if (needsBpm) {
        bpmCache[cacheKey] = bpm; // null if not found
      }
      fetched++;

      renderProgress(fetched, toFetch, skipped, fetchStart);

      if (fetched % 10 === 0) {
        writeFileSync(CACHE_PATH, JSON.stringify(previewCache, null, 2), "utf8");
        writeFileSync(COVER_CACHE_PATH, JSON.stringify(coverCache, null, 2), "utf8");
        writeFileSync(BPM_CACHE_PATH, JSON.stringify(bpmCache, null, 2), "utf8");
      }

      await sleep(DEEZER_DELAY_MS);
    }

    // Move to next line after the inline bar
    if (toFetch > 0) process.stdout.write("\n");

    writeFileSync(CACHE_PATH, JSON.stringify(previewCache, null, 2), "utf8");
    writeFileSync(COVER_CACHE_PATH, JSON.stringify(coverCache, null, 2), "utf8");
    writeFileSync(BPM_CACHE_PATH, JSON.stringify(bpmCache, null, 2), "utf8");
    const found = Object.values(previewCache).filter(Boolean).length;
    const coversFound = Object.values(coverCache).filter(Boolean).length;
    const bpmFound = Object.values(bpmCache).filter((v) => v != null && v > 0).length;
    console.log(`   Done \u2014 ${found} / ${Object.keys(previewCache).length} tracks have preview URLs`);
    console.log(`   Done \u2014 ${coversFound} / ${Object.keys(coverCache).length} tracks have cover art`);
    console.log(`   Done \u2014 ${bpmFound} / ${Object.keys(bpmCache).length} rank-1 tracks have BPM`);
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
      const imageSrc = doAudio ? (coverCache[cacheKey] ?? undefined) : undefined;
      const bpmRaw = doAudio && rank === 1 ? (bpmCache[cacheKey] ?? undefined) : undefined;
      const bpm = typeof bpmRaw === "number" && bpmRaw > 0 ? bpmRaw : undefined;
      if (audioSrc) withAudio++;

      entries.push({ name: song, value, date: dateIso, color, audioSrc, imageSrc, bpm, artist });
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
      if (e.imageSrc) line += `, imageSrc: "${safe(e.imageSrc)}"`;
      if (e.bpm) line += `, bpm: ${e.bpm}`;
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
