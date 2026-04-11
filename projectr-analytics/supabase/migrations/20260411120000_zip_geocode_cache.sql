-- Persists ZIP → lat/lng + FIPS + display fields across server restarts (shared with all instances).
-- Apply in Supabase SQL Editor or via `supabase db push` if you use the CLI.

create table if not exists public.zip_geocode_cache (
  zip text primary key check (zip ~ '^\d{5}$'),
  lat double precision not null,
  lng double precision not null,
  city text not null,
  state text not null,
  state_fips text not null,
  county_fips text not null,
  source text not null,
  updated_at timestamptz not null default now()
);

create index if not exists zip_geocode_cache_updated_at_idx
  on public.zip_geocode_cache (updated_at desc);

alter table public.zip_geocode_cache enable row level security;

-- Match typical anon read/write patterns used with NEXT_PUBLIC_SUPABASE_ANON_KEY in API routes.
create policy "zip_geocode_cache_select_anon"
  on public.zip_geocode_cache for select
  to anon
  using (true);

create policy "zip_geocode_cache_insert_anon"
  on public.zip_geocode_cache for insert
  to anon
  with check (true);

create policy "zip_geocode_cache_update_anon"
  on public.zip_geocode_cache for update
  to anon
  using (true)
  with check (true);
