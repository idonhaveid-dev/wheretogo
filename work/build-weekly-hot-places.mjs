import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs");

const NORMALIZED_FILE = "today_hot_places_normalized.csv";
const HISTORY_FILE = "daily_hot_places_history.csv";
const OUTPUT_FILE = "weekly_hot_places.csv";
const REPORT_FILE = "weekly_hot_places_report.md";
const WINDOW_DAYS = Number(process.env.WEEKLY_WINDOW_DAYS || 7);
// How much a single-day spike counts relative to sustained weekly volume. The base term is the
// full weekly total, so a small weight here keeps the ranking weekly-oriented while still giving
// rising places a nudge. Tunable via env for experimentation.
const SPIKE_WEIGHT = Number(process.env.WEEKLY_SPIKE_WEIGHT || 0.5);

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows, columns) {
  return `\uFEFF${[
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))
  ].join("\n")}`;
}

function parseCsv(text) {
  const clean = text.replace(/^\uFEFF/, "");
  const records = [];
  let field = "";
  let record = [];
  let inQuotes = false;

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (inQuotes) {
      if (char === "\"") {
        if (clean[i + 1] === "\"") {
          field += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === "\"") {
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

async function readCsv(fileName) {
  return parseCsv(await readFile(path.join(OUTPUT_DIR, fileName), "utf8"));
}

async function readCsvOrEmpty(fileName) {
  try {
    return await readCsv(fileName);
  } catch {
    return [];
  }
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

function candidateName(row) {
  return row.candidate_name || row.event_name || row.alias_name || row.display_name || row.official_place_name;
}

function maxDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function key(category, region, name) {
  return `${category}::${region}::${name}`;
}

function table(rows, columns) {
  if (rows.length === 0) return "_No rows._";
  return [
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map((column) => String(row[column] ?? "").replace(/\|/g, "/")).join(" | ")} |`)
  ].join("\n");
}

function buildReport(rows, latestDate, windowStart, windowDateList, dailyByDate) {
  const top20 = rows.slice(0, 20);
  const coverage = windowDateList.map((date) => ({ date, places: dailyByDate.get(date) || 0 }));
  return [
    "# Weekly Hot Places Report",
    "",
    `- Window: ${windowStart} to ${latestDate} (${WINDOW_DAYS} days)`,
    `- Source: daily snapshots accumulated in ${HISTORY_FILE} (+ today from ${NORMALIZED_FILE})`,
    `- Output places: ${rows.length}`,
    "",
    "## Daily coverage in window",
    "",
    "Each day contributes one unbiased daily snapshot. Weekly differentiation grows as more days accumulate.",
    "",
    table(coverage, ["date", "places"]),
    "",
    "## Scoring",
    "",
    "`consistency = 0.5 + 0.5 * (active_days / WINDOW_DAYS)`",
    `\`weekly_hot_score = (weekly_total_count * consistency + ${SPIKE_WEIGHT} * daily_increase) * (match_score / 100)\``,
    "",
    "Sustained weekly volume is the primary signal, scaled up for places active across more days. A daily spike (today above the recent baseline) adds a damped bonus so rising places get a nudge without dominating the weekly ranking.",
    "",
    "## Top 20",
    "",
    table(top20, [
      "rank", "display_name", "region", "category", "weekly_hot_score",
      "weekly_total_count", "active_days", "consistency", "today_count", "previous_6_day_average", "daily_increase"
    ])
  ].join("\n");
}

async function main() {
  const normalizedRows = await readCsv(NORMALIZED_FILE);
  if (normalizedRows.length === 0) {
    throw new Error(`Missing or empty ${NORMALIZED_FILE}. Run "npm run normalize:today-hot" first.`);
  }

  // Prior days come from accumulated daily snapshots (unbiased: each row is that day's own
  // "today_count"). A single crawl cannot reconstruct a real week because the Naver API caps
  // each query at ~1000 newest posts, so older days are truncated. History fixes that over time.
  const historyRows = await readCsvOrEmpty(HISTORY_FILE);

  // "Today" is the date of the current normalized run. The weekly build runs before the snapshot
  // is saved, so today is not yet in history — take it from the normalized file instead.
  const today = normalizedRows.find((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date || ""))?.date
    || historyRows.map((row) => row.date).sort().at(-1);
  const latestDate = historyRows.reduce((acc, row) => maxDate(acc, row.date), today);
  const windowStart = dateAdd(latestDate, -(WINDOW_DAYS - 1));
  const windowDateList = Array.from({ length: WINDOW_DAYS }, (_, index) => dateAdd(windowStart, index));
  const windowDates = new Set(windowDateList);

  // Per place key, map each window date to that day's daily count. Today always comes from the
  // normalized file; prior days from history. Skipping history rows dated today avoids both stale
  // values and a feedback loop once the snapshot has already written today's weekly row back.
  const countsByKey = new Map();
  const metaByKey = new Map();
  const dailyByDate = new Map();

  function record(row, date, dailyCount) {
    if (!windowDates.has(date)) return;
    const rowKey = key(row.category, row.region, candidateName(row));
    const counts = countsByKey.get(rowKey) || new Map();
    counts.set(date, dailyCount);
    countsByKey.set(rowKey, counts);
    dailyByDate.set(date, (dailyByDate.get(date) || 0) + 1);
    const meta = metaByKey.get(rowKey);
    if (!meta || date >= meta.date) metaByKey.set(rowKey, { date, row });
  }

  for (const row of historyRows) {
    if (row.date === today) continue;
    record(row, row.date, num(row.today_count));
  }
  for (const row of normalizedRows) {
    record(row, today, num(row.today_count));
  }

  const weeklyRows = [...countsByKey.entries()]
    .map(([rowKey, counts]) => {
      const row = metaByKey.get(rowKey).row;
      const todayCount = counts.get(latestDate) || 0;
      const weeklyTotal = windowDateList.reduce((sum, date) => sum + (counts.get(date) || 0), 0);
      const activeDays = [...counts.values()].filter((count) => count > 0).length;
      const previousTotal = Math.max(weeklyTotal - todayCount, 0);
      const previousAverage = previousTotal / Math.max(WINDOW_DAYS - 1, 1);
      const weeklyAverage = weeklyTotal / WINDOW_DAYS;
      const dailyIncrease = Math.max(todayCount - previousAverage, 0);
      // Reward places that show up across multiple days, not just one burst (0.5 at 1 day -> 1.0
      // at a full week). Sustained weekly volume is the core signal; the spike is a small bonus.
      const consistency = 0.5 + 0.5 * (activeDays / WINDOW_DAYS);
      const matchFactor = num(row.match_score) / 100;
      const weeklyHotScore = Number(
        ((weeklyTotal * consistency + SPIKE_WEIGHT * dailyIncrease) * matchFactor).toFixed(2)
      );

      return {
        ...row,
        date: latestDate,
        today_count: todayCount,
        window_start: windowStart,
        window_end: latestDate,
        weekly_total_count: weeklyTotal,
        active_days: activeDays,
        consistency: consistency.toFixed(3),
        weekly_average: weeklyAverage.toFixed(2),
        previous_6_day_average: previousAverage.toFixed(2),
        daily_increase: dailyIncrease.toFixed(2),
        weekly_hot_score: weeklyHotScore,
        hot_score: weeklyHotScore
      };
    })
    .sort((a, b) =>
      num(b.weekly_hot_score) - num(a.weekly_hot_score) ||
      num(b.weekly_total_count) - num(a.weekly_total_count) ||
      num(b.match_score) - num(a.match_score)
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));

  const columns = [
    "rank", "date", "window_start", "window_end", "category", "region",
    "candidate_name", "display_name", "official_place_name", "event_name", "alias_name",
    "match_type", "candidate_type", "naver_place_category",
    "blog_post_count", "weekly_total_count", "active_days", "consistency", "weekly_average",
    "today_count", "previous_average", "previous_6_day_average", "daily_increase",
    "lift", "match_score", "weekly_hot_score", "hot_score",
    "address", "roadAddress", "mapx", "mapy", "naver_place_link",
    "sample_titles", "sample_links"
  ];

  const outPath = path.join(OUTPUT_DIR, OUTPUT_FILE);
  await writeFile(outPath, toCsv(weeklyRows, columns), "utf8");
  await writeFile(path.join(OUTPUT_DIR, REPORT_FILE), `\uFEFF${buildReport(weeklyRows, latestDate, windowStart, windowDateList, dailyByDate)}`, "utf8");

  console.log(`Built ${OUTPUT_FILE}: ${weeklyRows.length} place(s), window ${windowStart}..${latestDate}.`);
  console.log(`Report written to ${path.join(OUTPUT_DIR, REPORT_FILE)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
