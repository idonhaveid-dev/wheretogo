import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

await loadDotEnv();

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs");

const HOT_FILE = "today_hot_places.csv";                       // primary input
const VERIFIED_FILE = "naver_place_verified_candidates.csv";   // supplement: sample_titles + weak_match rows
const RISING_FILE = "naver_category_today_rising_places.csv";  // supplement: snapshot date + today metrics
const OUTPUT_FILE = "today_hot_places_normalized.csv";
const REPORT_FILE = "today_hot_places_normalized_report.md";

// weak_match rows are excluded by default; opt in with INCLUDE_WEAK=1.
const INCLUDE_WEAK = String(process.env.INCLUDE_WEAK || "0") === "1";

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

async function readCsvOrNull(file) {
  try {
    return parseCsv(await readFile(path.join(OUTPUT_DIR, file), "utf8"));
  } catch {
    return null;
  }
}

function placeKey(category, region, candidateName) {
  return `${category}::${region}::${candidateName}`;
}

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && String(value).trim() !== "" ? parsed : fallback;
}

// Maps a hot row to recommendation-ready name fields based on its match_type.
function normalizeNames(row) {
  const candidateName = row.candidate_name || "";
  const placeTitle = row.naver_place_title || "";

  switch (row.match_type) {
    case "exact_place":
      return { display_name: placeTitle, official_place_name: placeTitle, event_name: "", alias_name: "" };
    case "event_on_place":
      return { display_name: candidateName, official_place_name: placeTitle, event_name: candidateName, alias_name: "" };
    case "alias_match":
      return { display_name: candidateName, official_place_name: placeTitle, event_name: "", alias_name: candidateName };
    default: // weak_match (only when INCLUDE_WEAK=1) and any other type.
      return { display_name: candidateName, official_place_name: placeTitle, event_name: "", alias_name: "" };
  }
}

function hotScore(row) {
  const baseCount = num(row.today_count, num(row.blog_post_count, 0));
  const liftValue = num(row.lift, 1);
  const matchFactor = num(row.match_score, 0) / 100;
  return Number((baseCount * liftValue * matchFactor).toFixed(2));
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

function buildReport(normalized) {
  const byType = countBy(normalized, "match_type");
  const byCategory = countBy(normalized, "category");
  const top20 = normalized.slice(0, 20);
  const events = normalized.filter((row) => row.match_type === "event_on_place");
  const aliases = normalized.filter((row) => row.match_type === "alias_match");

  return [
    "# Today Hot Places (Normalized) Report",
    "",
    `- Snapshot date: ${normalized[0]?.date || ""}`,
    `- Total candidates: ${normalized.length}`,
    `- Include weak_match: ${INCLUDE_WEAK ? "yes" : "no"}`,
    "",
    "## Candidates by match_type",
    "",
    table(byType.map(([type, count]) => ({ match_type: type, count })), ["match_type", "count"]),
    "",
    "## Candidates by category",
    "",
    table(byCategory.map(([category, count]) => ({ category, count })), ["category", "count"]),
    "",
    "## Top 20 by hot_score",
    "",
    table(top20, ["rank", "display_name", "region", "category", "match_type", "hot_score", "today_count", "blog_post_count", "match_score"]),
    "",
    "## event_on_place",
    "",
    table(events, ["rank", "display_name", "official_place_name", "region", "hot_score"]),
    "",
    "## alias_match",
    "",
    table(aliases, ["rank", "display_name", "official_place_name", "region", "hot_score"])
  ].join("\n");
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const hotRows = await readCsvOrNull(HOT_FILE);
  if (!hotRows) {
    throw new Error(`Missing ${HOT_FILE}. Run "npm run build:today-hot" first.`);
  }

  // Supplement 1: verified candidates give us sample_titles, and the weak_match rows
  // that today_hot_places.csv already filtered out.
  const verifiedRows = (await readCsvOrNull(VERIFIED_FILE)) || [];
  const verifiedByKey = new Map();
  for (const row of verifiedRows) {
    verifiedByKey.set(placeKey(row.category, row.region, row.candidate_name), row);
  }

  // Supplement 2: today-rising metrics + the snapshot date.
  const risingRows = (await readCsvOrNull(RISING_FILE)) || [];
  const risingByKey = new Map();
  let snapshotDate = "";
  for (const row of risingRows) {
    risingByKey.set(placeKey(row.category, row.region, row.candidate_name), row);
    if (row.date && (!snapshotDate || row.date > snapshotDate)) snapshotDate = row.date;
  }
  if (!snapshotDate) snapshotDate = new Date().toISOString().slice(0, 10);

  // Base working set = the curated today_hot rows (exact_place / event_on_place / alias_match).
  const working = hotRows.map((row) => ({
    ...row,
    sample_titles: verifiedByKey.get(placeKey(row.category, row.region, row.candidate_name))?.sample_titles || ""
  }));

  // Optionally append weak_match rows sourced from the verified candidates file.
  if (INCLUDE_WEAK) {
    const present = new Set(working.map((row) => placeKey(row.category, row.region, row.candidate_name)));
    for (const row of verifiedRows) {
      if (row.match_type !== "weak_match") continue;
      const key = placeKey(row.category, row.region, row.candidate_name);
      if (present.has(key)) continue;
      const rising = risingByKey.get(key);
      working.push({
        ...row,
        today_count: rising?.today_count || "",
        previous_average: rising?.previous_average || "",
        lift: rising?.lift || ""
      });
    }
  }

  const normalized = working
    .map((row) => {
      const names = normalizeNames(row);
      return {
        date: snapshotDate,
        category: row.category,
        region: row.region,
        candidate_name: row.candidate_name,
        ...names,
        match_type: row.match_type,
        candidate_type: row.candidate_type,
        naver_place_category: row.naver_place_category,
        blog_post_count: row.blog_post_count,
        today_count: row.today_count || "",
        previous_average: row.previous_average || "",
        lift: row.lift || "",
        match_score: row.match_score,
        hot_score: hotScore(row),
        address: row.address,
        roadAddress: row.roadAddress,
        mapx: row.mapx,
        mapy: row.mapy,
        naver_place_link: row.naver_place_link,
        sample_titles: row.sample_titles || "",
        sample_links: row.sample_links || ""
      };
    })
    .sort((a, b) =>
      b.hot_score - a.hot_score ||
      num(b.blog_post_count, 0) - num(a.blog_post_count, 0) ||
      num(b.match_score, 0) - num(a.match_score, 0)
    )
    .map((row, index) => ({ rank: index + 1, ...row }));

  const columns = [
    "rank", "date", "category", "region", "candidate_name", "display_name", "official_place_name",
    "event_name", "alias_name", "match_type", "candidate_type", "naver_place_category",
    "blog_post_count", "today_count", "previous_average", "lift", "match_score", "hot_score",
    "address", "roadAddress", "mapx", "mapy", "naver_place_link", "sample_titles", "sample_links"
  ];

  const outPath = path.join(OUTPUT_DIR, OUTPUT_FILE);
  await writeFile(outPath, toCsv(normalized, columns), "utf8");

  const reportPath = path.join(OUTPUT_DIR, REPORT_FILE);
  await writeFile(reportPath, `﻿${buildReport(normalized)}`, "utf8");

  const typeSummary = countBy(normalized, "match_type").map(([type, count]) => `${type}: ${count}`).join(", ");
  console.log(`Normalized ${normalized.length} place(s) (INCLUDE_WEAK=${INCLUDE_WEAK ? 1 : 0}, date=${snapshotDate}).`);
  console.log(`  ${typeSummary}`);
  console.log(`Output written to ${outPath}`);
  console.log(`Report written to ${reportPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
