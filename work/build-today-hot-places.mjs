import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs");

const VERIFIED_FILE = "naver_place_verified_candidates.csv";
const RISING_FILE = "naver_category_today_rising_places.csv"; // optional enrichment
const OUTPUT_FILE = "today_hot_places.csv";

// A candidate is "hot" if the Local API confirmed it (verified) or matched a trustworthy
// place type: exact_place, an event mapped onto a real place, or a region+trade alias.
const HOT_MATCH_TYPES = new Set(["exact_place", "event_on_place", "alias_match"]);

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

function placeKey(category, region, candidateName) {
  return `${category}::${region}::${candidateName}`;
}

async function readCsvOrNull(file) {
  try {
    return parseCsv(await readFile(path.join(OUTPUT_DIR, file), "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const verified = await readCsvOrNull(VERIFIED_FILE);
  if (!verified) {
    throw new Error(`Missing ${VERIFIED_FILE}. Run "npm run verify:places" first.`);
  }

  // Optional: today-rising signal (today_count / previous_average / lift) keyed by place.
  const risingRows = await readCsvOrNull(RISING_FILE);
  const risingByKey = new Map();
  for (const row of risingRows || []) {
    risingByKey.set(placeKey(row.category, row.region, row.candidate_name), row);
  }
  if (!risingRows) {
    console.log(`Note: ${RISING_FILE} not found, today_count/lift columns will be blank.`);
  }

  const hot = verified
    .filter((row) => row.match_status === "verified" || HOT_MATCH_TYPES.has(row.match_type))
    .map((row) => {
      const rising = risingByKey.get(placeKey(row.category, row.region, row.candidate_name));
      return {
        category: row.category,
        region: row.region,
        candidate_name: row.candidate_name,
        candidate_type: row.candidate_type,
        blog_post_count: row.blog_post_count,
        match_status: row.match_status,
        match_type: row.match_type,
        match_score: row.match_score,
        today_count: rising?.today_count || "",
        previous_average: rising?.previous_average || "",
        lift: rising?.lift || "",
        naver_place_title: row.naver_place_title,
        naver_place_category: row.naver_place_category,
        address: row.address,
        roadAddress: row.roadAddress,
        mapx: row.mapx,
        mapy: row.mapy,
        naver_place_link: row.naver_place_link,
        sample_links: row.sample_links
      };
    })
    .sort((a, b) =>
      Number(b.today_count || 0) - Number(a.today_count || 0) ||
      Number(b.match_score || 0) - Number(a.match_score || 0) ||
      Number(b.blog_post_count || 0) - Number(a.blog_post_count || 0)
    );

  const columns = [
    "category", "region", "candidate_name", "candidate_type", "blog_post_count",
    "match_status", "match_type", "match_score", "today_count", "previous_average", "lift",
    "naver_place_title", "naver_place_category", "address", "roadAddress",
    "mapx", "mapy", "naver_place_link", "sample_links"
  ];

  const outPath = path.join(OUTPUT_DIR, OUTPUT_FILE);
  await writeFile(outPath, toCsv(hot, columns), "utf8");

  console.log(`Selected ${hot.length} hot place(s) from ${verified.length} verified candidate(s) (verified OR match_type in ${[...HOT_MATCH_TYPES].join("/")}).`);
  console.log(`Output written to ${outPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
