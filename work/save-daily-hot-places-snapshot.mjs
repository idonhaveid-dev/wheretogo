import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

await loadDotEnv();

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs");
const SNAPSHOT_ROOT = path.join(OUTPUT_DIR, "snapshots");

const INPUT_FILE = "today_hot_places_normalized.csv";
const HISTORY_FILE = "daily_hot_places_history.csv";
const REPORT_FILE = "daily_hot_places_history_report.md";

// Composite key that decides whether a history row is overwritten or appended.
const KEY_COLUMNS = ["date", "category", "region", "display_name", "official_place_name", "match_type"];

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

// Minimal RFC-4180 CSV parser: returns { header, rows }. Handles quoted fields, "" escapes, BOM.
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

  if (records.length === 0) return { header: [], rows: [] };
  const header = records[0];
  const rows = records.slice(1).map((cells) => {
    const obj = {};
    header.forEach((key, index) => {
      obj[key] = cells[index] ?? "";
    });
    return obj;
  });
  return { header, rows };
}

async function readCsvOrNull(filePath) {
  try {
    return parseCsv(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function rowKey(row) {
  return KEY_COLUMNS.map((column) => String(row[column] ?? "")).join("::");
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && String(value).trim() !== "" ? parsed : fallback;
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
  return [...counts.entries()];
}

function buildReport(history, columns, snapshotDate) {
  const byDate = countBy(history, "date").sort((a, b) => String(b[0]).localeCompare(String(a[0])));
  const byType = countBy(history, "match_type").sort((a, b) => b[1] - a[1]);
  const latest = byDate[0]?.[0] || "";
  const latestRows = history
    .filter((row) => row.date === latest)
    .sort((a, b) => num(b.hot_score) - num(a.hot_score))
    .slice(0, 20);

  return [
    "# Daily Hot Places History Report",
    "",
    `- Last snapshot saved: ${snapshotDate}`,
    `- Total history rows: ${history.length}`,
    `- Snapshot dates: ${byDate.length}`,
    `- Columns: ${columns.length}`,
    "",
    "## Rows per snapshot date",
    "",
    table(byDate.map(([date, count]) => ({ date, count })), ["date", "count"]),
    "",
    "## Rows by match_type (all dates)",
    "",
    table(byType.map(([type, count]) => ({ match_type: type, count })), ["match_type", "count"]),
    "",
    `## Latest snapshot (${latest}) — top 20 by hot_score`,
    "",
    table(latestRows, ["rank", "display_name", "region", "category", "match_type", "hot_score", "today_count", "blog_post_count"])
  ].join("\n");
}

async function main() {
  const inputPath = path.join(OUTPUT_DIR, INPUT_FILE);
  const rawText = await readFile(inputPath, "utf8").catch(() => null);
  if (rawText === null) {
    throw new Error(`Missing ${INPUT_FILE}. Run "npm run normalize:today-hot" first.`);
  }

  const { header: columns, rows: snapshotRows } = parseCsv(rawText);
  if (snapshotRows.length === 0) {
    throw new Error(`${INPUT_FILE} has no data rows.`);
  }

  // Snapshot date comes from the normalized file's date column (single snapshot date).
  const dateValue = snapshotRows[0].date;
  const snapshotDate = /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? dateValue : new Date().toISOString().slice(0, 10);

  // 1. Save a dated copy, preserving the exact bytes (BOM included).
  const snapshotDir = path.join(SNAPSHOT_ROOT, snapshotDate);
  await mkdir(snapshotDir, { recursive: true });
  const snapshotPath = path.join(snapshotDir, INPUT_FILE);
  await writeFile(snapshotPath, rawText, "utf8");

  // 2. Upsert into the rolling history file using the composite key.
  const existing = await readCsvOrNull(path.join(OUTPUT_DIR, HISTORY_FILE));
  const historyColumns = existing && existing.header.length > 0
    ? [...new Set([...existing.header, ...columns])]
    : columns;

  const byKey = new Map();
  for (const row of existing?.rows || []) byKey.set(rowKey(row), row);
  let replaced = 0;
  let added = 0;
  for (const row of snapshotRows) {
    const key = rowKey(row);
    if (byKey.has(key)) replaced += 1;
    else added += 1;
    byKey.set(key, row);
  }

  const history = [...byKey.values()].sort((a, b) =>
    String(b.date).localeCompare(String(a.date)) ||
    num(b.hot_score) - num(a.hot_score) ||
    num(a.rank, Infinity) - num(b.rank, Infinity)
  );

  const historyPath = path.join(OUTPUT_DIR, HISTORY_FILE);
  await writeFile(historyPath, toCsv(history, historyColumns), "utf8");

  const reportPath = path.join(OUTPUT_DIR, REPORT_FILE);
  await writeFile(reportPath, `﻿${buildReport(history, historyColumns, snapshotDate)}`, "utf8");

  console.log(`Snapshot ${snapshotDate}: ${snapshotRows.length} row(s) saved.`);
  console.log(`  copied to ${path.relative(ROOT, snapshotPath)}`);
  console.log(`  history upsert -> +${added} added, ${replaced} replaced (total ${history.length} rows across all dates)`);
  console.log(`  report -> ${path.relative(ROOT, reportPath)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
