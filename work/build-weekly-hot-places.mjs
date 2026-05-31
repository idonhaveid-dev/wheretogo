import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs");

const NORMALIZED_FILE = "today_hot_places_normalized.csv";
const PLACE_DAILY_FILE = "naver_category_place_daily_counts.csv";
const OUTPUT_FILE = "weekly_hot_places.csv";
const REPORT_FILE = "weekly_hot_places_report.md";
const WINDOW_DAYS = Number(process.env.WEEKLY_WINDOW_DAYS || 7);

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

function buildReport(rows, latestDate, windowStart, dailyRows) {
  const top20 = rows.slice(0, 20);
  return [
    "# Weekly Hot Places Report",
    "",
    `- Window: ${windowStart} to ${latestDate} (${WINDOW_DAYS} days)`,
    `- Daily count rows: ${dailyRows.length}`,
    `- Output places: ${rows.length}`,
    "",
    "## Scoring",
    "",
    "`weekly_hot_score = (weekly_average + max(today_count - previous_6_day_average, 0)) * (match_score / 100)`",
    "",
    "This keeps steady weekly volume, then adds a daily spike bonus only when today is above the recent baseline.",
    "",
    "## Top 20",
    "",
    table(top20, [
      "rank", "display_name", "region", "category", "weekly_hot_score",
      "weekly_total_count", "weekly_average", "today_count", "previous_6_day_average", "daily_increase"
    ])
  ].join("\n");
}

async function main() {
  const normalizedRows = await readCsv(NORMALIZED_FILE);
  if (normalizedRows.length === 0) {
    throw new Error(`Missing or empty ${NORMALIZED_FILE}. Run "npm run normalize:today-hot" first.`);
  }

  const dailyRows = await readCsv(PLACE_DAILY_FILE);
  if (dailyRows.length === 0) {
    throw new Error(`Missing or empty ${PLACE_DAILY_FILE}. Run "npm run analyze:categories" first.`);
  }

  const latestDate = dailyRows.map((row) => row.date).sort().at(-1);
  const windowStart = dateAdd(latestDate, -(WINDOW_DAYS - 1));
  const windowDates = new Set(Array.from({ length: WINDOW_DAYS }, (_, index) => dateAdd(windowStart, index)));

  const countsByKey = new Map();
  for (const row of dailyRows) {
    if (!windowDates.has(row.date)) continue;
    const rowKey = key(row.category, row.region, row.candidate_name);
    const current = countsByKey.get(rowKey) || new Map();
    current.set(row.date, (current.get(row.date) || 0) + num(row.post_count));
    countsByKey.set(rowKey, current);
  }

  const weeklyRows = normalizedRows
    .map((row) => {
      const name = candidateName(row);
      const counts = countsByKey.get(key(row.category, row.region, name)) || new Map();
      const todayCount = counts.get(latestDate) || num(row.today_count);
      const weeklyTotal = [...windowDates].reduce((sum, date) => sum + (counts.get(date) || 0), 0);
      const activeDays = [...counts.values()].filter((count) => count > 0).length;
      const previousTotal = Math.max(weeklyTotal - todayCount, 0);
      const previousAverage = previousTotal / Math.max(WINDOW_DAYS - 1, 1);
      const weeklyAverage = weeklyTotal / WINDOW_DAYS;
      const dailyIncrease = Math.max(todayCount - previousAverage, 0);
      const matchFactor = num(row.match_score) / 100;
      const weeklyHotScore = Number(((weeklyAverage + dailyIncrease) * matchFactor).toFixed(2));

      return {
        ...row,
        window_start: windowStart,
        window_end: latestDate,
        weekly_total_count: weeklyTotal,
        active_days: activeDays,
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
    "blog_post_count", "weekly_total_count", "active_days", "weekly_average",
    "today_count", "previous_average", "previous_6_day_average", "daily_increase",
    "lift", "match_score", "weekly_hot_score", "hot_score",
    "address", "roadAddress", "mapx", "mapy", "naver_place_link",
    "sample_titles", "sample_links"
  ];

  const outPath = path.join(OUTPUT_DIR, OUTPUT_FILE);
  await writeFile(outPath, toCsv(weeklyRows, columns), "utf8");
  await writeFile(path.join(OUTPUT_DIR, REPORT_FILE), `\uFEFF${buildReport(weeklyRows, latestDate, windowStart, dailyRows)}`, "utf8");

  console.log(`Built ${OUTPUT_FILE}: ${weeklyRows.length} place(s), window ${windowStart}..${latestDate}.`);
  console.log(`Report written to ${path.join(OUTPUT_DIR, REPORT_FILE)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
