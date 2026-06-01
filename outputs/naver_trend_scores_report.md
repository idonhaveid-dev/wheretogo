# Naver Search Trend Scores Report (OPTIONAL EXPERIMENT)

> ⚠️ Search Trend is deprecated and ends 2026-07-23.
> This is an optional experiment. It writes a separate `naver_trend_scores.csv` and never
> modifies `weekly_hot_places.csv`. It is excluded from `npm run build` and the daily pipeline,
> and any API failure / shutdown / missing key is non-fatal (the run still exits successfully).

- Live API called.
- Source: weekly_hot_places.csv (top 30 by weekly rank)
- Comparison window: previous 30d [2026-04-02..2026-05-01] vs recent 30d [2026-05-02..2026-05-31]
- DataLab call: timeUnit=date, 5 groups/request, 150ms delay
- API requests made: 5
- Candidates scored OK: 23 · errored: 0

## Scoring

`trend_growth = recent_30d_avg / (previous_30d_avg + 1)`
`trend_score = min(trend_growth, 5) * 10`
`final_hot_score = weekly_hot_score * 0.7 + trend_score * 0.3`

DataLab ratios are relative within each request (period max = 100), but the recent-vs-previous
ratio is scale-invariant per keyword group, so trend_growth is comparable across rows.

## Top 10 by trend_growth

| rank | display_name | region | trend_keyword | recent_30d_avg | previous_30d_avg | trend_growth | trend_score |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 16 | 대청호 장미축제 | 대전 | 대전 대청호 장미축제 | 10.83 | 0 | 10.7912 | 50 |
| 6 | 연화식당 | 광주 | 광주 연화식당 | 9.12 | 1.58 | 3.5401 | 35.4 |
| 21 | 자라섬꽃축제 | 가평 | 가평 자라섬꽃축제 | 33.04 | 9.93 | 3.0227 | 30.23 |
| 19 | 광안리어방축제 | 부산 | 부산 광안리어방축제 | 10.57 | 2.63 | 2.915 | 29.15 |
| 20 | 자라섬 꽃축제 | 가평 | 가평 자라섬 꽃축제 | 18.38 | 5.52 | 2.8171 | 28.17 |
| 18 | 고고다이노 키즈호텔 | 가평 | 가평 고고다이노 키즈호텔 | 6.28 | 3.29 | 1.4649 | 14.65 |
| 11 | 사근진해변 | 강릉 | 강릉 사근진해변 | 7.98 | 5.26 | 1.2755 | 12.76 |
| 2 | 서문시장 | 대구 | 대구 서문시장 | 45.75 | 38.34 | 1.1629 | 11.63 |
| 3 | 서문시장 | 대구 | 대구 서문시장 | 45.75 | 38.34 | 1.1629 | 11.63 |
| 1 | 중앙시장 | 강릉 | 강릉 중앙시장 | 44.91 | 40.61 | 1.0794 | 10.79 |

## Top 10 by final_hot_score

| rank | display_name | region | trend_keyword | weekly_hot_score | trend_score | final_hot_score | error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 16 | 대청호 장미축제 | 대전 | 대전 대청호 장미축제 | 0.86 | 50 | 15.6 |  |
| 6 | 연화식당 | 광주 | 광주 연화식당 | 2.89 | 35.4 | 12.64 |  |
| 1 | 중앙시장 | 강릉 | 강릉 중앙시장 | 9.64 | 10.79 | 9.98 |  |
| 21 | 자라섬꽃축제 | 가평 | 가평 자라섬꽃축제 | 0 | 30.23 | 9.07 |  |
| 19 | 광안리어방축제 | 부산 | 부산 광안리어방축제 | 0 | 29.15 | 8.74 |  |
| 20 | 자라섬 꽃축제 | 가평 | 가평 자라섬 꽃축제 | 0 | 28.17 | 8.45 |  |
| 2 | 서문시장 | 대구 | 대구 서문시장 | 5.79 | 11.63 | 7.54 |  |
| 3 | 서문시장 | 대구 | 대구 서문시장 | 5.79 | 11.63 | 7.54 |  |
| 7 | 안목해변 | 강릉 | 강릉 안목해변 | 2.89 | 10.66 | 5.22 |  |
| 11 | 사근진해변 | 강릉 | 강릉 사근진해변 | 1.93 | 12.76 | 5.18 |  |