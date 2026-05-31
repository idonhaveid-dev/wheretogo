import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const INPUT = path.join(ROOT, "outputs", "today_hot_places_normalized.csv");
const OUTPUT_DIR = path.join(ROOT, "public", "data");
const OUTPUT = path.join(OUTPUT_DIR, "regions.json");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;
  const body = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    const next = body[i + 1];
    if (inQuotes && char === "\"" && next === "\"") {
      value += "\"";
      i += 1;
      continue;
    }
    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && char === ",") {
      row.push(value);
      value = "";
      continue;
    }
    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(value);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      value = "";
      continue;
    }
    value += char;
  }
  row.push(value);
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  const [headers, ...records] = rows;
  return records.map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function slugify(value) {
  return encodeURIComponent(value).replace(/%/g, "");
}

function splitLinks(value) {
  return String(value || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePlace(row) {
  return {
    rank: number(row.rank),
    category: row.category,
    region: row.region,
    display_name: row.display_name,
    official_place_name: row.official_place_name,
    event_name: row.event_name,
    alias_name: row.alias_name,
    match_type: row.match_type,
    candidate_type: row.candidate_type,
    naver_place_category: row.naver_place_category,
    blog_post_count: number(row.blog_post_count),
    today_count: number(row.today_count),
    previous_average: number(row.previous_average),
    lift: number(row.lift, 1),
    match_score: number(row.match_score),
    hot_score: number(row.hot_score),
    address: row.address,
    roadAddress: row.roadAddress,
    mapx: row.mapx,
    mapy: row.mapy,
    naver_place_link: row.naver_place_link,
    sample_links: splitLinks(row.sample_links)
  };
}

async function main() {
  const rows = parseCsv(await readFile(INPUT, "utf8")).map(normalizePlace);
  const byRegion = new Map();

  for (const place of rows) {
    const current = byRegion.get(place.region) || [];
    current.push(place);
    byRegion.set(place.region, current);
  }

  const regions = [...byRegion.entries()]
    .map(([region, places]) => {
      const sortedPlaces = places.sort((a, b) => b.hot_score - a.hot_score || b.blog_post_count - a.blog_post_count);
      return {
        region,
        slug: slugify(region),
        hot_score: Number(sortedPlaces.reduce((sum, place) => sum + place.hot_score, 0).toFixed(2)),
        place_count: sortedPlaces.length,
        top_places: sortedPlaces.slice(0, 4).map((place) => place.display_name),
        categories: [...new Set(sortedPlaces.map((place) => place.category))],
        places: sortedPlaces
      };
    })
    .sort((a, b) => b.hot_score - a.hot_score || b.place_count - a.place_count)
    .map((region, index) => ({ rank: index + 1, ...region }));

  const generatedAt = rows[0]?.date || "";
  const payload = {
    generated_at_label: generatedAt,
    total_places: rows.length,
    regions
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Built ${OUTPUT} (${regions.length} regions, ${rows.length} places)`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
