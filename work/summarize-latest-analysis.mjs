import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs");

const INPUTS = {
  raw: path.join(OUTPUT_DIR, "naver_latest_raw.csv"),
  topics: path.join(OUTPUT_DIR, "naver_latest_topic_keywords_top200.csv"),
  places: path.join(OUTPUT_DIR, "naver_latest_places_top100.csv"),
  postsWithPlaces: path.join(OUTPUT_DIR, "naver_latest_posts_with_places.csv"),
  summary: path.join(OUTPUT_DIR, "naver_latest_summary.csv")
};

const NOISE_TERMS = new Set([
  "서울", "수도권", "오늘", "주말", "방문", "후기", "일상", "나들이", "가볼만한곳", "핫플",
  "장소", "공간", "근처", "추천", "리뷰", "정보", "정리", "모음", "최신", "데이트", "코스",
  "카페", "맛집", "전시", "팝업", "팝업스토어", "무료", "사진", "영상"
]);

const ALIASES = new Map([
  ["성수동", "성수"],
  ["연남", "연남동"],
  ["한남", "한남동"],
  ["더현대 서울", "더현대서울"],
  ["더현대", "더현대서울"],
  ["서울 숲", "서울숲"],
  ["건대입구", "건대"],
  ["석촌 호수", "석촌호수"],
  ["디디피", "DDP"],
  ["동대문디자인플라자", "DDP"],
  ["가로수길", "신사 가로수길"]
]);

const CATEGORY_RULES = [
  ["cafe", /카페|커피|로스터|베이커리|디저트|브런치/],
  ["restaurant", /맛집|식당|다이닝|레스토랑|오마카세|라멘|스시|버거|고기|한식|일식|중식|양식/],
  ["popup_exhibition", /팝업|전시|갤러리|미술관|박물관|쇼룸/],
  ["date_outing", /데이트|나들이|가볼만한곳|핫플|주말/]
];

const VISIT_INTENT_REGEX = /카페|맛집|팝업|전시|데이트|나들이|놀거리|가볼만한곳|핫플|방문|다녀온|여행|투어|브런치|디저트|커피|식당|공원|미술관|갤러리|쇼룸/;
const NON_RECOMMENDATION_REGEX = /아파트|매물|전세|월세|경매|분양|임장|변호사|소송|상담비용|선거|투표|장례|화환|폐유|병원|콘센트|배관|수리|교체|보험|대출|주식|반도체|채용|입시|학원/;

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

function compactTerm(term) {
  return String(term || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePlace(term) {
  const normalized = compactTerm(term);
  if (!normalized || NOISE_TERMS.has(normalized)) return null;
  if (/^\d+$/.test(normalized)) return null;
  if (normalized.length < 2 || normalized.length > 24) return null;
  return ALIASES.get(normalized) || normalized;
}

function mergeList(left = "", right = "", limit = Infinity) {
  return [...new Set(`${left}|${right}`.split("|").map((item) => item.trim()).filter(Boolean))]
    .slice(0, limit)
    .join("|");
}

function top(rows, n = 20) {
  return rows.slice(0, n);
}

function classifyTopic(term) {
  for (const [category, regex] of CATEGORY_RULES) {
    if (regex.test(term)) return category;
  }
  return "other";
}

function toMarkdownTable(rows, columns) {
  if (rows.length === 0) return "_No rows._";
  const header = `| ${columns.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((column) => String(row[column] ?? "").replace(/\|/g, "/")).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

async function readCsv(file) {
  return parseCsv(await readFile(file, "utf8"));
}

function summarizePlaces(placeRows) {
  const merged = new Map();
  for (const row of placeRows) {
    const place = normalizePlace(row.term);
    if (!place) continue;
    const current = merged.get(place) || {
      place,
      mention_count: 0,
      source_terms: "",
      seed_queries: "",
      sample_titles: "",
      sample_links: ""
    };
    current.mention_count += Number(row.count || 0);
    current.source_terms = mergeList(current.source_terms, row.term);
    current.seed_queries = mergeList(current.seed_queries, row.seed_queries);
    current.sample_titles = mergeList(current.sample_titles, row.sample_titles, 5);
    current.sample_links = mergeList(current.sample_links, row.sample_links, 5);
    merged.set(place, current);
  }

  return [...merged.values()]
    .sort((a, b) => b.mention_count - a.mention_count || a.place.localeCompare(b.place, "ko"))
    .map((row, index) => ({ rank: index + 1, ...row }));
}

function summarizeTopics(topicRows) {
  const categoryCounts = new Map();
  for (const row of topicRows) {
    const category = classifyTopic(row.term);
    const current = categoryCounts.get(category) || { category, mention_count: 0, top_terms: [] };
    current.mention_count += Number(row.count || 0);
    if (current.top_terms.length < 8) current.top_terms.push(`${row.term}(${row.count})`);
    categoryCounts.set(category, current);
  }

  return [...categoryCounts.values()]
    .sort((a, b) => b.mention_count - a.mention_count)
    .map((row, index) => ({ rank: index + 1, ...row, top_terms: row.top_terms.join(", ") }));
}

function summarizeVisitPlaces(postsWithPlaces) {
  const counts = new Map();
  let visitPostCount = 0;

  for (const row of postsWithPlaces) {
    const text = `${row.title} ${row.description}`;
    if (!VISIT_INTENT_REGEX.test(text)) continue;
    if (NON_RECOMMENDATION_REGEX.test(text)) continue;
    visitPostCount += 1;

    const places = [...new Set((row.places || "").split("|").map(normalizePlace).filter(Boolean))];
    for (const place of places) {
      const current = counts.get(place) || {
        place,
        mention_count: 0,
        seed_queries: "",
        sample_titles: "",
        sample_links: ""
      };
      current.mention_count += 1;
      current.seed_queries = mergeList(current.seed_queries, row.seed_query);
      current.sample_titles = mergeList(current.sample_titles, row.title, 5);
      current.sample_links = mergeList(current.sample_links, row.link, 5);
      counts.set(place, current);
    }
  }

  return {
    visitPostCount,
    rows: [...counts.values()]
      .sort((a, b) => b.mention_count - a.mention_count || a.place.localeCompare(b.place, "ko"))
      .map((row, index) => ({ rank: index + 1, ...row }))
  };
}

function judgeHypotheses({ cleanedPlaces, visitPlaces, topicCategories, rawRows, postsWithPlaces, visitPostCount }) {
  const topVisitPlaces = visitPlaces.slice(0, 20).map((row) => row.place);
  const topicMap = Object.fromEntries(topicCategories.map((row) => [row.category, row.mention_count]));
  const cafe = topicMap.cafe || 0;
  const popupExhibition = topicMap.popup_exhibition || 0;
  const placeCoverage = rawRows.length > 0 ? postsWithPlaces.length / rawRows.length : 0;
  const visitCoverage = rawRows.length > 0 ? visitPostCount / rawRows.length : 0;
  const seongsuOrYeonnam = topVisitPlaces.includes("성수") || topVisitPlaces.includes("연남동");

  return [
    {
      question: "사람들이 실제로 많이 언급하는 장소는 어디인가?",
      answer: visitPlaces.slice(0, 10).map((row) => `${row.place}(${row.mention_count})`).join(", ")
    },
    {
      question: "성수, 연남동 같은 지역이 압도적인가?",
      answer: seongsuOrYeonnam ? "상위권에 포함되지만 압도 여부는 방문 맥락 랭킹의 격차를 추가 확인해야 함" : "현재 방문 맥락 TOP 20에서는 압도적이라고 보기 어려움"
    },
    {
      question: "카페보다 팝업스토어가 더 많이 언급되는가?",
      answer: popupExhibition > cafe ? `예. popup_exhibition ${popupExhibition}, cafe ${cafe}` : `아니오. cafe ${cafe}, popup_exhibition ${popupExhibition}`
    },
    {
      question: "장소 단위 랭킹이 만들어지는가?",
      answer: cleanedPlaces.length >= 30 ? `예. 정규화 후 ${cleanedPlaces.length}개 장소 후보, 방문 맥락 ${visitPlaces.length}개 후보` : "아직 약함"
    },
    {
      question: "향후 추천 앱 데이터로 활용 가능한가?",
      answer: placeCoverage >= 0.25 && visitCoverage >= 0.1 ? `가능성 있음. 장소 추출 커버리지 ${(placeCoverage * 100).toFixed(1)}%, 방문 맥락 커버리지 ${(visitCoverage * 100).toFixed(1)}%` : "현재 표본/필터 개선이 먼저 필요"
    }
  ];
}

function buildReport({ summaryRows, cleanedPlaces, visitPlaces, visitPostCount, topicCategories, rawRows, postsWithPlaces }) {
  const summary = Object.fromEntries(summaryRows.map((row) => [row.metric, row.value]));
  const topPlaces = top(cleanedPlaces, 20).map(({ rank, place, mention_count, seed_queries }) => ({
    rank,
    place,
    mention_count,
    seed_queries
  }));
  const topTopics = top(topicCategories, 10);
  const placeCoverage = rawRows.length > 0 ? ((postsWithPlaces.length / rawRows.length) * 100).toFixed(1) : "0.0";
  const visitCoverage = rawRows.length > 0 ? ((visitPostCount / rawRows.length) * 100).toFixed(1) : "0.0";
  const topVisitPlaces = top(visitPlaces, 20).map(({ rank, place, mention_count, seed_queries }) => ({
    rank,
    place,
    mention_count,
    seed_queries
  }));
  const hypothesisRows = judgeHypotheses({ cleanedPlaces, visitPlaces, topicCategories, rawRows, postsWithPlaces, visitPostCount });

  return [
    "# Naver Latest Blog Discovery Report",
    "",
    "## Collection Summary",
    "",
    `- Collected at: ${summary.collected_at || ""}`,
    `- Window: recent ${summary.days || ""} days, since ${summary.since_date || ""}`,
    `- Seed queries: ${summary.seed_queries || ""}`,
    `- Unique blog links: ${summary.unique_blog_links || rawRows.length}`,
    `- Posts with extracted places: ${summary.posts_with_places || postsWithPlaces.length} (${placeCoverage}%)`,
    `- Visit/recommendation-context posts: ${visitPostCount} (${visitCoverage}%)`,
    "",
    "## Visit Context Place Top 20",
    "",
    toMarkdownTable(topVisitPlaces, ["rank", "place", "mention_count", "seed_queries"]),
    "",
    "## Cleaned Place Top 20",
    "",
    toMarkdownTable(topPlaces, ["rank", "place", "mention_count", "seed_queries"]),
    "",
    "## Topic Category Summary",
    "",
    toMarkdownTable(topTopics, ["rank", "category", "mention_count", "top_terms"]),
    "",
    "## MVP Readout",
    "",
    toMarkdownTable(hypothesisRows, ["question", "answer"]),
    "",
    `- Place ranking is ${cleanedPlaces.length >= 30 ? "viable" : "weak"}: ${cleanedPlaces.length} cleaned place candidates remain after noise removal.`,
    `- Place extraction coverage is ${placeCoverage}%, visit/recommendation-context coverage is ${visitCoverage}%.`,
    "- Next required step: review the top 100 cleaned places, add alias/noise rules, then rerun this summary.",
    "",
    "## Output Files",
    "",
    "- `naver_latest_places_cleaned_top100.csv`",
    "- `naver_latest_visit_places_top100.csv`",
    "- `naver_latest_topic_category_summary.csv`",
    "- `naver_latest_decision_report.md`"
  ].join("\n");
}

async function main() {
  const [rawRows, topicRows, placeRows, postsWithPlaces, summaryRows] = await Promise.all([
    readCsv(INPUTS.raw),
    readCsv(INPUTS.topics),
    readCsv(INPUTS.places),
    readCsv(INPUTS.postsWithPlaces),
    readCsv(INPUTS.summary)
  ]);

  const cleanedPlaces = summarizePlaces(placeRows);
  const topicCategories = summarizeTopics(topicRows);
  const { rows: visitPlaces, visitPostCount } = summarizeVisitPlaces(postsWithPlaces);
  const report = buildReport({ summaryRows, cleanedPlaces, visitPlaces, visitPostCount, topicCategories, rawRows, postsWithPlaces });

  await writeFile(
    path.join(OUTPUT_DIR, "naver_latest_places_cleaned_top100.csv"),
    toCsv(cleanedPlaces.slice(0, 100), ["rank", "place", "mention_count", "source_terms", "seed_queries", "sample_titles", "sample_links"]),
    "utf8"
  );
  await writeFile(
    path.join(OUTPUT_DIR, "naver_latest_topic_category_summary.csv"),
    toCsv(topicCategories, ["rank", "category", "mention_count", "top_terms"]),
    "utf8"
  );
  await writeFile(
    path.join(OUTPUT_DIR, "naver_latest_visit_places_top100.csv"),
    toCsv(visitPlaces.slice(0, 100), ["rank", "place", "mention_count", "seed_queries", "sample_titles", "sample_links"]),
    "utf8"
  );
  await writeFile(path.join(OUTPUT_DIR, "naver_latest_decision_report.md"), `\uFEFF${report}`, "utf8");

  console.log(`Cleaned place candidates: ${cleanedPlaces.length}`);
  console.log(`Visit-context place candidates: ${visitPlaces.length}`);
  console.log(`Top place: ${cleanedPlaces[0]?.place || "n/a"} (${cleanedPlaces[0]?.mention_count || 0})`);
  console.log(`Outputs written to ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
