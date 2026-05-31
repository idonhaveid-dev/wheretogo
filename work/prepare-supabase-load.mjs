import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

await loadDotEnv();

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs");

const INPUT_FILE = "daily_hot_places_history.csv";
const PLACES_FILE = "supabase_load_places.csv";
const SNAPSHOTS_FILE = "supabase_load_hot_place_snapshots.csv";
const ALIASES_FILE = "supabase_load_place_aliases.csv";
const REPORT_FILE = "supabase_load_report.md";

// match_types that contribute a blog-side alias. exact_place does NOT (display == official).
const ALIAS_SOURCE = {
  alias_match: "alias_name",   // e.g. 장승포호텔 -> 하운드호텔 거제 장승포
  event_on_place: "event_name" // e.g. 대청호 장미축제 -> 대청호 반자연수변공원
};

async function loadDotEnv() {
  for (const file of [".env", ".env.example"]) {
    try {
      const body = await readFile(path.join(process.cwd(), file), "utf8");
      for (const line of body.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!match) continue;
        if (!process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    } catch {
      // dotenv files are optional.
    }
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows, columns) {
  return `﻿${[
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))
  ].join("\n")}`;
}

// Minimal RFC-4180 CSV parser: handles quoted fields, "" escapes, embedded commas/newlines, BOM.
function parseCsv(text) {
  const clean = text.replace(/^﻿/, "");
  const rows = [];
  let field = "";
  let record = [];
  let inQuotes = false;

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (inQuotes) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && clean[i + 1] === "\n") i += 1;
      record.push(field);
      field = "";
      if (record.length > 1 || record[0] !== "") rows.push(record);
      record = [];
    } else {
      field += char;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    if (record.length > 1 || record[0] !== "") rows.push(record);
  }

  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((cells) => {
    const obj = {};
    header.forEach((key, index) => {
      obj[key] = cells[index] ?? "";
    });
    return obj;
  });
}

// place identity = official_place_name + roadAddress (mirrors the schema unique key).
function placeNaturalKey(row) {
  return `${row.official_place_name || ""}::${row.roadAddress || ""}`;
}

function table(rows, columns) {
  if (rows.length === 0) return "_No rows._";
  return [
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map((column) => String(row[column] ?? "").replace(/\|/g, "/")).join(" | ")} |`)
  ].join("\n");
}

function countBy(rows, key) {
  const counts = new Map();
  for (const row of rows) counts.set(row[key], (counts.get(row[key]) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function buildReport(history, places, snapshots, aliases) {
  const aliasByType = countBy(aliases, "match_type").map(([type, count]) => ({ match_type: type, count }));
  const snapshotByType = countBy(snapshots, "match_type").map(([type, count]) => ({ match_type: type, count }));
  const emptyMapCoords = places.filter((place) => place.map_x === "" || place.map_y === "").length;
  const emptyLinks = places.filter((place) => place.naver_place_link === "").length;

  return [
    "# Supabase Load (Dry-Run) Report",
    "",
    "> Dry-run only. No Supabase connection, no inserts. These CSVs are the staged",
    "> payloads a real loader would upsert into the schema in `supabase/schema.sql`.",
    "",
    `- Input: outputs/${INPUT_FILE}`,
    `- Input rows: ${history.length}`,
    `- Distinct places (official_place_name + roadAddress): ${places.length}`,
    `- hot_place_snapshots rows: ${snapshots.length}`,
    `- place_aliases rows: ${aliases.length}`,
    `- Places missing map_x/map_y: ${emptyMapCoords}`,
    `- Places missing naver_place_link: ${emptyLinks}`,
    "",
    "## snapshots by match_type",
    "",
    table(snapshotByType, ["match_type", "count"]),
    "",
    "## aliases by match_type (exact_place excluded by design)",
    "",
    table(aliasByType, ["match_type", "count"]),
    "",
    "## Sample places (first 10)",
    "",
    table(places.slice(0, 10), ["place_id", "official_place_name", "road_address", "map_x", "map_y"]),
    "",
    "## Sample aliases (first 10)",
    "",
    table(aliases.slice(0, 10), ["place_id", "alias_name", "match_type"]),
    "",
    "## NULL handling for the real loader",
    "",
    "Empty strings are kept as-is in these CSVs. The loader must convert `''` -> SQL `NULL` for:",
    "",
    "- places: `map_x`, `map_y`, `naver_place_link`, `address`, `road_address`, `naver_place_category`",
    "- hot_place_snapshots: `today_count`, `lift`, `previous_average`, `event_name`, `rank`, `hot_score`",
    "",
    "Load order (FK-safe): places -> hot_place_snapshots -> place_aliases.",
    "`place_id` here is a deterministic dry-run surrogate; a real loader resolves the natural",
    "key (official_place_name + road_address) to the DB-generated `places.id` (uuid).",
    "",
    "Upsert keys (ON CONFLICT ... DO UPDATE):",
    "- places: (official_place_name, road_address)",
    "- hot_place_snapshots: (snapshot_date, category, region, display_name, place_id, match_type)",
    "- place_aliases: (place_id, alias_name, match_type)"
  ].join("\n");
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const inputPath = path.join(OUTPUT_DIR, INPUT_FILE);
  const history = parseCsv(await readFile(inputPath, "utf8").catch(() => {
    throw new Error(`Missing ${INPUT_FILE}. Run "npm run save:snapshot" first.`);
  }));
  if (history.length === 0) throw new Error(`${INPUT_FILE} has no data rows.`);

  // 1. Dedupe places by official_place_name + roadAddress; assign a deterministic place_id.
  const placeByKey = new Map();
  const places = [];
  for (const row of history) {
    const key = placeNaturalKey(row);
    if (placeByKey.has(key)) continue;
    const place = {
      place_id: places.length + 1,
      official_place_name: row.official_place_name || "",
      naver_place_category: row.naver_place_category || "",
      address: row.address || "",
      road_address: row.roadAddress || "",
      map_x: row.mapx || "",
      map_y: row.mapy || "",
      naver_place_link: row.naver_place_link || ""
    };
    placeByKey.set(key, place);
    places.push(place);
  }

  // 2. Every history row becomes a hot_place_snapshots row, referencing its place_id.
  const snapshots = history.map((row) => ({
    place_id: placeByKey.get(placeNaturalKey(row)).place_id,
    snapshot_date: row.date || "",
    category: row.category || "",
    region: row.region || "",
    display_name: row.display_name || "",
    event_name: row.event_name || "",
    match_type: row.match_type || "",
    candidate_type: row.candidate_type || "",
    rank: row.rank || "",
    hot_score: row.hot_score || "",
    blog_post_count: row.blog_post_count || "",
    today_count: row.today_count || "",
    previous_average: row.previous_average || "",
    lift: row.lift || "",
    match_score: row.match_score || "",
    sample_titles: row.sample_titles || "",
    sample_links: row.sample_links || ""
  }));

  // 3. Aliases only for alias_match / event_on_place; dedupe by (place_id, alias_name, match_type).
  const aliasByKey = new Map();
  for (const row of history) {
    const sourceColumn = ALIAS_SOURCE[row.match_type];
    if (!sourceColumn) continue; // exact_place / weak_match -> no alias
    const aliasName = (row[sourceColumn] || "").trim();
    if (!aliasName) continue;
    const placeId = placeByKey.get(placeNaturalKey(row)).place_id;
    const key = `${placeId}::${aliasName}::${row.match_type}`;
    if (aliasByKey.has(key)) continue;
    aliasByKey.set(key, { place_id: placeId, alias_name: aliasName, match_type: row.match_type });
  }
  const aliases = [...aliasByKey.values()];

  const placeColumns = ["place_id", "official_place_name", "naver_place_category", "address", "road_address", "map_x", "map_y", "naver_place_link"];
  const snapshotColumns = ["place_id", "snapshot_date", "category", "region", "display_name", "event_name", "match_type", "candidate_type", "rank", "hot_score", "blog_post_count", "today_count", "previous_average", "lift", "match_score", "sample_titles", "sample_links"];
  const aliasColumns = ["place_id", "alias_name", "match_type"];

  await writeFile(path.join(OUTPUT_DIR, PLACES_FILE), toCsv(places, placeColumns), "utf8");
  await writeFile(path.join(OUTPUT_DIR, SNAPSHOTS_FILE), toCsv(snapshots, snapshotColumns), "utf8");
  await writeFile(path.join(OUTPUT_DIR, ALIASES_FILE), toCsv(aliases, aliasColumns), "utf8");
  await writeFile(path.join(OUTPUT_DIR, REPORT_FILE), `﻿${buildReport(history, places, snapshots, aliases)}`, "utf8");

  console.log(`Dry-run staged from ${history.length} history row(s):`);
  console.log(`  places:              ${places.length} -> ${PLACES_FILE}`);
  console.log(`  hot_place_snapshots: ${snapshots.length} -> ${SNAPSHOTS_FILE}`);
  console.log(`  place_aliases:       ${aliases.length} -> ${ALIASES_FILE}`);
  console.log(`  report:              ${REPORT_FILE}`);
  console.log("No Supabase connection, no inserts (dry-run only).");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
