# Supabase Schema Notes

Design notes for `supabase/schema.sql`, derived from `outputs/daily_hot_places_history.csv`.

> Status: **design only**. No Supabase connection, migration, or UI is included here.
> This is still the CSV-quality / data-modeling stage.

## Goal

Preserve every CSV column, but split the flat daily history into 3 app-friendly tables:

| Table | Grain | Purpose |
| --- | --- | --- |
| `places` | one real place | The actual venue/landmark (official name + location). |
| `hot_place_snapshots` | one place × day × how-it-was-called | The time series of daily ranking/scores. |
| `place_aliases` | one blog-side name → place | Connects what people *said* to the official place. |

## Why split this way

- The CSV repeats a place's address/coordinates on every daily row. `places` stores that **once**, so the app can show stable location data and the history table stays lean.
- "Hotness" is inherently **per date** → `hot_place_snapshots` is the append-only time series the app reads for "오늘 뜨는 곳" and day-over-day comparison.
- The same place is referred to by different blog-side names (event names, abbreviations). `place_aliases` keeps that mapping so search/recommendation can match either name to one place.

## CSV → table column mapping

### places
| CSV column | Column | Notes |
| --- | --- | --- |
| official_place_name | official_place_name | NOT NULL, part of unique key |
| naver_place_category | naver_place_category | |
| address | address | jibun address |
| roadAddress | road_address | camelCase → snake_case; part of unique key |
| mapx | map_x | `bigint`, longitude × 1e7; **empty string → NULL on load** |
| mapy | map_y | `bigint`, latitude × 1e7; **empty string → NULL on load** |
| (derived) | longitude / latitude | generated `map_x/1e7`, `map_y/1e7` (WGS84) |
| naver_place_link | naver_place_link | may be empty |

**Identity:** `unique (official_place_name, road_address)`. `naver_place_link` would be ideal but is empty for some rows, so it is not the key. If two genuinely different places share name + road address, revisit this key (e.g. add `map_x`/`map_y`).

### hot_place_snapshots
| CSV column | Column | Notes |
| --- | --- | --- |
| date | snapshot_date | `date` |
| category | category | food / domestic_travel |
| region | region | |
| display_name | display_name | what people called it |
| event_name | event_name | only for event_on_place |
| match_type | match_type | check-constrained |
| candidate_type | candidate_type | |
| rank | rank | rank *within that day's* snapshot |
| hot_score | hot_score | numeric |
| blog_post_count | blog_post_count | integer |
| today_count | today_count | integer, may be NULL |
| previous_average | previous_average | numeric |
| lift | lift | numeric, may be NULL |
| match_score | match_score | integer |
| sample_titles | sample_titles | `|`-joined |
| sample_links | sample_links | `|`-joined |
| official_place_name | → place_id | resolved to a `places` FK |

**Upsert key:** `unique (snapshot_date, category, region, display_name, place_id, match_type)`.
This mirrors the CSV dedup key `date + category + region + display_name + official_place_name + match_type` (official_place_name is represented by `place_id`).

### place_aliases
| CSV source | Column | Notes |
| --- | --- | --- |
| alias_name / event_name / display_name | alias_name | the blog-side name |
| match_type | match_type | which match produced this alias |
| official_place_name | → place_id | FK to `places` |

**Which rows produce an alias:**
- `alias_match` → `alias_name` (e.g. `장승포호텔` → place `하운드호텔 거제 장승포`)
- `event_on_place` → `event_name` (e.g. `대청호 장미축제` → place `대청호 반자연수변공원`)
- `exact_place` → no alias needed (`display_name == official_place_name`)
- `weak_match` → optional; only if `INCLUDE_WEAK=1` rows are loaded

**Upsert key:** `unique (place_id, alias_name, match_type)`.

## Relationships

```
places (1) ──< hot_place_snapshots (many)   via place_id
places (1) ──< place_aliases        (many)   via place_id
```

Both children use `on delete cascade`.

## Suggested load order (when loading is implemented later)

1. Upsert distinct places → `places`, keep the returned `id` per (official_place_name, road_address).
2. Upsert `hot_place_snapshots` with the resolved `place_id` (ON CONFLICT on the daily key → update score/rank).
3. Upsert `place_aliases` for alias_match / event_on_place rows.

Loader responsibilities:
- Convert empty strings to `NULL` (especially `map_x`, `map_y`, `today_count`, `lift`).
- `snapshot_date` comes straight from the CSV `date` column.
- Idempotent re-runs rely on the unique constraints + `ON CONFLICT ... DO UPDATE`.

## Out of scope (intentionally not added yet)

- Row Level Security policies (add before exposing via the app).
- Supabase client / connection code.
- Recommendation logic and any UI.
