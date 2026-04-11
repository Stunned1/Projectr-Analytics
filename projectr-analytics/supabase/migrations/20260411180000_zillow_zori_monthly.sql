-- Monthly ZORI index per ZIP (from Zillow Research ZORI CSV date columns).
-- Run in Supabase SQL Editor if not using CLI migrations.

create table if not exists public.zillow_zori_monthly (
  zip text not null check (zip ~ '^\d{5}$'),
  month date not null,
  zori double precision not null,
  primary key (zip, month)
);

create index if not exists zillow_zori_monthly_month_idx on public.zillow_zori_monthly (month desc);

alter table public.zillow_zori_monthly enable row level security;

create policy "zillow_zori_monthly_select_anon"
  on public.zillow_zori_monthly for select to anon using (true);

create policy "zillow_zori_monthly_insert_anon"
  on public.zillow_zori_monthly for insert to anon with check (true);

create policy "zillow_zori_monthly_update_anon"
  on public.zillow_zori_monthly for update to anon using (true) with check (true);
