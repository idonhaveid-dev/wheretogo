import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

await loadDotEnv();

const CLIENT_ID = process.env.NAVER_CLIENT_ID || process.env.NAVER_SEARCH_CLIENT_ID;
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || process.env.NAVER_SEARCH_CLIENT_SECRET;
const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs");

// Which drilldown file to verify: "verified" (default, conservative) or "cleaned" (broader).
const INPUT = (process.env.INPUT || "verified").toLowerCase();
// Cap how many candidate rows we verify (0 = no cap). Local API allows 25,000 calls/day.
const MAX_CANDIDATES = Number(process.env.MAX_CANDIDATES || 0);
// Delay between API calls to stay polite to the Local API.
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 150);

const INPUT_FILES = {
  verified: "naver_category_region_drilldown_verified_top.csv",
  cleaned: "naver_category_region_drilldown_cleaned_top.csv"
};

// Maps our candidate_type to a regex over the Naver Local "category" string.
const TYPE_CATEGORY_REGEX = {
  restaurant: /음식|한식|일식|중식|양식|분식|고기|회|횟집|식당|뷔페|치킨|곱창|국밥|찌개|해물|포차|술집|주점|이자카야/,
  cafe: /카페|디저트|베이커리|커피|빵/,
  attraction: /관광|명소|축제|전시|미술관|박물관|공원|문화|유적|테마|체험|동물원|식물원|수목원|植/,
  travel_spot: /관광|명소|공원|시장|숙박|호텔|펜션|리조트|해수욕장|해변|유원지|캠핑|글램핑|계곡|산|폭포|항|섬/,
  popup: /쇼핑|백화점|복합|편집|스토어|아울렛/,
  candidate: null
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

function requireEnv() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Missing NAVER_CLIENT_ID or NAVER_CLIENT_SECRET. Put them in .env / .env.example or set PowerShell $env variables.");
  }
}

function stripHtml(value = "") {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
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

function normalize(text) {
  return String(text || "").replace(/\s+/g, "").toLowerCase();
}

// Descriptive words appended to candidate names that hurt Local API recall when searched literally.
const DESCRIPTOR_REGEX = /(수국축제|장미축제|벚꽃축제|봄꽃축제|튤립축제|불꽃축제|빛축제|문화축제|여름축제|꽃축제|축제|맛집|카페)/g;

// Strips descriptor words, leaving the core proper-noun part of the candidate name.
function coreName(name) {
  return String(name || "").replace(DESCRIPTOR_REGEX, " ").replace(/\s+/g, " ").trim();
}

// Ordered, de-duplicated query attempts: full -> name only -> descriptor-stripped core.
function buildQueries(candidate) {
  const region = String(candidate.region || "").trim();
  const name = String(candidate.candidate_name || "").trim();
  const queries = [];
  const push = (value) => {
    const query = String(value || "").replace(/\s+/g, " ").trim();
    if (query.length >= 2 && !queries.includes(query)) queries.push(query);
  };
  push(`${region} ${name}`);
  push(name);
  push(coreName(name));
  return queries;
}

async function fetchLocal(query) {
  const url = new URL("https://openapi.naver.com/v1/search/local.json");
  url.searchParams.set("query", query);
  url.searchParams.set("display", "5");
  url.searchParams.set("start", "1");
  url.searchParams.set("sort", "random");

  const response = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": CLIENT_ID,
      "X-Naver-Client-Secret": CLIENT_SECRET
    }
  });
  if (!response.ok) {
    throw new Error(`Naver Local API failed for "${query}" (${response.status}): ${await response.text()}`);
  }
  const items = (await response.json()).items || [];
  return items.map((item) => ({
    title: stripHtml(item.title),
    link: item.link || "",
    category: stripHtml(item.category),
    description: stripHtml(item.description),
    telephone: item.telephone || "",
    address: item.address || "",
    roadAddress: item.roadAddress || "",
    mapx: item.mapx || "",
    mapy: item.mapy || ""
  }));
}

// Scores a single Local API result against the candidate. Returns { score, breakdown }.
function scoreItem(item, candidate, index) {
  const region = normalize(candidate.region);
  const name = normalize(candidate.candidate_name);
  // The candidate name often already contains the region; compare the region-free remainder too.
  const nameNoRegion = name.replace(region, "");
  const title = normalize(item.title);
  const addressBlob = normalize(`${item.address} ${item.roadAddress} ${item.title}`);
  const auxBlob = normalize(`${item.description} ${item.title} ${item.category}`);

  let score = 0;

  const nameInTitle = (nameNoRegion.length >= 2 && title.includes(nameNoRegion)) || (name.length >= 2 && title.includes(name));
  if (nameInTitle) score += 40;

  const regionMatch = region.length >= 2 && addressBlob.includes(region);
  if (regionMatch) score += 20;

  const typeRegex = TYPE_CATEGORY_REGEX[candidate.candidate_type];
  const typeMatch = typeRegex ? typeRegex.test(item.category) : false;
  if (typeMatch) score += 20;

  if (index === 0) score += 10;

  // Auxiliary match: candidate name appears in description/category even if not in title.
  const auxMatch = !nameInTitle && nameNoRegion.length >= 2 && auxBlob.includes(nameNoRegion);
  if (auxMatch) score += 10;

  return { score, nameInTitle, regionMatch, typeMatch, firstResult: index === 0, auxMatch };
}

const EVENT_REGEX = /축제|페스타|박람회|전시/;
const TRADE_SUFFIX_REGEX = /(호텔|모텔|펜션|리조트|콘도|게스트하우스|민박|식당|맛집|카페|베이커리|레스토랑|다이닝|술집|펍|바)$/;

// Returns { status, type }. match_status is fully determined by match_type.
//   exact_place    -> verified
//   event_on_place -> review   (event candidate matched the underlying place/event)
//   alias_match    -> review   (region+trade candidate matched by locality/region)
//   weak_match     -> review   (some relevant signal, not strong enough to verify)
//   wrong_region   -> rejected (results exist but the place is the wrong one)
//   no_result      -> rejected (no search results)
function classifyMatch(candidate, best, breakdown, hasResults, score) {
  if (!hasResults || !best) return { status: "rejected", type: "no_result" };

  const region = normalize(candidate.region);
  const core = normalize(coreName(candidate.candidate_name));
  const coreNoRegion = core.replace(region, "");
  const title = normalize(best.title);
  const titleAddr = normalize(`${best.title} ${best.address} ${best.roadAddress}`);

  const fullNameInTitle = breakdown.nameInTitle;
  const regionInPlace = breakdown.regionMatch;
  const coreInTitle = (core.length >= 2 && title.includes(core)) ||
    (coreNoRegion.length >= 2 && title.includes(coreNoRegion));
  const isEvent = EVENT_REGEX.test(candidate.candidate_name || "");

  const tradeMatch = String(candidate.candidate_name || "").match(TRADE_SUFFIX_REGEX);
  const localityPart = tradeMatch ? normalize(String(candidate.candidate_name).slice(0, tradeMatch.index)) : "";
  const localityInPlace = localityPart.length >= 2 && titleAddr.includes(localityPart);

  // 1. Strong, unambiguous match: full name in the title and the region lines up.
  if (fullNameInTitle && regionInPlace && score >= 80) {
    return { status: "verified", type: "exact_place" };
  }
  // Rule 1: an event candidate that matched the underlying place (or an event in the right region).
  if (isEvent && (coreInTitle || regionInPlace)) {
    return { status: "review", type: "event_on_place" };
  }
  // Rule 2: a region+trade candidate matched via the locality token or the region.
  if (tradeMatch && (regionInPlace || localityInPlace)) {
    return { status: "review", type: "alias_match" };
  }
  // Name matches but the place sits elsewhere -> very likely a different place.
  if ((fullNameInTitle || coreInTitle) && !regionInPlace) {
    return { status: "rejected", type: "wrong_region" };
  }
  // Some relevant signal (region / category / auxiliary text) but not strong enough to verify.
  if (regionInPlace || breakdown.typeMatch || breakdown.auxMatch) {
    return { status: "review", type: "weak_match" };
  }
  // Rule 3: results exist but title/address/category are all unrelated to the candidate.
  return { status: "rejected", type: "wrong_region" };
}

async function main() {
  requireEnv();
  await mkdir(OUTPUT_DIR, { recursive: true });

  const inputFile = INPUT_FILES[INPUT];
  if (!inputFile) {
    throw new Error(`Unknown INPUT="${INPUT}". Use "verified" or "cleaned".`);
  }

  const inputPath = path.join(OUTPUT_DIR, inputFile);
  const candidates = parseCsv(await readFile(inputPath, "utf8"));
  const limited = MAX_CANDIDATES > 0 ? candidates.slice(0, MAX_CANDIDATES) : candidates;
  console.log(`Verifying ${limited.length} candidate(s) from ${inputFile} via Naver Local API...`);

  const queryCache = new Map();
  const results = [];

  for (let i = 0; i < limited.length; i += 1) {
    const candidate = limited[i];
    const queries = buildQueries(candidate);
    const attempted = [];

    let best = null;
    let bestScore = -1;
    let bestQuery = "";
    let bestBreakdown = null;
    let hasResults = false;

    for (const query of queries) {
      attempted.push(query);

      let items;
      if (queryCache.has(query)) {
        items = queryCache.get(query);
      } else {
        items = await fetchLocal(query);
        queryCache.set(query, items);
        await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
      }

      if (items.length > 0) hasResults = true;
      items.forEach((item, index) => {
        const breakdown = scoreItem(item, candidate, index);
        if (breakdown.score > bestScore) {
          bestScore = breakdown.score;
          best = item;
          bestQuery = query;
          bestBreakdown = breakdown;
        }
      });

      if (bestScore >= 80) break; // already verified; no need to fall back further.
    }

    const score = best ? bestScore : 0;
    const { status: matchStatus, type: matchType } = classifyMatch(candidate, best, bestBreakdown || {}, hasResults, score);

    results.push({
      category: candidate.category,
      region: candidate.region,
      candidate_name: candidate.candidate_name,
      candidate_type: candidate.candidate_type,
      blog_post_count: candidate.post_count,
      query: queries[0] || "",
      attempted_queries: attempted.join(" | "),
      matched_query: best ? bestQuery : "",
      match_status: matchStatus,
      match_type: matchType,
      match_score: score,
      naver_place_title: best?.title || "",
      naver_place_category: best?.category || "",
      naver_place_description: best?.description || "",
      address: best?.address || "",
      roadAddress: best?.roadAddress || "",
      mapx: best?.mapx || "",
      mapy: best?.mapy || "",
      naver_place_link: best?.link || "",
      sample_titles: candidate.sample_titles || "",
      sample_links: candidate.sample_links || ""
    });

    console.log(
      `[${i + 1}/${limited.length}] ${matchStatus.padEnd(8)} ${matchType.padEnd(14)} (${score}) ${best ? bestQuery : queries[0]}` +
        (best ? ` -> ${best.title} [${best.category}]` : " -> no result") +
        (attempted.length > 1 ? ` {tried ${attempted.length}}` : "")
    );
  }

  const columns = [
    "category", "region", "candidate_name", "candidate_type", "blog_post_count",
    "query", "attempted_queries", "matched_query", "match_status", "match_type",
    "match_score", "naver_place_title", "naver_place_category", "naver_place_description",
    "address", "roadAddress", "mapx", "mapy", "naver_place_link",
    "sample_titles", "sample_links"
  ];

  const sorted = [...results].sort((a, b) => b.match_score - a.match_score);
  const outPath = path.join(OUTPUT_DIR, "naver_place_verified_candidates.csv");
  await writeFile(outPath, toCsv(sorted, columns), "utf8");

  const summary = results.reduce((acc, row) => {
    acc.status[row.match_status] = (acc.status[row.match_status] || 0) + 1;
    acc.type[row.match_type] = (acc.type[row.match_type] || 0) + 1;
    return acc;
  }, { status: {}, type: {} });
  console.log(`\nDone. ${results.length} candidate(s), ${queryCache.size} unique query/queries.`);
  console.log(`  status -> verified: ${summary.status.verified || 0}, review: ${summary.status.review || 0}, rejected: ${summary.status.rejected || 0}`);
  console.log(`  type   -> ${Object.entries(summary.type).map(([k, v]) => `${k}: ${v}`).join(", ")}`);
  console.log(`Output written to ${outPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
