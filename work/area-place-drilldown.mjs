import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs");
const TARGET_AREA = process.env.TARGET_AREA || "성수";
const INPUT = path.join(OUTPUT_DIR, "naver_latest_posts_with_places.csv");

const VISIT_INTENT_REGEX = /카페|맛집|팝업|전시|데이트|나들이|놀거리|가볼만한곳|핫플|방문|다녀온|여행|투어|브런치|디저트|커피|식당|공원|미술관|갤러리|쇼룸|플래그십|스토어/;
const NON_RECOMMENDATION_REGEX = /아파트|매물|전세|월세|경매|분양|변호사|소송|선거|투표|장례|화환|폐유|병원|콘센트|배관|수리|교체|보험|대출|주식|반도체|채용|입시|학원/;
const AREA_ALIASES = new Map([
  ["성수", ["성수", "성수동", "성수역", "성수점", "서울숲", "뚝섬", "연무장길"]],
  ["연남동", ["연남", "연남동"]],
  ["한남동", ["한남", "한남동"]],
  ["잠실", ["잠실", "송리단길", "석촌호수", "롯데월드몰"]],
  ["여의도", ["여의도", "더현대", "더현대서울"]],
  ["홍대", ["홍대", "연남", "상수", "합정"]]
]);

const STOP_TERMS = new Set([
  TARGET_AREA, "서울", "수도권", "오늘", "주말", "방문", "후기", "일상", "나들이",
  "데이트", "카페", "맛집", "팝업", "전시", "추천", "정보", "정리", "모음", "핫플",
  "가볼만한곳", "내돈내산", "웨이팅", "주차", "메뉴", "가격", "기간", "현장", "예약",
  "솔직후기", "총정리", "꿀팁", "서울숲", "성수동", "성수점", "성수역", "뚝섬",
  "동맛집", "역맛집", "술집", "감성카페", "베이커리", "가성비맛집", "가성비술집",
  "데이트맛집", "동술집", "성동구맛집", "서울베이커리"
]);

const CATEGORY_RULES = [
  ["popup", /팝업|스토어|플래그십|쇼룸|브랜드/],
  ["exhibition", /전시|갤러리|미술관|박물관|아트/],
  ["cafe", /카페|커피|로스터|베이커리|디저트|오븐|빵|도넛|크림|라떼/],
  ["restaurant", /맛집|식당|다이닝|레스토랑|라멘|파스타|피자|타코|버거|국밥|이자카야|술집|고기|한식|중식|양식/],
  ["activity", /공방|원데이클래스|사격|양궁|놀거리|투어|피크닉/]
];

const BRAND_HINTS = [
  "토코보", "이니스프리", "클리오", "포켓몬", "포켓몬스터", "파파존스", "토이스토리",
  "라코스테", "올리브영", "무신사", "레이브", "헬로키티", "실바니안", "롬앤",
  "티르티르", "바닐라코", "라코스테 폴로 팩토리", "서울국제정원박람회",
  "포켓몬 시크릿 포레스트", "메타몽 놀이터", "피제리아 소셜클럽", "보어드앤헝그리",
  "모리몰리", "크로하우스", "노이 성수점", "멘야포모", "능동미나리", "도토리오븐",
  "안탭리", "아임도넛", "한음", "ETF베이커리", "프렌즈앤야드", "베통", "한정선",
  "아웃오브오더", "오우칸", "쎄비 하우스", "파사드패턴"
];

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

function normalizeText(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[()[\]{}"'“”‘’!?.,:;|/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function areaTerms(area) {
  return AREA_ALIASES.get(area) || [area];
}

function includesArea(row) {
  const text = `${row.title} ${row.description}`;
  if (TARGET_AREA === "성수") {
    return /(?<![가-힣A-Za-z0-9])성수(?:동|역|점)?(?!산|산업|[가-힣A-Za-z0-9])|서울숲|뚝섬|연무장길/.test(text);
  }
  return areaTerms(TARGET_AREA).some((term) => text.includes(term));
}

function isVisitPost(row) {
  const text = `${row.title} ${row.description}`;
  return VISIT_INTENT_REGEX.test(text) && !NON_RECOMMENDATION_REGEX.test(text);
}

function classify(term, text) {
  const haystack = `${term} ${text}`;
  for (const [category, regex] of CATEGORY_RULES) {
    if (regex.test(haystack)) return category;
  }
  return "unknown";
}

function cleanCandidate(term) {
  let cleaned = normalizeText(term)
    .replace(new RegExp(`^${TARGET_AREA}\\s*`), "")
    .replace(/^(서울숲|성수동|뚝섬)\s*/, "")
    .replace(/\s*(후기|추천|정보|총정리|방문기|솔직|내돈내산)$/g, "")
    .trim();

  if (!cleaned || cleaned.length < 2 || cleaned.length > 28) return null;
  if (STOP_TERMS.has(cleaned)) return null;
  if (/\d/.test(cleaned) && cleaned.length > 12) return null;
  if (/영종도|구읍뱃터|부산|명지|신호동/.test(cleaned)) return null;
  if (/^\d+$/.test(cleaned)) return null;
  if (/^[가-힣]+역$/.test(cleaned)) return null;
  return cleaned;
}

function extractCandidates(row) {
  const text = normalizeText(`${row.title} ${row.description}`);
  const candidates = new Set();

  for (const brand of BRAND_HINTS) {
    if (text.includes(brand)) candidates.add(brand);
  }

  const bracketMatches = [...text.matchAll(/\[([^\]]{2,24})\]/g)].map((match) => match[1]);
  for (const match of bracketMatches) {
    if (areaTerms(TARGET_AREA).some((term) => match.includes(term))) {
      candidates.add(match.replace(new RegExp(areaTerms(TARGET_AREA).join("|"), "g"), " "));
    }
  }

  const suffixPattern = /([가-힣A-Za-z0-9&+._ -]{2,24}(?:카페|커피|로스터스|베이커리|식당|다이닝|레스토랑|팝업|스토어|쇼룸|갤러리|미술관|공방|스튜디오|라운지|바|펍|피자|라멘|국시|오븐|하우스|플래그십|맛집|술집|공원|박람회|팩토리))/g;
  for (const match of text.matchAll(suffixPattern)) {
    candidates.add(match[1]);
  }

  const areaNearPattern = new RegExp(`(?:${areaTerms(TARGET_AREA).join("|")})\\s+([가-힣A-Za-z0-9&+._ -]{2,24})`, "g");
  for (const match of text.matchAll(areaNearPattern)) {
    candidates.add(match[1]);
  }

  return [...candidates].map(cleanCandidate).filter(Boolean);
}

function addCount(map, term, row) {
  const text = `${row.title} ${row.description}`;
  const current = map.get(term) || {
    term,
    count: 0,
    category: classify(term, text),
    sample_titles: [],
    sample_links: []
  };
  current.count += 1;
  if (current.sample_titles.length < 5 && !current.sample_titles.includes(row.title)) current.sample_titles.push(row.title);
  if (current.sample_links.length < 5 && !current.sample_links.includes(row.link)) current.sample_links.push(row.link);
  if (current.category === "unknown") current.category = classify(term, text);
  map.set(term, current);
}

function rank(map) {
  return [...map.values()]
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term, "ko"))
    .map((row, index) => ({
      rank: index + 1,
      area: TARGET_AREA,
      candidate_place: row.term,
      category: row.category,
      mention_count: row.count,
      sample_titles: row.sample_titles.join("|"),
      sample_links: row.sample_links.join("|")
    }));
}

async function main() {
  const rows = parseCsv(await readFile(INPUT, "utf8"));
  const areaRows = rows.filter((row) => includesArea(row));
  const visitRows = areaRows.filter(isVisitPost);
  const counts = new Map();

  for (const row of visitRows) {
    for (const candidate of extractCandidates(row)) addCount(counts, candidate, row);
  }

  const ranked = rank(counts);
  const slug = TARGET_AREA.replace(/[^가-힣A-Za-z0-9_-]/g, "_");
  const outputPath = path.join(OUTPUT_DIR, `naver_area_${slug}_venue_candidates_top100.csv`);
  const reportPath = path.join(OUTPUT_DIR, `naver_area_${slug}_drilldown_report.md`);

  await writeFile(
    outputPath,
    toCsv(ranked.slice(0, 100), ["rank", "area", "candidate_place", "category", "mention_count", "sample_titles", "sample_links"]),
    "utf8"
  );

  const report = [
    `# ${TARGET_AREA} Drilldown`,
    "",
    `- Area-matched posts: ${areaRows.length}`,
    `- Visit-context area posts: ${visitRows.length}`,
    `- Venue/place candidates: ${ranked.length}`,
    "",
    "## Top 30",
    "",
    "| rank | candidate | category | mentions |",
    "| --- | --- | --- | --- |",
    ...ranked.slice(0, 30).map((row) => `| ${row.rank} | ${row.candidate_place.replace(/\|/g, "/")} | ${row.category} | ${row.mention_count} |`),
    "",
    "## Readout",
    "",
    "- This file is a drilldown from area-level demand to candidate venues, brands, popups, cafes, restaurants, and landmarks.",
    "- Review the top rows manually, then promote confirmed candidates into a venue alias table."
  ].join("\n");

  await writeFile(reportPath, `\uFEFF${report}`, "utf8");

  console.log(`Area: ${TARGET_AREA}`);
  console.log(`Area posts: ${areaRows.length}`);
  console.log(`Visit-context posts: ${visitRows.length}`);
  console.log(`Candidates: ${ranked.length}`);
  console.log(`Top candidate: ${ranked[0]?.candidate_place || "n/a"} (${ranked[0]?.mention_count || 0})`);
  console.log(`Written: ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
