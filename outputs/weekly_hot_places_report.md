# Weekly Hot Places Report

- Window: 2026-05-25 to 2026-05-31 (7 days)
- Source: daily snapshots accumulated in daily_hot_places_history.csv (+ today from today_hot_places_normalized.csv)
- Output places: 23

## Daily coverage in window

Each day contributes one unbiased daily snapshot. Weekly differentiation grows as more days accumulate.

| date | places |
| --- | --- |
| 2026-05-25 | 0 |
| 2026-05-26 | 0 |
| 2026-05-27 | 0 |
| 2026-05-28 | 0 |
| 2026-05-29 | 0 |
| 2026-05-30 | 0 |
| 2026-05-31 | 23 |

## Scoring

`consistency = 0.5 + 0.5 * (active_days / WINDOW_DAYS)`
`weekly_hot_score = (weekly_total_count * consistency + 0.5 * daily_increase) * (match_score / 100)`

Sustained weekly volume is the primary signal, scaled up for places active across more days. A daily spike (today above the recent baseline) adds a damped bonus so rising places get a nudge without dominating the weekly ranking.

## Top 20

| rank | display_name | region | category | weekly_hot_score | weekly_total_count | active_days | consistency | today_count | previous_6_day_average | daily_increase |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 중앙시장 | 강릉 | domestic_travel | 9.64 | 10 | 1 | 0.571 | 10 | 0.00 | 10.00 |
| 2 | 서문시장 | 대구 | food | 5.79 | 6 | 1 | 0.571 | 6 | 0.00 | 6.00 |
| 3 | 서문시장 | 대구 | domestic_travel | 5.79 | 6 | 1 | 0.571 | 6 | 0.00 | 6.00 |
| 4 | 제트 가성비호텔 대연역점 | 부산 | domestic_travel | 3.86 | 4 | 1 | 0.571 | 4 | 0.00 | 4.00 |
| 5 | 광교호수공원 | 수원 | food | 2.89 | 3 | 1 | 0.571 | 3 | 0.00 | 3.00 |
| 6 | 연화식당 | 광주 | food | 2.89 | 3 | 1 | 0.571 | 3 | 0.00 | 3.00 |
| 7 | 안목해변 | 강릉 | domestic_travel | 2.89 | 3 | 1 | 0.571 | 3 | 0.00 | 3.00 |
| 8 | 제트 가성비호텔 대연역점 | 부산 | food | 1.93 | 2 | 1 | 0.571 | 2 | 0.00 | 2.00 |
| 9 | 단골식당 연탄돼지불고기 | 대구 | food | 1.93 | 2 | 1 | 0.571 | 2 | 0.00 | 2.00 |
| 10 | 단골식당 연탄돼지불고기 | 대구 | domestic_travel | 1.93 | 2 | 1 | 0.571 | 2 | 0.00 | 2.00 |
| 11 | 사근진해변 | 강릉 | domestic_travel | 1.93 | 2 | 1 | 0.571 | 2 | 0.00 | 2.00 |
| 12 | 남도 생고기 | 광주 | food | 1.93 | 2 | 1 | 0.571 | 2 | 0.00 | 2.00 |
| 13 | 중앙시장 | 대전 | domestic_travel | 1.93 | 2 | 1 | 0.571 | 2 | 0.00 | 2.00 |
| 14 | 광장시장 | 종로 | food | 1.93 | 2 | 1 | 0.571 | 2 | 0.00 | 2.00 |
| 15 | 파인다이닝 | 강남 | food | 1.07 | 2 | 1 | 0.571 | 2 | 0.00 | 2.00 |
| 16 | 대청호 장미축제 | 대전 | domestic_travel | 0.86 | 2 | 1 | 0.571 | 2 | 0.00 | 2.00 |
| 17 | 아침고요수목원 봄나들이 봄꽃축제 | 가평 | domestic_travel | 0 | 0 | 0 | 0.500 | 0 | 0.00 | 0.00 |
| 18 | 고고다이노 키즈호텔 | 가평 | domestic_travel | 0 | 0 | 0 | 0.500 | 0 | 0.00 | 0.00 |
| 19 | 광안리어방축제 | 부산 | domestic_travel | 0 | 0 | 0 | 0.500 | 0 | 0.00 | 0.00 |
| 20 | 자라섬 꽃축제 | 가평 | domestic_travel | 0 | 0 | 0 | 0.500 | 0 | 0.00 | 0.00 |