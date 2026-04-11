-- Analyst shortlist: one row per saved ZIP/site. Requires Supabase Auth (enable Anonymous sign-ins
-- for demo, or use email/OAuth). RLS ties rows to auth.uid().

create table if not exists public.saved_sites (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  zip text not null,
  lat numeric,
  lng numeric,
  market_label text,
  cycle_position text,
  cycle_stage text,
  momentum_score numeric,
  notes text,
  created_at timestamptz default now() not null
);

create index if not exists saved_sites_user_id_idx on public.saved_sites (user_id);
create index if not exists saved_sites_zip_idx on public.saved_sites (zip);

alter table public.saved_sites enable row level security;

create policy "Users manage own saved_sites"
  on public.saved_sites
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
