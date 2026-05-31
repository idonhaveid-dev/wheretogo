# Naver Blog Place Analysis MVP

This project intentionally contains no app UI. It only collects recent Naver Blog Search API data and produces CSV rankings for place validation.

## Run

PowerShell:

```powershell
$env:NAVER_CLIENT_ID="your-client-id"
$env:NAVER_CLIENT_SECRET="your-client-secret"
npm run analyze:naver
```

Category-based MVP pipeline:

```powershell
npm run analyze:categories
```

This collects the two MVP categories through seed queries:

- `food`: 맛집, 맛집추천, 내돈내산맛집, 핫플맛집, 점심맛집, 저녁맛집, 서울맛집
- `domestic_travel`: 국내여행, 주말여행, 당일치기, 서울근교여행, 가볼만한곳, 여행코스, 국내여행추천

Seeds are used only for collection. Each post is classified again from title and description before region ranking.

Optional controls:

```powershell
$env:DAYS="7"
$env:MAX_PER_KEYWORD="1000"
```

## Output files

- `naver_blog_raw.csv`: blog title, description, post date, search keyword, link
- `naver_blog_place_top100.csv`: place ranking
- `naver_blog_cafe_top50.csv`: cafe ranking
- `naver_blog_restaurant_top50.csv`: restaurant ranking
- `naver_blog_exhibition_popup_top50.csv`: exhibition / popup ranking
- `naver_blog_summary.csv`: collection metadata

Category pipeline output files:

- `naver_category_posts.csv`: deduped posts with inferred categories and extracted regions
- `naver_category_post_sources.csv`: seed query provenance per post
- `naver_category_post_categories.csv`: inferred category, confidence, matched keywords
- `naver_category_post_regions.csv`: extracted region mentions per post
- `naver_category_region_top.csv`: category-level region ranking
- `naver_category_region_daily_counts.csv`: daily region counts
- `naver_category_region_drilldown_top.csv`: candidate venues / places for top regions
- `naver_category_today_rising_regions.csv`: rising region candidates
- `naver_category_today_rising_places.csv`: rising venue / place candidates
- `naver_category_analysis_report.md`: human-readable summary

## Notes

- Search sort is fixed to `sort=date`.
- The collection window defaults to the most recent 7 days.
- Extraction is intentionally lightweight for MVP validation. It uses Korean phrase tokenization, known Seoul / 수도권 area terms, and venue suffixes such as 카페, 식당, 다이닝, 팝업, 전시, 갤러리, 미술관.
- For production-grade noun extraction, replace the lightweight extractor with a Korean morphological analyzer or an NLP service, then keep the CSV contract unchanged.
