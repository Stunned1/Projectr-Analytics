-- Persists normalized address -> lat/lng geocodes across server restarts.
-- Apply in Supabase SQL Editor or via `supabase db push` if you use the CLI.

create table if not exists public.address_geocode_cache (
  normalized_query text primary key check (length(normalized_query) >= 3),
  resolution_status text not null check (resolution_status in ('ok', 'miss')),
  lat double precision,
  lng double precision,
  formatted_address text,
  postal_code text,
  source text not null,
  updated_at timestamptz not null default now(),
  check (
    (resolution_status = 'ok' and lat is not null and lng is not null)
    or
    (resolution_status = 'miss' and lat is null and lng is null)
  )
);

create index if not exists address_geocode_cache_updated_at_idx
  on public.address_geocode_cache (updated_at desc);

alter table public.address_geocode_cache enable row level security;

create policy "address_geocode_cache_select_anon"
  on public.address_geocode_cache for select
  to anon
  using (true);

create policy "address_geocode_cache_insert_anon"
  on public.address_geocode_cache for insert
  to anon
  with check (true);

create policy "address_geocode_cache_update_anon"
  on public.address_geocode_cache for update
  to anon
  using (true)
  with check (true);
