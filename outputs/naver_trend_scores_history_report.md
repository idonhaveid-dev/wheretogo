# Naver Search Trend Scores — History (OPTIONAL EXPERIMENT)

> ⚠️ Search Trend is deprecated and ends 2026-07-23.
> Accumulated daily until the API shuts down. Separate from the core pipeline; never modifies
> `weekly_hot_places.csv`. API failure / missing key / shutdown is non-fatal (run still exits 0).

- History file: naver_trend_scores_history.csv
- Snapshot folder: trend_snapshots/<date>/naver_trend_scores.csv
- Run dates accumulated: 1
- Total history rows: 23
- History key: date + category + region + display_name + trend_keyword

## Per-date status (success / no_data / skip / error)

| date | total | ok | no_data | skip | error | skip_reason |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-06-01 | 23 | 23 | 0 | 0 | 0 |  |

## Latest run (2026-06-01) — top 10 by final_hot_score

| rank | display_name | region | trend_keyword | trend_growth | trend_score | weekly_hot_score | final_hot_score | error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 16 | 대청호 장미축제 | 대전 | 대전 대청호 장미축제 | 10.7912 | 50 | 0.86 | 15.6 |  |
| 6 | 연화식당 | 광주 | 광주 연화식당 | 3.5401 | 35.4 | 2.89 | 12.64 |  |
| 1 | 중앙시장 | 강릉 | 강릉 중앙시장 | 1.0794 | 10.79 | 9.64 | 9.98 |  |
| 21 | 자라섬꽃축제 | 가평 | 가평 자라섬꽃축제 | 3.0227 | 30.23 | 0 | 9.07 |  |
| 19 | 광안리어방축제 | 부산 | 부산 광안리어방축제 | 2.915 | 29.15 | 0 | 8.74 |  |
| 20 | 자라섬 꽃축제 | 가평 | 가평 자라섬 꽃축제 | 2.8171 | 28.17 | 0 | 8.45 |  |
| 2 | 서문시장 | 대구 | 대구 서문시장 | 1.1629 | 11.63 | 5.79 | 7.54 |  |
| 3 | 서문시장 | 대구 | 대구 서문시장 | 1.1629 | 11.63 | 5.79 | 7.54 |  |
| 7 | 안목해변 | 강릉 | 강릉 안목해변 | 1.066 | 10.66 | 2.89 | 5.22 |  |
| 11 | 사근진해변 | 강릉 | 강릉 사근진해변 | 1.2755 | 12.76 | 1.93 | 5.18 |  |