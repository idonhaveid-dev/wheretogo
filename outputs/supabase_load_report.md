# Supabase Load (Dry-Run) Report

> Dry-run only. No Supabase connection, no inserts. These CSVs are the staged
> payloads a real loader would upsert into the schema in `supabase/schema.sql`.

- Input: outputs/daily_hot_places_history.csv
- Input rows: 25
- Distinct places (official_place_name + roadAddress): 19
- hot_place_snapshots rows: 25
- place_aliases rows: 7
- Places missing map_x/map_y: 0
- Places missing naver_place_link: 7

## snapshots by match_type

| match_type | count |
| --- | --- |
| exact_place | 17 |
| event_on_place | 7 |
| alias_match | 1 |

## aliases by match_type (exact_place excluded by design)

| match_type | count |
| --- | --- |
| event_on_place | 6 |
| alias_match | 1 |

## Sample places (first 10)

| place_id | official_place_name | road_address | map_x | map_y |
| --- | --- | --- | --- | --- |
| 1 | 중앙시장 | 강원특별자치도 강릉시 금성로 21 | 1288983903 | 377535620 |
| 2 | 연화식당 | 광주광역시 서구 마륵복개로 147 아트빌 | 1268530929 | 351478649 |
| 3 | 서문시장 | 대구광역시 중구 달성로 50 서문시장 | 1285802593 | 358691115 |
| 4 | 광교호수공원 | 경기도 수원시 영통구 광교호수로 165 | 1270696711 | 372826146 |
| 5 | 단골식당 연탄돼지불고기 | 대구광역시 북구 칠성시장로7길 9-1 1,2층 | 1286036874 | 358759585 |
| 6 | 사근진해변 | 강원특별자치도 강릉시 해안로604번길 16 | 1288990719 | 378128825 |
| 7 | 중앙시장 | 대전광역시 동구 중앙로 200-1 | 1274319380 | 363298389 |
| 8 | 화명생태공원 | 부산광역시 북구 | 1290041500 | 352310095 |
| 9 | 전주덕진공원 | 전북특별자치도 전주시 덕진구 권삼득로 390-1 전주덕진공원 | 1271227180 | 358479519 |
| 10 | 사천해변 |  | 1288784877 | 378300323 |

## Sample aliases (first 10)

| place_id | alias_name | match_type |
| --- | --- | --- |
| 12 | 대청호장미축제 | event_on_place |
| 13 | 자라섬 꽃축제 | event_on_place |
| 12 | 대청호 장미축제 | event_on_place |
| 13 | 자라섬꽃축제 | event_on_place |
| 17 | 경기도꽃축제 | event_on_place |
| 18 | 아침고요수목원 수국축제 | event_on_place |
| 19 | 장승포호텔 | alias_match |

## NULL handling for the real loader

Empty strings are kept as-is in these CSVs. The loader must convert `''` -> SQL `NULL` for:

- places: `map_x`, `map_y`, `naver_place_link`, `address`, `road_address`, `naver_place_category`
- hot_place_snapshots: `today_count`, `lift`, `previous_average`, `event_name`, `rank`, `hot_score`

Load order (FK-safe): places -> hot_place_snapshots -> place_aliases.
`place_id` here is a deterministic dry-run surrogate; a real loader resolves the natural
key (official_place_name + road_address) to the DB-generated `places.id` (uuid).

Upsert keys (ON CONFLICT ... DO UPDATE):
- places: (official_place_name, road_address)
- hot_place_snapshots: (snapshot_date, category, region, display_name, place_id, match_type)
- place_aliases: (place_id, alias_name, match_type)