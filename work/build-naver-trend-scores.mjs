// OPTIONAL EXPERIMENT — not part of the core pipeline.
//
// Naver's Search Trend (DataLab) API is deprecated and shuts down on 2026-07-23 18:00 KST. This
// script enriches weekly_hot_places.csv with a trend signal into a SEPARATE file
// (naver_trend_scores.csv) and never mutates weekly_hot_places.csv. Run via
// `npm run experiment:naver-trends`. It is intentionally excluded from `npm run build` and the
// daily snapshot pipeline. Any failure (missing keys, API shutdown, network/auth error) is
// non-fatal: the script writes whatever it can, prints a warning, and exits 0 so nothing that
// chains after it breaks.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

await loadDotEnv();

const CLIENT_ID = process.env.NAVER_CLIENT_ID || process.env.NAVER_SEARCH_CLIENT_ID;
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || process.env.NAVER_SEARCH_CLIENT_SECRET;
const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs");

const INPUT_FILE = "weekly_hot_places.csv";
const OUTPUT_FILE = "naver_trend_scores.csv";
const REPORT_FILE = "naver_trend_scores_report.md";

// Daily accumulation (this experiment runs daily until the API shuts down). The latest result stays
// in OUTPUT_FILE; every run is also archived under a dated folder and upserted into a rolling
// history file so the trend signal can be tracked over time. None of this touches the core pipeline.
const SNAPSHOT_ROOT = path.join(OUTPUT_DIR, "trend_snapshots");
const HISTORY_FILE = "naver_trend_scores_history.csv";
const HISTORY_REPORT_FILE = "naver_trend_scores_history_report.md";
// Composite key per the spec. Re-running on the same date fully replaces that date's rows.
const HISTORY_KEY_COLUMNS = ["date", "category", "region", "display_name", "trend_keyword"];
// The accumulation date is the run/measurement date (today), overridable for deterministic tests.
const TREND_RUN_DATE = (process.env.TREND_RUN_DATE || "").trim();

// Only fetch trends for the strongest weekly candidates by default. DataLab is rate-limited and
// the tail of the weekly list is mostly zero-volume rows, so 30 keeps the run cheap and focused.
const TREND_TOP_N = Number(process.env.TREND_TOP_N || 30);
// Delay between DataLab calls to stay polite to the API.
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 250);
// DataLab accepts up to 5 keyword groups per request.
const GROUPS_PER_REQUEST = 5;
// Optional override; otherwise we anchor on the latest date in weekly_hot_places.csv.
const TREND_END_DATE = (process.env.TREND_END_DATE || "").trim();

const DATALAB_URL = "https://openapi.naver.com/v1/datalab/search";

// Naver Search Trend (DataLab) API is being retired. After this moment the API is expected to stop
// responding, so we skip network calls entirely and emit a passthrough result instead of erroring.
const DEPRECATION_NOTICE = "Search Trend is deprecated and ends 2026-07-23";
const DEPRECATION_TS = Date.parse("2026-07-23T18:00:00+09:00");

// Names that are too common to trend on their own — we prepend the region so DataLab measures the
// place we mean ("강릉 중앙시장") rather than every market in the country ("중앙시장").
const GENERIC_TOKENS = [
  "시장", "해변", "해수욕장", "공원", "호수공원", "수목원", "식물원", "축제", "페스타",
  "다이닝", "파인다이닝", "계곡", "해안", "폭포", "온천", "생고기", "호텔", "모텔", "펜션"
];

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

function parseCsv(text) {
  const clean = text.replace(/^﻿/, "");
  const records = [];
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
      if (record.length > 1 || record[0] !== "") records.push(record);
      record = [];
    } else {
      field += char;
    }
  }

  if (field !== "" || record.length > 0) {
    record.push(field);
    if (record.length > 1 || record[0] !== "") records.push(record);
  }

  if (records.length === 0) return [];
  const header = records[0];
  return records.slice(1).map((cells) => {
    const row = {};
    header.forEach((key, index) => {
      row[key] = cells[index] ?? "";
    });
    return row;
  });
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && String(value ?? "").trim() !== "" ? parsed : fallback;
}

function dateAdd(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isGeneric(name) {
  const n = String(name || "").trim();
  if (!n) return true;
  if (n.length <= 4) return true; // short names ("중앙시장", "안목해변") collide with many places
  return GENERIC_TOKENS.some((token) => n === token || n.endsWith(token));
}

// Picks the trend keyword by the agreed priority and, when that keyword is too generic, adds a
// region-qualified variant so DataLab measures this specific place. Returns the keyword group plus
// the primary keyword used for display.
function buildKeywordGroup(row) {
  const primary = (row.event_name || row.alias_name || row.candidate_name || row.display_name || row.official_place_name || "").trim();
  const region = (row.region || "").trim();
  const keywords = [];

  if (isGeneric(primary) && region && !primary.startsWith(region)) {
    const qualified = `${region} ${primary}`;
    keywords.push(qualified, primary);
  } else {
    keywords.push(primary);
  }

  const deduped = [...new Set(keywords.filter(Boolean))].slice(0, 5);
  return { keywords: deduped, primary: deduped[0] || primary };
}

async function fetchTrendBatch(groups, body) {
  const response = await fetch(DATALAB_URL, {
    method: "POST",
    headers: {
      "X-Naver-Client-Id": CLIENT_ID,
      "X-Naver-Client-Secret": CLIENT_SECRET,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ...body, keywordGroups: groups })
  });
  if (!response.ok) {
    throw new Error(`DataLab API failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  return (await response.json()).results || [];
}

// Splits a DataLab daily series into the recent 30-day window and the prior 30-day window, then
// computes per-window averages and the smoothed growth ratio.
function scoreSeries(dataPoints, recentStart, previousStart, previousEnd) {
  let recentSum = 0;
  let recentCount = 0;
  let previousSum = 0;
  let previousCount = 0;

  for (const point of dataPoints) {
    const period = point.period;
    const ratio = num(point.ratio);
    if (period >= recentStart) {
      recentSum += ratio;
      recentCount += 1;
    } else if (period >= previousStart && period <= previousEnd) {
      previousSum += ratio;
      previousCount += 1;
    }
  }

  // Average over the full window length (30 days), not just days DataLab returned points for, so a
  // place that trends on only a handful of days is not flattered by averaging over those days only.
  const recentAvg = recentSum / 30;
  const previousAvg = previousSum / 30;
  const trendGrowth = recentAvg / (previousAvg + 1);

  return {
    recent_30d_avg: Number(recentAvg.toFixed(2)),
    previous_30d_avg: Number(previousAvg.toFixed(2)),
    trend_growth: Number(trendGrowth.toFixed(4)),
    _recentCount: recentCount,
    _previousCount: previousCount
  };
}

async function readCsvOrNull(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    const clean = text.replace(/^﻿/, "");
    const rows = parseCsv(text);
    const headerLine = clean.split(/\r?\n/)[0] || "";
    const header = headerLine ? headerLine.split(",").map((h) => h.replace(/^"|"$/g, "")) : Object.keys(rows[0] || {});
    return { header, rows };
  } catch {
    return null;
  }
}

function rowKey(row) {
  return HISTORY_KEY_COLUMNS.map((column) => String(row[column] ?? "")).join("::");
}

// Single-word status for the history report: ok / no_data / skip:<reason> / error.
function statusOf(row) {
  const error = String(row.error || "");
  if (!error) return "ok";
  if (error === "no_trend_data") return "no_data";
  if (error === "no_api_key" || error === "api_deprecated") return `skip:${error}`;
  return "error";
}

function table(rows, columns) {
  if (rows.length === 0) return "_No rows._";
  return [
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map((column) => String(row[column] ?? "").replace(/\|/g, "/")).join(" | ")} |`)
  ].join("\n");
}

function buildReport({ rows, endDate, startDate, recentStart, apiCalls, okCount, errCount, skipReason }) {
  const byGrowth = [...rows]
    .filter((row) => !row.error)
    .sort((a, b) => num(b.trend_growth) - num(a.trend_growth))
    .slice(0, 10);
  const byFinal = [...rows]
    .sort((a, b) => num(b.final_hot_score) - num(a.final_hot_score))
    .slice(0, 10);

  return [
    "# Naver Search Trend Scores Report (OPTIONAL EXPERIMENT)",
    "",
    `> ⚠️ ${DEPRECATION_NOTICE}.`,
    "> This is an optional experiment. It writes a separate `naver_trend_scores.csv` and never",
    "> modifies `weekly_hot_places.csv`. It is excluded from `npm run build` and the daily pipeline,",
    "> and any API failure / shutdown / missing key is non-fatal (the run still exits successfully).",
    "",
    skipReason
      ? `- **Live API skipped** (\`${skipReason}\`): no trend signal applied; final_hot_score = weekly_hot_score (passthrough).`
      : "- Live API called.",
    `- Source: ${INPUT_FILE} (top ${TREND_TOP_N} by weekly rank)`,
    `- Comparison window: previous 30d [${startDate}..${dateAdd(recentStart, -1)}] vs recent 30d [${recentStart}..${endDate}]`,
    `- DataLab call: timeUnit=date, ${GROUPS_PER_REQUEST} groups/request, ${REQUEST_DELAY_MS}ms delay`,
    `- API requests made: ${apiCalls}`,
    `- Candidates scored OK: ${okCount} · errored: ${errCount}`,
    "",
    "## Scoring",
    "",
    "`trend_growth = recent_30d_avg / (previous_30d_avg + 1)`",
    "`trend_score = min(trend_growth, 5) * 10`",
    "`final_hot_score = weekly_hot_score * 0.7 + trend_score * 0.3`",
    "",
    "DataLab ratios are relative within each request (period max = 100), but the recent-vs-previous",
    "ratio is scale-invariant per keyword group, so trend_growth is comparable across rows.",
    "",
    "## Top 10 by trend_growth",
    "",
    table(byGrowth, ["rank", "display_name", "region", "trend_keyword", "recent_30d_avg", "previous_30d_avg", "trend_growth", "trend_score"]),
    "",
    "## Top 10 by final_hot_score",
    "",
    table(byFinal, ["rank", "display_name", "region", "trend_keyword", "weekly_hot_score", "trend_score", "final_hot_score", "error"])
  ].join("\n");
}

function buildHistoryReport(history, runDate) {
  const dates = [...new Set(history.map((row) => row.date))].sort((a, b) => String(b).localeCompare(String(a)));

  // Per-date success/fail/skip breakdown.
  const perDate = dates.map((date) => {
    const rowsForDate = history.filter((row) => row.date === date);
    const tally = { date, total: rowsForDate.length, ok: 0, no_data: 0, skip: 0, error: 0, skip_reason: "" };
    for (const row of rowsForDate) {
      const status = statusOf(row);
      if (status === "ok") tally.ok += 1;
      else if (status === "no_data") tally.no_data += 1;
      else if (status.startsWith("skip:")) { tally.skip += 1; tally.skip_reason = status.slice(5); }
      else tally.error += 1;
    }
    return tally;
  });

  const latest = dates[0] || runDate;
  const latestTop = history
    .filter((row) => row.date === latest)
    .sort((a, b) => num(b.final_hot_score) - num(a.final_hot_score))
    .slice(0, 10);

  return [
    "# Naver Search Trend Scores — History (OPTIONAL EXPERIMENT)",
    "",
    `> ⚠️ ${DEPRECATION_NOTICE}.`,
    "> Accumulated daily until the API shuts down. Separate from the core pipeline; never modifies",
    "> `weekly_hot_places.csv`. API failure / missing key / shutdown is non-fatal (run still exits 0).",
    "",
    `- History file: ${HISTORY_FILE}`,
    `- Snapshot folder: trend_snapshots/<date>/${OUTPUT_FILE}`,
    `- Run dates accumulated: ${dates.length}`,
    `- Total history rows: ${history.length}`,
    `- History key: ${HISTORY_KEY_COLUMNS.join(" + ")}`,
    "",
    "## Per-date status (success / no_data / skip / error)",
    "",
    table(perDate, ["date", "total", "ok", "no_data", "skip", "error", "skip_reason"]),
    "",
    `## Latest run (${latest}) — top 10 by final_hot_score`,
    "",
    table(latestTop, ["rank", "display_name", "region", "trend_keyword", "trend_growth", "trend_score", "weekly_hot_score", "final_hot_score", "error"])
  ].join("\n");
}

async function main() {
  // Decide up front whether we can/should call the API. None of these are fatal — the experiment
  // simply produces a passthrough result (final_hot_score = weekly_hot_score, error noted).
  let skipReason = "";
  if (Number.isFinite(DEPRECATION_TS) && Date.now() > DEPRECATION_TS) {
    skipReason = "api_deprecated";
  } else if (!CLIENT_ID || !CLIENT_SECRET) {
    skipReason = "no_api_key";
  }
  if (skipReason) {
    console.warn(`[experiment] Skipping live DataLab calls (${skipReason}). ${DEPRECATION_NOTICE}.`);
  }

  const inputRows = parseCsv(await readFile(path.join(OUTPUT_DIR, INPUT_FILE), "utf8"));
  if (inputRows.length === 0) {
    throw new Error(`Missing or empty ${INPUT_FILE}. Run "npm run build:weekly-hot" first.`);
  }

  const candidates = inputRows
    .slice()
    .sort((a, b) => num(a.rank, 1e9) - num(b.rank, 1e9))
    .slice(0, TREND_TOP_N);

  // endDate anchors on the latest weekly date (or an explicit override); the 60-day span gives us a
  // 30-day recent window and a 30-day previous window for the growth comparison.
  const latestDate = inputRows.reduce((acc, row) => (row.date && row.date > acc ? row.date : acc), "");
  const endDate = TREND_END_DATE || latestDate || new Date().toISOString().slice(0, 10);
  // Accumulation/measurement date = today (the day this experiment ran), distinct from the trend
  // window's endDate which is anchored on the weekly candidates. Daily runs accumulate by run date.
  const runDate = TREND_RUN_DATE || new Date().toISOString().slice(0, 10);
  const startDate = dateAdd(endDate, -59);
  const recentStart = dateAdd(endDate, -29);
  const previousEnd = dateAdd(recentStart, -1);
  const requestBody = { startDate, endDate, timeUnit: "date" };

  // Build one keyword group per candidate, with collision-safe group names so the response can be
  // matched back to its row even when two rows share a keyword (e.g. 서문시장 food + travel).
  const usedNames = new Map();
  const enriched = candidates.map((row) => {
    const { keywords, primary } = buildKeywordGroup(row);
    let groupName = primary;
    const seen = usedNames.get(groupName) || 0;
    if (seen > 0) groupName = `${primary} #${num(row.rank, seen + 1)}`;
    usedNames.set(primary, seen + 1);
    return { row, keywords, primary, groupName };
  });

  const byGroupName = new Map(enriched.map((entry) => [entry.groupName, entry]));
  const resultByGroupName = new Map();
  let apiCalls = 0;

  if (skipReason) {
    for (const entry of enriched) {
      resultByGroupName.set(entry.groupName, { error: skipReason });
    }
  }

  for (let i = 0; !skipReason && i < enriched.length; i += GROUPS_PER_REQUEST) {
    const batch = enriched.slice(i, i + GROUPS_PER_REQUEST);
    const groups = batch.map((entry) => ({ groupName: entry.groupName, keywords: entry.keywords }));
    apiCalls += 1;
    try {
      const results = await fetchTrendBatch(groups, requestBody);
      for (const result of results) {
        const entry = byGroupName.get(result.title);
        if (!entry) continue;
        resultByGroupName.set(result.title, scoreSeries(result.data || [], recentStart, startDate, previousEnd));
      }
      // Groups DataLab silently dropped (no title echoed back) get a zero-volume score.
      for (const entry of batch) {
        if (!resultByGroupName.has(entry.groupName)) {
          resultByGroupName.set(entry.groupName, { recent_30d_avg: 0, previous_30d_avg: 0, trend_growth: 0, _recentCount: 0, _previousCount: 0, _empty: true });
        }
      }
    } catch (error) {
      for (const entry of batch) {
        resultByGroupName.set(entry.groupName, { error: error.message });
      }
      console.error(`Batch ${Math.floor(i / GROUPS_PER_REQUEST) + 1} failed: ${error.message}`);
    }
    if (i + GROUPS_PER_REQUEST < enriched.length) await sleep(REQUEST_DELAY_MS);
  }

  let okCount = 0;
  let errCount = 0;
  const rows = enriched.map((entry) => {
    const { row, keywords, primary, groupName } = entry;
    const scored = resultByGroupName.get(groupName) || { error: "no result" };
    const weeklyHot = num(row.weekly_hot_score);

    if (scored.error) {
      errCount += 1;
      return {
        rank: row.rank,
        date: runDate,
        window_end: endDate,
        category: row.category,
        region: row.region,
        display_name: row.display_name,
        official_place_name: row.official_place_name,
        trend_keyword: primary,
        trend_keywords: keywords.join("|"),
        recent_30d_avg: "",
        previous_30d_avg: "",
        trend_growth: "",
        trend_score: "",
        weekly_hot_score: weeklyHot,
        match_score: row.match_score,
        // No trend signal available: pass the core weekly score through unchanged so this optional
        // experiment never penalizes the ranking just because the deprecated API was unreachable.
        final_hot_score: weeklyHot,
        error: scored.error
      };
    }

    okCount += 1;
    const trendScore = Number((Math.min(scored.trend_growth, 5) * 10).toFixed(2));
    const finalHotScore = Number((weeklyHot * 0.7 + trendScore * 0.3).toFixed(2));
    return {
      rank: row.rank,
      date: runDate,
      window_end: endDate,
      category: row.category,
      region: row.region,
      display_name: row.display_name,
      official_place_name: row.official_place_name,
      trend_keyword: primary,
      trend_keywords: keywords.join("|"),
      recent_30d_avg: scored.recent_30d_avg,
      previous_30d_avg: scored.previous_30d_avg,
      trend_growth: scored.trend_growth,
      trend_score: trendScore,
      weekly_hot_score: weeklyHot,
      match_score: row.match_score,
      final_hot_score: finalHotScore,
      error: scored._empty ? "no_trend_data" : ""
    };
  });

  const columns = [
    "rank", "date", "window_end", "category", "region", "display_name", "official_place_name",
    "trend_keyword", "trend_keywords", "recent_30d_avg", "previous_30d_avg",
    "trend_growth", "trend_score", "weekly_hot_score", "match_score", "final_hot_score", "error"
  ];

  // 1. Latest result (always the newest run) + its report.
  const latestCsv = toCsv(rows, columns);
  await writeFile(path.join(OUTPUT_DIR, OUTPUT_FILE), latestCsv, "utf8");
  await writeFile(
    path.join(OUTPUT_DIR, REPORT_FILE),
    `﻿${buildReport({ rows, endDate, startDate, recentStart, apiCalls, okCount, errCount, skipReason })}`,
    "utf8"
  );

  // 2. Dated snapshot — exact bytes of this run's latest CSV.
  const snapshotDir = path.join(SNAPSHOT_ROOT, runDate);
  await mkdir(snapshotDir, { recursive: true });
  const snapshotPath = path.join(snapshotDir, OUTPUT_FILE);
  await writeFile(snapshotPath, latestCsv, "utf8");

  // 3. Rolling history — replace this run date's rows wholesale, keep all other dates.
  const existing = await readCsvOrNull(path.join(OUTPUT_DIR, HISTORY_FILE));
  const historyColumns = existing && existing.header.length > 0
    ? [...new Set([...existing.header, ...columns])]
    : columns;
  const otherDates = (existing?.rows || []).filter((row) => row.date !== runDate);
  // Dedupe today's rows by the composite key (keep last) before appending.
  const todayByKey = new Map(rows.map((row) => [rowKey(row), row]));
  const todayRows = [...todayByKey.values()];
  const history = [...otherDates, ...todayRows].sort((a, b) =>
    String(b.date).localeCompare(String(a.date)) ||
    num(b.final_hot_score) - num(a.final_hot_score) ||
    num(a.rank, Infinity) - num(b.rank, Infinity)
  );
  await writeFile(path.join(OUTPUT_DIR, HISTORY_FILE), toCsv(history, historyColumns), "utf8");
  await writeFile(
    path.join(OUTPUT_DIR, HISTORY_REPORT_FILE),
    `﻿${buildHistoryReport(history, runDate)}`,
    "utf8"
  );

  const replacedDate = (existing?.rows || []).some((row) => row.date === runDate);
  console.log(`Built ${OUTPUT_FILE}: ${rows.length} candidate(s), ${apiCalls} API call(s), ${okCount} ok / ${errCount} errored${skipReason ? ` (skipped: ${skipReason})` : ""}.`);
  console.log(`Window: previous [${startDate}..${previousEnd}] vs recent [${recentStart}..${endDate}].`);
  console.log(`Snapshot -> ${path.relative(ROOT, snapshotPath)}`);
  console.log(`History (${HISTORY_FILE}): run date ${runDate} ${replacedDate ? "replaced" : "added"}, ${history.length} row(s) across all dates.`);
  console.log(`Reports -> ${REPORT_FILE}, ${HISTORY_REPORT_FILE}`);
}

// Optional experiment: never fail the caller. Log and exit 0 so anything that chains after it
// (or a CI step that happens to invoke it) is unaffected by the deprecated API or a setup gap.
main().catch((error) => {
  console.warn(`[experiment] naver-trends did not complete: ${error.message}`);
  console.warn(`[experiment] ${DEPRECATION_NOTICE}. weekly_hot_places.csv is untouched.`);
});
