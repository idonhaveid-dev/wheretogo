import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

await loadDotEnv();

const CLIENT_ID = process.env.NAVER_CLIENT_ID || process.env.NAVER_SEARCH_CLIENT_ID;
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || process.env.NAVER_SEARCH_CLIENT_SECRET;
const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs");
const DAYS = Number(process.env.DAYS || 7);
const MAX_PER_SEED = Number(process.env.MAX_PER_SEED || 1000);

const DEFAULT_SEEDS = [
  "서울",
  "수도권",
  "주말",
  "오늘",
  "방문",
  "다녀온",
  "후기",
  "일상",
  "나들이",
  "데이트",
  "전시",
  "팝업",
  "핫플",
  "가볼만한곳"
];

const SEEDS = (process.env.SEED_QUERIES || DEFAULT_SEEDS.join(","))
  .split(",")
  .map((seed) => seed.trim())
  .filter(Boolean);

const AREA_TERMS = [
  "서울", "수도권", "성수", "성수동", "연남", "연남동", "한남", "한남동", "을지로", "잠실",
  "홍대", "합정", "망원", "망원동", "상수", "문래", "문래동", "익선동", "안국", "북촌",
  "서촌", "종로", "명동", "강남", "신사", "가로수길", "압구정", "도산공원", "청담",
  "삼성", "코엑스", "선릉", "역삼", "여의도", "더현대", "더현대서울", "서울숲", "뚝섬",
  "건대", "건대입구", "왕십리", "이태원", "해방촌", "녹사평", "용산", "남산", "인사동",
  "광화문", "시청", "동대문", "DDP", "신촌", "이대", "마포", "공덕", "성북", "혜화",
  "대학로", "노량진", "사당", "방배", "서초", "교대", "양재", "송파", "석촌", "석촌호수",
  "올림픽공원", "강동", "천호", "마곡", "상암", "DMC", "김포", "인천", "송도", "판교",
  "분당", "정자", "광교", "수원", "일산", "고양", "파주", "하남", "미사", "남양주",
  "구리", "의정부", "부천", "안양", "과천", "광명"
];

const VENUE_SUFFIXES = [
  "카페", "커피", "로스터스", "베이커리", "식당", "다이닝", "레스토랑", "오마카세",
  "브런치", "바", "펍", "라운지", "팝업", "팝업스토어", "전시", "전시회", "갤러리",
  "미술관", "박물관", "공원", "숲", "시장", "몰", "백화점", "호텔", "스퀘어",
  "플라자", "쇼룸", "스튜디오", "서점", "편집샵"
];

const STOPWORDS = new Set([
  "서울", "수도권", "오늘", "이번", "지난", "최근", "후기", "추천", "방문", "리뷰",
  "정보", "위치", "운영", "시간", "예약", "메뉴", "가격", "주차", "사진", "영상",
  "블로그", "네이버", "일상", "정리", "모음", "최신", "생각", "사람", "하루",
  "정도", "이야기", "그리고", "하지만", "그래서", "다녀온", "가볼만한곳", "핫플",
  "장소", "공간", "근처", "분위기"
]);

async function loadDotEnv() {
  const envPath = path.join(process.cwd(), ".env");
  try {
    const body = await readFile(envPath, "utf8");
    for (const line of body.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env is optional. PowerShell environment variables still work.
  }
}

function requireEnv() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Missing NAVER_CLIENT_ID or NAVER_CLIENT_SECRET. Put them in .env or set PowerShell $env variables.");
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

function parseNaverDate(yyyymmdd) {
  return new Date(Date.UTC(Number(yyyymmdd.slice(0, 4)), Number(yyyymmdd.slice(4, 6)) - 1, Number(yyyymmdd.slice(6, 8))));
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows, columns) {
  const body = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))
  ].join("\n");
  return `\uFEFF${body}`;
}

function normalize(text) {
  return text
    .replace(/[()[\]{}"'“”‘’!?.,:;|/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  const matches = normalize(text).match(/[가-힣A-Za-z0-9][가-힣A-Za-z0-9&+._ -]{1,28}/g) || [];
  return matches
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .filter((term) => !STOPWORDS.has(term))
    .filter((term) => !/^\d+$/.test(term));
}

function addCount(map, term, item) {
  if (!term || term.length < 2 || STOPWORDS.has(term)) return;
  const current = map.get(term) || {
    term,
    count: 0,
    seedQueries: new Set(),
    sampleTitles: new Set(),
    sampleLinks: new Set()
  };
  current.count += 1;
  current.seedQueries.add(item.seed_query);
  if (current.sampleTitles.size < 3) current.sampleTitles.add(item.title);
  if (current.sampleLinks.size < 3) current.sampleLinks.add(item.link);
  map.set(term, current);
}

function extractPlaces(item) {
  const text = `${item.title} ${item.description}`;
  const tokens = tokenize(text);
  const terms = new Set();

  for (const area of AREA_TERMS) {
    if (text.includes(area)) terms.add(area);
  }

  for (const token of tokens) {
    const compact = token.replace(/\s+/g, "");
    if (VENUE_SUFFIXES.some((suffix) => compact.endsWith(suffix))) terms.add(compact);
  }

  for (let i = 0; i < tokens.length - 1; i += 1) {
    const bigram = `${tokens[i]} ${tokens[i + 1]}`;
    const compact = bigram.replace(/\s+/g, "");
    if (VENUE_SUFFIXES.some((suffix) => compact.endsWith(suffix))) terms.add(bigram);
  }

  return [...terms].map(normalize).filter(Boolean);
}

function extractTopicKeywords(item) {
  return tokenize(`${item.title} ${item.description}`)
    .map((term) => term.replace(/\s+/g, " ").trim())
    .filter((term) => term.length >= 2 && term.length <= 20);
}

function rankRows(map, limit) {
  return [...map.values()]
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term, "ko"))
    .slice(0, limit)
    .map((entry, index) => ({
      rank: index + 1,
      term: entry.term,
      count: entry.count,
      seed_queries: [...entry.seedQueries].sort().join("|"),
      sample_titles: [...entry.sampleTitles].join(" | "),
      sample_links: [...entry.sampleLinks].join(" | ")
    }));
}

async function fetchSeed(seedQuery, sinceDate) {
  const rows = [];
  for (let start = 1; start <= MAX_PER_SEED; start += 100) {
    const url = new URL("https://openapi.naver.com/v1/search/blog.json");
    url.searchParams.set("query", seedQuery);
    url.searchParams.set("display", "100");
    url.searchParams.set("start", String(start));
    url.searchParams.set("sort", "date");

    const response = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": CLIENT_ID,
        "X-Naver-Client-Secret": CLIENT_SECRET
      }
    });
    if (!response.ok) throw new Error(`Naver API failed for "${seedQuery}" (${response.status}): ${await response.text()}`);

    const items = (await response.json()).items || [];
    if (items.length === 0) break;

    let sawOlderPost = false;
    for (const item of items) {
      const postDate = parseNaverDate(item.postdate);
      if (postDate < sinceDate) {
        sawOlderPost = true;
        continue;
      }
      rows.push({
        seed_query: seedQuery,
        title: stripHtml(item.title),
        description: stripHtml(item.description),
        postdate: dateKey(postDate),
        link: item.link,
        bloggername: stripHtml(item.bloggername),
        bloggerlink: item.bloggerlink
      });
    }

    if (sawOlderPost || rows.length >= MAX_PER_SEED) break;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return rows;
}

async function main() {
  requireEnv();
  await mkdir(OUTPUT_DIR, { recursive: true });

  const now = new Date();
  const sinceDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - DAYS + 1));
  const rawRows = [];

  for (const seed of SEEDS) {
    console.log(`Fetching latest sample for "${seed}"...`);
    rawRows.push(...await fetchSeed(seed, sinceDate));
  }

  const uniqueRows = [...new Map(rawRows.map((row) => [row.link, row])).values()];
  const topicCounts = new Map();
  const placeCounts = new Map();
  const postsWithPlaces = [];

  for (const item of uniqueRows) {
    for (const topic of extractTopicKeywords(item)) addCount(topicCounts, topic, item);
    const places = extractPlaces(item);
    for (const place of places) addCount(placeCounts, place, item);
    if (places.length > 0) postsWithPlaces.push({ ...item, places: places.join("|") });
  }

  const rawColumns = ["seed_query", "title", "description", "postdate", "link", "bloggername", "bloggerlink"];
  const postPlaceColumns = [...rawColumns, "places"];
  const rankColumns = ["rank", "term", "count", "seed_queries", "sample_titles", "sample_links"];
  const summaryRows = [
    { metric: "collected_at", value: now.toISOString() },
    { metric: "days", value: DAYS },
    { metric: "since_date", value: dateKey(sinceDate) },
    { metric: "seed_query_count", value: SEEDS.length },
    { metric: "seed_queries", value: SEEDS.join("|") },
    { metric: "raw_rows_seed_level", value: rawRows.length },
    { metric: "unique_blog_links", value: uniqueRows.length },
    { metric: "posts_with_places", value: postsWithPlaces.length }
  ];

  await writeFile(path.join(OUTPUT_DIR, "naver_latest_raw.csv"), toCsv(uniqueRows, rawColumns), "utf8");
  await writeFile(path.join(OUTPUT_DIR, "naver_latest_topic_keywords_top200.csv"), toCsv(rankRows(topicCounts, 200), rankColumns), "utf8");
  await writeFile(path.join(OUTPUT_DIR, "naver_latest_places_top100.csv"), toCsv(rankRows(placeCounts, 100), rankColumns), "utf8");
  await writeFile(path.join(OUTPUT_DIR, "naver_latest_posts_with_places.csv"), toCsv(postsWithPlaces, postPlaceColumns), "utf8");
  await writeFile(path.join(OUTPUT_DIR, "naver_latest_summary.csv"), toCsv(summaryRows, ["metric", "value"]), "utf8");

  console.log(`Done. Raw rows: ${rawRows.length}, unique links: ${uniqueRows.length}, posts with places: ${postsWithPlaces.length}`);
  console.log(`Outputs written to ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
