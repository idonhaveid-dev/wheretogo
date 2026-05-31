import { mkdir, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

await loadDotEnv();

const CLIENT_ID = process.env.NAVER_CLIENT_ID || process.env.NAVER_SEARCH_CLIENT_ID;
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || process.env.NAVER_SEARCH_CLIENT_SECRET;
const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs");
const DAYS = Number(process.env.DAYS || 7);
const MAX_PER_SEED = Number(process.env.MAX_PER_SEED || 1000);
const TOP_REGION_COUNT = Number(process.env.TOP_REGION_COUNT || 20);
const DRILLDOWN_REGION_COUNT = Number(process.env.DRILLDOWN_REGION_COUNT || 10);

const CATEGORY_SEEDS = {
  food: ["맛집", "맛집추천", "내돈내산맛집", "핫플맛집", "점심맛집", "저녁맛집", "서울맛집"],
  domestic_travel: ["국내여행", "주말여행", "당일치기", "서울근교여행", "가볼만한곳", "여행코스", "국내여행추천"]
};

const CATEGORY_RULES = {
  food: {
    strong: ["맛집", "식당", "메뉴", "점심", "저녁", "고기", "라멘", "파스타", "카페", "디저트", "브런치", "내돈내산", "웨이팅", "밥집", "술집", "다이닝"],
    weak: ["방문", "추천", "후기", "핫플", "데이트"]
  },
  domestic_travel: {
    strong: ["국내여행", "당일치기", "주말여행", "서울근교", "가볼만한곳", "여행코스", "숙소", "바다", "해변", "시장", "축제", "나들이", "명소", "박람회"],
    weak: ["방문", "추천", "후기", "데이트", "핫플"]
  }
};

const NON_VISIT_REGEX = /아파트|매물|전세|월세|경매|분양|변호사|소송|선거|투표|장례|화환|폐유|병원|콘센트|배관|수리|교체|보험|대출|주식|반도체|채용|입시|학원|강의|마케팅|창업/;

const REGIONS = [
  "성수", "성수동", "서울숲", "연남동", "연남", "한남동", "한남", "을지로", "잠실", "송리단길",
  "홍대", "합정", "망원", "상수", "문래", "익선동", "안국", "북촌", "서촌", "종로", "명동",
  "강남", "신사", "가로수길", "압구정", "도산공원", "청담", "삼성", "코엑스", "선릉", "역삼",
  "여의도", "더현대", "더현대서울", "뚝섬", "건대", "왕십리", "이태원", "해방촌", "용산",
  "남산", "인사동", "광화문", "시청", "동대문", "DDP", "신촌", "마포", "공덕", "혜화",
  "대학로", "노량진", "사당", "방배", "서초", "교대", "양재", "송파", "석촌", "석촌호수",
  "올림픽공원", "강동", "천호", "마곡", "상암", "김포", "인천", "송도", "판교", "분당",
  "정자", "광교", "수원", "일산", "고양", "파주", "하남", "미사", "남양주", "구리",
  "의정부", "부천", "안양", "과천", "광명", "강릉", "속초", "양양", "춘천", "가평",
  "양평", "여수", "전주", "부산", "제주", "경주", "포항", "대구", "대전", "광주"
];

const REGION_ALIASES = new Map([
  ["성수동", "성수"],
  ["연남", "연남동"],
  ["한남", "한남동"],
  ["더현대", "더현대서울"],
  ["더현대 서울", "더현대서울"],
  ["서울 숲", "서울숲"],
  ["석촌 호수", "석촌호수"],
  ["디디피", "DDP"]
]);

const VENUE_SUFFIXES = [
  "카페", "커피", "로스터스", "베이커리", "식당", "다이닝", "레스토랑", "오마카세",
  "브런치", "바", "펍", "라운지", "맛집", "팝업", "스토어", "쇼룸", "전시",
  "전시회", "갤러리", "미술관", "박물관", "공원", "해변", "시장", "축제", "숙소",
  "호텔", "리조트", "펜션", "공방", "스튜디오", "플래그십"
];

const CANDIDATE_STOPWORDS = new Set([
  "맛집", "카페", "국내여행", "여행", "여행코스", "가볼만한곳", "핫플", "추천", "후기",
  "방문", "오늘", "주말", "서울", "수도권", "내돈내산", "웨이팅", "메뉴", "가격",
  "주차", "예약", "정보", "정리", "총정리", "솔직후기"
]);

const GENERIC_CANDIDATE_REGEX = /^(서울맛집|맛집추천|핫플맛집|내돈내산맛집|감성카페|디저트카페|대형카페|오션뷰카페|숙소|감성숙소|한옥숙소|독채펜션|호텔|펜션|리조트|축제|꽃축제|장미축제|수국축제|6월축제|국내축제|여름축제|주말여행|당일치기|서울근교|근교|가볼만한|가볼만한 곳|여행 맛집|현지인맛집|데이트맛집|직장인맛집|가성비맛집|한식맛집|디저트 맛집|카페추천|카페투어|팝업|키즈펜션|가족펜션|단체펜션|애견펜션|계곡펜션|커플여행숙소|오션뷰숙소|럭셔리호텔|글램핑|빠지|한식|분위기|분위기좋은식당|분위기좋은레스토랑|소고기|디저트|빵지순례|추천하는|탐방|2박|1박2일|3대|5월|6월)$/;
const GENERIC_SUFFIX_REGEX = /^(.*동\s?맛집|.*역\s?맛집|.*구\s?맛집|.*시\s?맛집|.*도\s?맛집|.*길\s?맛집|.*리\s?맛집|.*가\s?맛집|.*맛집|.*카페|.*펜션|.*숙소)$/;
const ADDRESS_OR_PHONE_REGEX = /\d{3,}|0507|010|오전|오후|영업|주차|도보|출구/;
const TITLE_NOISE_REGEX = /추천|후기|정리|총정리|모음|가격|메뉴|주차|예약|정보|웨이팅|코스|탐방|선택|기준|실패|성공|전략|할인|꿀팁/;

async function loadDotEnv() {
  try {
    const body = await readFile(path.join(process.cwd(), ".env"), "utf8");
    for (const line of body.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      if (!process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env is optional.
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

function postId(link) {
  return crypto.createHash("sha1").update(link).digest("hex").slice(0, 16);
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
    .replace(/[()[\]{}"'“”‘’!?.,:;|/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mergeList(left = "", right = "", limit = Infinity) {
  return [...new Set(`${left}|${right}`.split("|").map((item) => item.trim()).filter(Boolean))]
    .slice(0, limit)
    .join("|");
}

function inferCategories(row) {
  const text = `${row.title} ${row.description}`;
  if (NON_VISIT_REGEX.test(text)) return [];
  const inferred = [];

  for (const [category, rules] of Object.entries(CATEGORY_RULES)) {
    const matchedStrong = rules.strong.filter((keyword) => text.includes(keyword));
    const matchedWeak = rules.weak.filter((keyword) => text.includes(keyword));
    const score = matchedStrong.length * 2 + matchedWeak.length;
    if (score >= 2) {
      inferred.push({
        post_id: row.post_id,
        inferred_category: category,
        confidence: Math.min(1, score / 8).toFixed(2),
        matched_keywords: [...matchedStrong, ...matchedWeak].join("|")
      });
    }
  }

  return inferred;
}

function normalizeRegion(region) {
  return REGION_ALIASES.get(region) || region;
}

function extractRegions(row) {
  const text = `${row.title} ${row.description}`;
  const found = new Set();
  for (const region of REGIONS) {
    if (text.includes(region)) found.add(normalizeRegion(region));
  }
  return [...found].filter((region) => region !== "서울" && region !== "수도권");
}

function classifyCandidate(term, category) {
  const text = `${term} ${category}`;
  if (/팝업|스토어|쇼룸|플래그십/.test(text)) return "popup";
  if (/전시|갤러리|미술관|박물관|축제|박람회/.test(text)) return "attraction";
  if (/카페|커피|로스터스|베이커리|디저트|브런치/.test(text)) return "cafe";
  if (/맛집|식당|다이닝|레스토랑|오마카세|라멘|파스타|고기|술집|바|펍/.test(text)) return "restaurant";
  if (/해변|공원|시장|숙소|호텔|리조트|펜션/.test(text)) return "travel_spot";
  return "candidate";
}

function cleanCandidate(term, region) {
  let cleaned = normalizeText(term)
    .replace(new RegExp(`^${region}\\s*`), "")
    .replace(/^(맛집|카페|숙소|펜션|호텔)\s+/, "")
    .replace(/\s*(추천|후기|정보|총정리|방문기|솔직|내돈내산)$/g, "")
    .trim();

  if (!cleaned || cleaned.length < 2 || cleaned.length > 28) return null;
  if (CANDIDATE_STOPWORDS.has(cleaned)) return null;
  if (GENERIC_CANDIDATE_REGEX.test(cleaned)) return null;
  if (GENERIC_SUFFIX_REGEX.test(cleaned) && !/[A-Za-z0-9]/.test(cleaned)) return null;
  if (ADDRESS_OR_PHONE_REGEX.test(cleaned)) return null;
  if (TITLE_NOISE_REGEX.test(cleaned) && cleaned.length > 10) return null;
  if (/^\d+$/.test(cleaned)) return null;
  if (REGIONS.includes(cleaned)) return null;
  return cleaned;
}

function isCleanDrilldownCandidate(row) {
  const name = String(row.candidate_name || "").trim();
  if (!name || name.length < 2 || name.length > 24) return false;
  if (CANDIDATE_STOPWORDS.has(name)) return false;
  if (GENERIC_CANDIDATE_REGEX.test(name)) return false;
  if (GENERIC_SUFFIX_REGEX.test(name) && !/[A-Za-z0-9]/.test(name)) return false;
  if (ADDRESS_OR_PHONE_REGEX.test(name)) return false;
  if (/^[가-힣]+(동|역|구|시|도|길|리)$/.test(name)) return false;
  if (/^(동|역|도|시|구)\s?/.test(name)) return false;
  if (String(row.candidate_type || "") === "candidate" && Number(row.post_count || 0) < 2) return false;
  return true;
}

function isVerifiedDrilldownCandidate(row) {
  if (!isCleanDrilldownCandidate(row)) return false;
  if (Number(row.post_count || 0) < 2) return false;
  if (String(row.candidate_type || "") === "candidate") return false;
  if (/^\d+가\s?(맛집|카페)$/.test(row.candidate_name)) return false;
  if (GENERIC_CANDIDATE_REGEX.test(row.candidate_name)) return false;
  if (TITLE_NOISE_REGEX.test(row.candidate_name) && row.candidate_name.length > 8) return false;
  return true;
}

function extractCandidates(row, region, category) {
  const text = normalizeText(`${row.title} ${row.description}`);
  if (!text.includes(region)) return [];
  const candidates = new Set();

  const title = normalizeText(row.title);
  const add = (value) => {
    const cleaned = cleanCandidate(value, region);
    if (cleaned) candidates.add(cleaned);
  };

  const bracketPattern = /\[([^\]]{2,28})\]\s*([가-힣A-Za-z0-9&+._ -]{2,24})?/g;
  for (const match of title.matchAll(bracketPattern)) {
    if (!match[1].includes(region)) continue;
    add(match[1].replace(region, " "));
    if (match[2]) add(match[2]);
  }

  const namedAfterRegionPattern = new RegExp(`${region}\\s+(?:맛집|카페|팝업|전시|숙소|펜션|호텔)?\\s*([가-힣A-Za-z0-9&+._-]{2,18})`, "g");
  for (const match of title.matchAll(namedAfterRegionPattern)) add(match[1]);

  const namedBeforeRegionPattern = new RegExp(`([가-힣A-Za-z0-9&+._-]{2,18})\\s+${region}(?:점|역|동)?`, "g");
  for (const match of title.matchAll(namedBeforeRegionPattern)) add(match[1]);

  const travelSpotPattern = new RegExp(`${region}\\s+([가-힣A-Za-z0-9&+._ -]{2,18}(?:시장|해변|수목원|공원|축제|박람회|미술관|박물관|호텔|펜션|숙소|풀빌라|리조트))`, "g");
  for (const match of title.matchAll(travelSpotPattern)) add(match[1]);

  const suffixPattern = /([가-힣A-Za-z0-9&+._ -]{2,24}(?:카페|커피|로스터스|베이커리|식당|다이닝|레스토랑|맛집|팝업|스토어|쇼룸|전시|전시회|갤러리|미술관|박물관|공원|해변|시장|축제|숙소|호텔|리조트|펜션|공방|스튜디오|플래그십))/g;
  for (const match of text.matchAll(suffixPattern)) add(match[1]);

  const regionNearPattern = new RegExp(`${region}\\s+([가-힣A-Za-z0-9&+._ -]{2,24})`, "g");
  for (const match of text.matchAll(regionNearPattern)) add(match[1]);

  return [...candidates]
    .map((candidate) => ({ candidate, candidate_type: classifyCandidate(candidate, category) }));
}

function increment(map, key, build, merge) {
  const current = map.get(key) || build();
  merge(current);
  map.set(key, current);
}

async function fetchSeed(sourceCategory, seed, sinceDate) {
  const rows = [];
  for (let start = 1; start <= MAX_PER_SEED; start += 100) {
    const url = new URL("https://openapi.naver.com/v1/search/blog.json");
    url.searchParams.set("query", seed);
    url.searchParams.set("display", "100");
    url.searchParams.set("start", String(start));
    url.searchParams.set("sort", "date");

    const response = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": CLIENT_ID,
        "X-Naver-Client-Secret": CLIENT_SECRET
      }
    });
    if (!response.ok) throw new Error(`Naver API failed for "${seed}" (${response.status}): ${await response.text()}`);

    const items = (await response.json()).items || [];
    if (items.length === 0) break;

    let sawOlderPost = false;
    for (const item of items) {
      const postDate = parseNaverDate(item.postdate);
      if (postDate < sinceDate) {
        sawOlderPost = true;
        continue;
      }
      const link = item.link;
      rows.push({
        post_id: postId(link),
        source_category: sourceCategory,
        seed,
        title: stripHtml(item.title),
        description: stripHtml(item.description),
        postdate: dateKey(postDate),
        link,
        bloggername: stripHtml(item.bloggername),
        bloggerlink: item.bloggerlink
      });
    }

    if (sawOlderPost || rows.length >= MAX_PER_SEED) break;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return rows;
}

function buildAnalysis(rawRows) {
  const postsByLink = new Map();
  const postSources = [];

  for (const row of rawRows) {
    postSources.push({
      post_id: row.post_id,
      source_category: row.source_category,
      seed: row.seed,
      link: row.link
    });

    const existing = postsByLink.get(row.link);
    if (!existing) {
      postsByLink.set(row.link, {
        post_id: row.post_id,
        title: row.title,
        description: row.description,
        postdate: row.postdate,
        link: row.link,
        bloggername: row.bloggername,
        bloggerlink: row.bloggerlink,
        source_categories: row.source_category,
        seeds: row.seed
      });
    } else {
      existing.source_categories = mergeList(existing.source_categories, row.source_category);
      existing.seeds = mergeList(existing.seeds, row.seed);
    }
  }

  const posts = [...postsByLink.values()];
  const postsById = new Map(posts.map((post) => [post.post_id, post]));
  const postCategories = posts.flatMap(inferCategories);
  const categoryByPost = new Map();
  for (const row of postCategories) {
    categoryByPost.set(row.post_id, mergeList(categoryByPost.get(row.post_id), row.inferred_category));
  }

  const postRegions = [];
  for (const post of posts) {
    for (const region of extractRegions(post)) {
      postRegions.push({
        post_id: post.post_id,
        postdate: post.postdate,
        region,
        source_text: post.title,
        link: post.link
      });
    }
  }
  const regionsByPost = new Map();
  for (const regionRow of postRegions) {
    const current = regionsByPost.get(regionRow.post_id) || [];
    current.push(regionRow);
    regionsByPost.set(regionRow.post_id, current);
  }

  const regionCounts = new Map();
  const dailyCounts = new Map();
  const candidateCounts = new Map();
  const candidateDailyCounts = new Map();

  for (const categoryRow of postCategories) {
    const post = postsById.get(categoryRow.post_id);
    if (!post) continue;
    const regions = regionsByPost.get(post.post_id) || [];

    for (const regionRow of regions) {
      const regionKey = `${categoryRow.inferred_category}::${regionRow.region}`;
      increment(
        regionCounts,
        regionKey,
        () => ({
          category: categoryRow.inferred_category,
          region: regionRow.region,
          post_count: 0,
          seed_count: 0,
          seeds: "",
          sample_titles: "",
          sample_links: ""
        }),
        (current) => {
          current.post_count += 1;
          current.seeds = mergeList(current.seeds, post.seeds);
          current.seed_count = current.seeds ? current.seeds.split("|").length : 0;
          current.sample_titles = mergeList(current.sample_titles, post.title, 5);
          current.sample_links = mergeList(current.sample_links, post.link, 5);
        }
      );

      const dailyKey = `${post.postdate}::${categoryRow.inferred_category}::${regionRow.region}`;
      increment(
        dailyCounts,
        dailyKey,
        () => ({ date: post.postdate, category: categoryRow.inferred_category, region: regionRow.region, post_count: 0 }),
        (current) => {
          current.post_count += 1;
        }
      );
    }
  }

  const regionTop = [...regionCounts.values()]
    .map((row) => ({ ...row, score: Number((row.post_count * Math.log1p(row.seed_count)).toFixed(2)) }))
    .sort((a, b) => b.score - a.score || b.post_count - a.post_count)
    .map((row, index) => ({ rank: index + 1, ...row }));

  const drilldownTargets = new Set();
  for (const category of Object.keys(CATEGORY_SEEDS)) {
    regionTop
      .filter((row) => row.category === category)
      .slice(0, DRILLDOWN_REGION_COUNT)
      .forEach((row) => drilldownTargets.add(`${row.category}::${row.region}`));
  }

  for (const categoryRow of postCategories) {
    const post = postsById.get(categoryRow.post_id);
    if (!post) continue;
    const regions = regionsByPost.get(post.post_id) || [];

    for (const regionRow of regions) {
      if (!drilldownTargets.has(`${categoryRow.inferred_category}::${regionRow.region}`)) continue;
      for (const candidateRow of extractCandidates(post, regionRow.region, categoryRow.inferred_category)) {
        const key = `${categoryRow.inferred_category}::${regionRow.region}::${candidateRow.candidate}`;
        increment(
          candidateCounts,
          key,
          () => ({
            category: categoryRow.inferred_category,
            region: regionRow.region,
            candidate_name: candidateRow.candidate,
            candidate_type: candidateRow.candidate_type,
            post_count: 0,
            sample_titles: "",
            sample_links: ""
          }),
          (current) => {
            current.post_count += 1;
            current.sample_titles = mergeList(current.sample_titles, post.title, 5);
            current.sample_links = mergeList(current.sample_links, post.link, 5);
          }
        );

        const dailyCandidateKey = `${post.postdate}::${categoryRow.inferred_category}::${regionRow.region}::${candidateRow.candidate}`;
        increment(
          candidateDailyCounts,
          dailyCandidateKey,
          () => ({
            date: post.postdate,
            category: categoryRow.inferred_category,
            region: regionRow.region,
            candidate_name: candidateRow.candidate,
            candidate_type: candidateRow.candidate_type,
            post_count: 0
          }),
          (current) => {
            current.post_count += 1;
          }
        );
      }
    }
  }

  const drilldownRows = [...candidateCounts.values()]
    .sort((a, b) => b.post_count - a.post_count || a.candidate_name.localeCompare(b.candidate_name, "ko"))
    .map((row, index) => ({ rank: index + 1, ...row }));
  const cleanedDrilldownRows = drilldownRows
    .filter(isCleanDrilldownCandidate)
    .map((row, index) => ({ ...row, rank: index + 1 }));
  const verifiedDrilldownRows = drilldownRows
    .filter(isVerifiedDrilldownCandidate)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  const dailyRows = [...dailyCounts.values()].sort((a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category) || a.region.localeCompare(b.region, "ko"));
  const latestDate = dailyRows.map((row) => row.date).sort().at(-1);
  const risingRegions = buildRisingRows(dailyRows, latestDate, ["category", "region"]);
  const risingPlaces = buildRisingPlaces([...candidateDailyCounts.values()], latestDate);

  const enrichedPosts = posts.map((post) => ({
    ...post,
    inferred_categories: categoryByPost.get(post.post_id) || "",
    regions: postRegions.filter((row) => row.post_id === post.post_id).map((row) => row.region).join("|")
  }));

  return {
    posts: enrichedPosts,
    postSources,
    postCategories,
    postRegions,
    regionTop,
    dailyRows,
    drilldownRows,
    cleanedDrilldownRows,
    verifiedDrilldownRows,
    risingRegions,
    risingPlaces,
    latestDate
  };
}

function buildRisingRows(rows, latestDate, keyColumns) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyColumns.map((column) => row[column]).join("::");
    const current = groups.get(key) || [];
    current.push(row);
    groups.set(key, current);
  }

  return [...groups.entries()]
    .map(([, group]) => {
      const latest = group.find((row) => row.date === latestDate)?.post_count || 0;
      const previous = group.filter((row) => row.date !== latestDate);
      const previousAverage = previous.length > 0 ? previous.reduce((sum, row) => sum + row.post_count, 0) / previous.length : 0;
      const lift = latest / (previousAverage + 0.5);
      return {
        date: latestDate,
        category: group[0].category,
        region: group[0].region,
        today_count: latest,
        previous_average: previousAverage.toFixed(2),
        lift: lift.toFixed(2)
      };
    })
    .filter((row) => row.today_count >= 2)
    .sort((a, b) => Number(b.lift) - Number(a.lift) || b.today_count - a.today_count)
    .map((row, index) => ({ rank: index + 1, ...row }));
}

function buildRisingPlaces(candidateDailyRows, latestDate) {
  const groups = new Map();
  for (const row of candidateDailyRows) {
    const key = `${row.category}::${row.region}::${row.candidate_name}`;
    const current = groups.get(key) || [];
    current.push(row);
    groups.set(key, current);
  }

  return [...groups.values()]
    .map((group) => {
      const latest = group.find((row) => row.date === latestDate)?.post_count || 0;
      const previous = group.filter((row) => row.date !== latestDate);
      const previousAverage = previous.length > 0 ? previous.reduce((sum, row) => sum + row.post_count, 0) / previous.length : 0;
      return {
        date: latestDate,
        category: group[0].category,
        region: group[0].region,
        candidate_name: group[0].candidate_name,
        candidate_type: group[0].candidate_type,
        today_count: latest,
        previous_average: previousAverage.toFixed(2),
        lift: (latest / (previousAverage + 0.5)).toFixed(2)
      };
    })
    .filter((row) => row.today_count >= 2)
    .sort((a, b) => Number(b.lift) - Number(a.lift) || b.today_count - a.today_count)
    .map((row, index) => ({ rank: index + 1, ...row }));
}

function buildReport(analysis, rawRows) {
  const foodRegions = analysis.regionTop.filter((row) => row.category === "food").slice(0, TOP_REGION_COUNT);
  const travelRegions = analysis.regionTop.filter((row) => row.category === "domestic_travel").slice(0, TOP_REGION_COUNT);
  return [
    "# Category Seed Analysis Report",
    "",
    `- Collection window: recent ${DAYS} days`,
    `- Raw seed rows: ${rawRows.length}`,
    `- Unique posts: ${analysis.posts.length}`,
    `- Inferred category rows: ${analysis.postCategories.length}`,
    `- Region mentions: ${analysis.postRegions.length}`,
    `- Latest date for rising calculation: ${analysis.latestDate || ""}`,
    "",
    "## Food Region Top",
    "",
    table(foodRegions, ["rank", "region", "post_count", "seed_count", "score"]),
    "",
    "## Domestic Travel Region Top",
    "",
    table(travelRegions, ["rank", "region", "post_count", "seed_count", "score"]),
    "",
    "## Readout",
    "",
    "- Seeds are used only for collection. The final category is inferred again from title and description.",
    "- Region rankings use post_count and seed diversity, so a region found across many seeds scores higher.",
    "- Drilldown candidates are extracted only for top regions per category.",
    "- Next improvement: review drilldown candidates and promote confirmed names into an alias table."
  ].join("\n");
}

function table(rows, columns) {
  if (rows.length === 0) return "_No rows._";
  return [
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map((column) => String(row[column] ?? "").replace(/\|/g, "/")).join(" | ")} |`)
  ].join("\n");
}

async function main() {
  requireEnv();
  await mkdir(OUTPUT_DIR, { recursive: true });

  const now = new Date();
  const sinceDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - DAYS + 1));
  const rawRows = [];

  for (const [sourceCategory, seeds] of Object.entries(CATEGORY_SEEDS)) {
    for (const seed of seeds) {
      console.log(`Fetching ${sourceCategory} seed "${seed}"...`);
      rawRows.push(...await fetchSeed(sourceCategory, seed, sinceDate));
    }
  }

  const analysis = buildAnalysis(rawRows);
  const prefix = "naver_category";

  await writeFile(path.join(OUTPUT_DIR, `${prefix}_posts.csv`), toCsv(analysis.posts, ["post_id", "title", "description", "postdate", "link", "bloggername", "bloggerlink", "source_categories", "seeds", "inferred_categories", "regions"]), "utf8");
  await writeFile(path.join(OUTPUT_DIR, `${prefix}_post_sources.csv`), toCsv(analysis.postSources, ["post_id", "source_category", "seed", "link"]), "utf8");
  await writeFile(path.join(OUTPUT_DIR, `${prefix}_post_categories.csv`), toCsv(analysis.postCategories, ["post_id", "inferred_category", "confidence", "matched_keywords"]), "utf8");
  await writeFile(path.join(OUTPUT_DIR, `${prefix}_post_regions.csv`), toCsv(analysis.postRegions, ["post_id", "postdate", "region", "source_text", "link"]), "utf8");
  await writeFile(path.join(OUTPUT_DIR, `${prefix}_region_top.csv`), toCsv(analysis.regionTop, ["rank", "category", "region", "post_count", "seed_count", "score", "seeds", "sample_titles", "sample_links"]), "utf8");
  await writeFile(path.join(OUTPUT_DIR, `${prefix}_region_daily_counts.csv`), toCsv(analysis.dailyRows, ["date", "category", "region", "post_count"]), "utf8");
  await writeFile(path.join(OUTPUT_DIR, `${prefix}_region_drilldown_top.csv`), toCsv(analysis.drilldownRows, ["rank", "category", "region", "candidate_name", "candidate_type", "post_count", "sample_titles", "sample_links"]), "utf8");
  await writeFile(path.join(OUTPUT_DIR, `${prefix}_region_drilldown_cleaned_top.csv`), toCsv(analysis.cleanedDrilldownRows, ["rank", "category", "region", "candidate_name", "candidate_type", "post_count", "sample_titles", "sample_links"]), "utf8");
  await writeFile(path.join(OUTPUT_DIR, `${prefix}_region_drilldown_verified_top.csv`), toCsv(analysis.verifiedDrilldownRows, ["rank", "category", "region", "candidate_name", "candidate_type", "post_count", "sample_titles", "sample_links"]), "utf8");
  await writeFile(path.join(OUTPUT_DIR, `${prefix}_today_rising_regions.csv`), toCsv(analysis.risingRegions, ["rank", "date", "category", "region", "today_count", "previous_average", "lift"]), "utf8");
  await writeFile(path.join(OUTPUT_DIR, `${prefix}_today_rising_places.csv`), toCsv(analysis.risingPlaces, ["rank", "date", "category", "region", "candidate_name", "candidate_type", "today_count", "previous_average", "lift"]), "utf8");
  await writeFile(path.join(OUTPUT_DIR, `${prefix}_analysis_report.md`), `\uFEFF${buildReport(analysis, rawRows)}`, "utf8");

  console.log(`Done. Raw rows: ${rawRows.length}, unique posts: ${analysis.posts.length}`);
  console.log(`Outputs written to ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
