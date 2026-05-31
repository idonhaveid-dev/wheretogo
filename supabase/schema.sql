-- =============================================================================
-- Naver Blog Place Analysis MVP — Supabase / PostgreSQL schema
--
-- Source of truth: outputs/daily_hot_places_history.csv
-- This file ONLY defines the schema. No connection / migration is run here.
--
-- CSV columns (24):
--   rank, date, category, region, display_name, official_place_name, event_name,
--   alias_name, match_type, candidate_type, naver_place_category, blog_post_count,
--   today_count, previous_average, lift, match_score, hot_score, address,
--   roadAddress, mapx, mapy, naver_place_link, sample_titles, sample_links
--
-- The CSV is split into 3 tables:
--   places              -> one row per real, deduplicated place
--   hot_place_snapshots -> per-date ranking / score rows (the time series)
--   place_aliases       -> blog-side names that differ from the official place name
-- =============================================================================

create extension if not exists pgcrypto; -- for gen_random_uuid()

-- -----------------------------------------------------------------------------
-- 1. places — the real place behind a candidate (official_place_name + location)
-- -----------------------------------------------------------------------------
create table if not exists public.places (
  id                   uuid primary key default gen_random_uuid(),
  official_place_name  text not null,                 -- CSV: official_place_name (naver_place_title)
  naver_place_category text,                           -- CSV: naver_place_category
  address              text,                           -- CSV: address (jibun)
  road_address         text,                           -- CSV: roadAddress
  map_x                bigint,                          -- CSV: mapx (longitude * 1e7; '' -> NULL on load)
  map_y                bigint,                          -- CSV: mapy (latitude  * 1e7; '' -> NULL on load)
  -- Convenience WGS84 coordinates derived from the Naver integer grid.
  longitude            numeric generated always as (map_x::numeric / 10000000) stored,
  latitude             numeric generated always as (map_y::numeric / 10000000) stored,
  naver_place_link     text,                            -- CSV: naver_place_link (may be empty)
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- A place is identified by its official name + road address (road address can be
  -- empty for some travel spots, so we coalesce to '' to keep the key stable).
  constraint places_name_addr_key unique (official_place_name, road_address)
);

comment on table public.places is 'Deduplicated real places (official Naver Local name + location).';
comment on column public.places.map_x is 'Naver mapx, longitude * 1e7. Loader must convert empty string to NULL.';
comment on column public.places.map_y is 'Naver mapy, latitude * 1e7. Loader must convert empty string to NULL.';

create index if not exists places_official_name_idx on public.places (official_place_name);

-- -----------------------------------------------------------------------------
-- 2. hot_place_snapshots — daily ranking / scoring time series
--    Mirrors the CSV upsert key: date + category + region + display_name
--    + official_place_name + match_type  (official_place_name is via place_id).
-- -----------------------------------------------------------------------------
create table if not exists public.hot_place_snapshots (
  id               uuid primary key default gen_random_uuid(),
  place_id         uuid not null references public.places (id) on delete cascade,
  snapshot_date    date not null,                       -- CSV: date
  category         text not null,                       -- CSV: category (food / domestic_travel)
  region           text not null,                       -- CSV: region
  display_name     text not null,                       -- CSV: display_name (what people called it)
  event_name       text,                                -- CSV: event_name (event_on_place only)
  match_type       text not null,                       -- CSV: match_type
  candidate_type   text,                                -- CSV: candidate_type
  rank             integer,                             -- CSV: rank (within that day's snapshot)
  hot_score        numeric,                             -- CSV: hot_score
  blog_post_count  integer,                             -- CSV: blog_post_count
  today_count      integer,                             -- CSV: today_count (may be NULL)
  previous_average numeric,                             -- CSV: previous_average
  lift             numeric,                             -- CSV: lift (may be NULL)
  match_score      integer,                             -- CSV: match_score
  sample_titles    text,                                -- CSV: sample_titles ('|'-joined)
  sample_links     text,                                -- CSV: sample_links ('|'-joined)
  created_at       timestamptz not null default now(),

  constraint hot_place_snapshots_match_type_chk
    check (match_type in ('exact_place', 'event_on_place', 'alias_match', 'weak_match')),

  -- One row per place per day per "how it was referred to".
  constraint hot_place_snapshots_daily_key
    unique (snapshot_date, category, region, display_name, place_id, match_type)
);

comment on table public.hot_place_snapshots is 'Per-date hot ranking / score rows. The time series for daily_hot_places.';

create index if not exists hot_snapshots_date_idx        on public.hot_place_snapshots (snapshot_date);
create index if not exists hot_snapshots_date_score_idx  on public.hot_place_snapshots (snapshot_date, hot_score desc);
create index if not exists hot_snapshots_category_idx     on public.hot_place_snapshots (category, region);
create index if not exists hot_snapshots_place_idx        on public.hot_place_snapshots (place_id);

-- -----------------------------------------------------------------------------
-- 3. place_aliases — blog-side names that differ from the official place name
--    Populated for alias_match (alias_name) and event_on_place (event_name),
--    and for any display_name that differs from the official place name.
-- -----------------------------------------------------------------------------
create table if not exists public.place_aliases (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid not null references public.places (id) on delete cascade,
  alias_name  text not null,                            -- CSV: alias_name / event_name / display_name
  match_type  text not null,                            -- CSV: match_type that produced this alias
  created_at  timestamptz not null default now(),

  constraint place_aliases_match_type_chk
    check (match_type in ('exact_place', 'event_on_place', 'alias_match', 'weak_match')),

  constraint place_aliases_unique unique (place_id, alias_name, match_type)
);

comment on table public.place_aliases is 'Maps blog-side names (alias / event / display) to the official place.';

create index if not exists place_aliases_alias_idx on public.place_aliases (alias_name);
create index if not exists place_aliases_place_idx on public.place_aliases (place_id);

-- -----------------------------------------------------------------------------
-- updated_at maintenance for places
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists places_set_updated_at on public.places;
create trigger places_set_updated_at
  before update on public.places
  for each row execute function public.set_updated_at();
