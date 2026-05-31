import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const CLIENT_ID = process.env.NAVER_CLIENT_ID || process.env.NAVER_SEARCH_CLIENT_ID;
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || process.env.NAVER_SEARCH_CLIENT_SECRET;

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs");
const DAYS = Number(process.env.DAYS || 7);
const MAX_PER_KEYWORD = Number(process.env.MAX_PER_KEYWORD || 1000);

const KEYWORDS = [
  "서울 카페",
  "성수 카페",
  "연남동 카페",
  "한남동 카페",
  "을지로 카페",
  "잠실 카페",
  "서울 맛집",
  "성수 맛집",
  "연남동 맛집",
  "한남동 맛집",
  "을지로 맛집",
  "잠실 맛집",
  "서울 데이트",
  "서울 데이트 코스",
  "성수 데이트",
  "연남동 데이트",
  "한남동 데이트",
  "서울 전시",
  "서울 팝업스토어",
  "성수 팝업",
  "더현대 팝업",
  "무료 전시"
];

const AREA_TERMS = new Set([
  "서울", "성수", "성수동", "연남동", "연남", "한남동", "한남", "을지로", "잠실",
  "홍대", "합정", "망원", "망원동", "상수", "문래", "문래동", "익선동", "안국",
  "북촌", "서촌", "종로", "명동", "강남", "신사", "가로수길", "압구정", "도산공원",
  "청담", "삼성", "코엑스", "선릉", "역삼", "여의도", "더현대", "더현대서울",
  "서울숲", "뚝섬", "건대", "건대입구", "왕십리", "이태원", "해방촌", "녹사평",
  "용산", "남산", "인사동", "광화문", "시청", "동대문", "DDP", "신촌", "이대",
  "마포", "공덕", "성북", "혜화", "대학로", "낙산", "노량진", "사당", "방배",
  "서초", "교대", "양재", "송파", "석촌", "석촌호수", "올림픽공원", "강동",
  "천호", "마곡", "상암", "DMC", "김포", "인천", "송도", "판교", "분당",
  "정자", "광교", "수원", "일산", "고양", "파주", "하남", "미사", "남양주",
  "구리", "의정부", "부천", "안양", "과천", "광명"
]);

const PLACE_SUFFIXES = [
  "카페", "커피", "로스터스", "베이커리", "식당", "다이닝", "레스토랑", "바",
  "펍", "라운지", "오마카세", "브런치", "팝업", "팝업스토어", "전시", "갤러리",
  "미술관", "박물관", "공원", "숲", "시장", "몰", "백화점", "호텔", "스퀘어",
  "플라자", "하우스", "스튜디오", "쇼룸", "라멘", "스시", "버거", "와인"
];

const STOPWORDS = new Set([
  "서울", "수도권", "오늘", "이번", "지난", "최근", "후기", "추천", "방문", "리뷰",
  "정보", "위치", "운영", "시간", "예약", "메뉴", "가격", "주차", "사진", "영상",
  "블로그", "네이버", "데이트", "코스", "무료", "최신", "모음", "정리", "일상",
  "내돈내산", "맛집", "카페", "전시", "팝업", "팝업스토어", "핫플", "핫플레이스",
  "가볼만한곳", "곳", "장소", "근처", "분위기", "공간", "오픈", "행사", "이벤트"
]);

function requireEnv() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error([
      "Missing Naver Search API credentials.",
      "Set NAVER_CLIENT_ID and NAVER_CLIENT_SECRET, then run:",
      "  npm run analyze:naver",
      "",
      "PowerShell example:",
      "  $env:NAVER_CLIENT_ID='your-client-id'",
      "  $env:NAVER_CLIENT_SECRET='your-client-secret'",
      "  npm run analyze:naver"
    ].join("\n"));
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
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6)) - 1;
  const day = Number(yyyymmdd.slice(6, 8));
  return new Date(Date.UTC(year, month, day));
}

function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows, columns) {
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))
  ].join("\n");
}

function addCount(map, key, item) {
  if (!key || key.length < 2 || STOPWORDS.has(key)) return;
  const current = map.get(key) || {
    term: key,
    count: 0,
    keywords: new Set(),
    sampleTitles: new Set(),
    sampleLinks: new Set()
  };
  current.count += 1;
  current.keywords.add(item.keyword);
  if (current.sampleTitles.size < 3) current.sampleTitles.add(item.title);
  if (current.sampleLinks.size < 3) current.sampleLinks.add(item.link);
  map.set(key, current);
}

function normalizeTerm(term) {
  return term
    .replace(/[()[\]{}"'“”‘’!?.,:;|/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  const normalized = normalizeTerm(text);
  const matches = normalized.match(/[가-힣A-Za-z0-9][가-힣A-Za-z0-9&+._ -]{1,28}/g) || [];
  return matches
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .filter((term) => !/^\d+$/.test(term));
}

function extractTerms(item) {
  const text = `${item.title} ${item.description}`;
  const tokens = tokenize(text);
  const terms = new Set();

  for (const token of tokens) {
    const compact = token.replace(/\s+/g, "");
    if (AREA_TERMS.has(token) || AREA_TERMS.has(compact)) terms.add(compact);
    if (PLACE_SUFFIXES.some((suffix) => compact.endsWith(suffix))) terms.add(compact);
  }

  for (let i = 0; i < tokens.length - 1; i += 1) {
    const bigram = `${tokens[i]} ${tokens[i + 1]}`;
    const compact = bigram.replace(/\s+/g, "");
    if (PLACE_SUFFIXES.some((suffix) => compact.endsWith(suffix))) terms.add(compact);
    if (AREA_TERMS.has(tokens[i]) && PLACE_SUFFIXES.some((suffix) => tokens[i + 1].endsWith(suffix))) {
      terms.add(bigram);
    }
  }

  for (const area of AREA_TERMS) {
    if (text.includes(area)) terms.add(area);
  }

  return [...terms].map(normalizeTerm).filter(Boolean);
}

function classifyTerm(term, keyword) {
  const compact = term.replace(/\s+/g, "");
  const haystack = `${compact} ${keyword}`;
  if (/전시|팝업|갤러리|미술관|박물관|쇼룸/.test(haystack)) return "exhibition_popup";
  if (/맛집|식당|다이닝|레스토랑|오마카세|라멘|스시|버거|브런치|고기|한식|일식|중식|양식/.test(haystack)) return "restaurant";
  if (/카페|커피|로스터스|베이커리|디저트/.test(haystack)) return "cafe";
  return "place";
}

function rankingRows(map, limit) {
  return [...map.values()]
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term, "ko"))
    .slice(0, limit)
    .map((entry, index) => ({
      rank: index + 1,
      term: entry.term,
      count: entry.count,
      keywords: [...entry.keywords].sort().join("|"),
      sample_titles: [...entry.sampleTitles].join(" | "),
      sample_links: [...entry.sampleLinks].join(" | ")
    }));
}

async function fetchKeyword(keyword, sinceDate) {
  const rows = [];
  for (let start = 1; start <= MAX_PER_KEYWORD; start += 100) {
    const url = new URL("https://openapi.naver.com/v1/search/blog.json");
    url.searchParams.set("query", keyword);
    url.searchParams.set("display", "100");
    url.searchParams.set("start", String(start));
    url.searchParams.set("sort", "date");

    const response = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": CLIENT_ID,
        "X-Naver-Client-Secret": CLIENT_SECRET
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Naver API failed for "${keyword}" (${response.status}): ${body}`);
    }

    const payload = await response.json();
    const items = payload.items || [];
    if (items.length === 0) break;

    let sawOlderPost = false;
    for (const item of items) {
      const postDate = parseNaverDate(item.postdate);
      if (postDate < sinceDate) {
        sawOlderPost = true;
        continue;
      }
      rows.push({
        keyword,
        title: stripHtml(item.title),
        description: stripHtml(item.description),
        postdate: toDateKey(postDate),
        link: item.link,
        bloggername: stripHtml(item.bloggername),
        bloggerlink: item.bloggerlink
      });
    }

    if (sawOlderPost || rows.length >= MAX_PER_KEYWORD) break;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return rows;
}

async function main() {
  requireEnv();
  await mkdir(OUTPUT_DIR, { recursive: true });

  const today = new Date();
  const sinceDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - DAYS + 1));
  const collectedAt = new Date().toISOString();

  const rawRows = [];
  for (const keyword of KEYWORDS) {
    console.log(`Fetching "${keyword}"...`);
    rawRows.push(...await fetchKeyword(keyword, sinceDate));
  }

  const deduped = [...new Map(rawRows.map((row) => [`${row.link}::${row.keyword}`, row])).values()];
  const byLink = [...new Map(rawRows.map((row) => [row.link, row])).values()];

  const place = new Map();
  const cafe = new Map();
  const restaurant = new Map();
  const exhibitionPopup = new Map();

  for (const item of deduped) {
    for (const term of extractTerms(item)) {
      addCount(place, term, item);
      const category = classifyTerm(term, item.keyword);
      if (category === "cafe") addCount(cafe, term, item);
      if (category === "restaurant") addCount(restaurant, term, item);
      if (category === "exhibition_popup") addCount(exhibitionPopup, term, item);
    }
  }

  const rawColumns = ["keyword", "title", "description", "postdate", "link", "bloggername", "bloggerlink"];
  const rankColumns = ["rank", "term", "count", "keywords", "sample_titles", "sample_links"];
  const summaryRows = [
    { metric: "collected_at", value: collectedAt },
    { metric: "days", value: DAYS },
    { metric: "since_date", value: toDateKey(sinceDate) },
    { metric: "keyword_count", value: KEYWORDS.length },
    { metric: "raw_rows_keyword_level", value: rawRows.length },
    { metric: "deduped_rows_keyword_level", value: deduped.length },
    { metric: "unique_blog_links", value: byLink.length }
  ];

  await writeFile(path.join(OUTPUT_DIR, "naver_blog_raw.csv"), toCsv(deduped, rawColumns), "utf8");
  await writeFile(path.join(OUTPUT_DIR, "naver_blog_place_top100.csv"), toCsv(rankingRows(place, 100), rankColumns), "utf8");
  await writeFile(path.join(OUTPUT_DIR, "naver_blog_cafe_top50.csv"), toCsv(rankingRows(cafe, 50), rankColumns), "utf8");
  await writeFile(path.join(OUTPUT_DIR, "naver_blog_restaurant_top50.csv"), toCsv(rankingRows(restaurant, 50), rankColumns), "utf8");
  await writeFile(path.join(OUTPUT_DIR, "naver_blog_exhibition_popup_top50.csv"), toCsv(rankingRows(exhibitionPopup, 50), rankColumns), "utf8");
  await writeFile(path.join(OUTPUT_DIR, "naver_blog_summary.csv"), toCsv(summaryRows, ["metric", "value"]), "utf8");

  console.log(`Done. Raw rows: ${rawRows.length}, keyword-level deduped rows: ${deduped.length}, unique links: ${byLink.length}`);
  console.log(`Outputs written to ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
