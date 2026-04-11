-- City / borough shortlist: replay the same search string (e.g. "Austin, TX", "manhattan").

alter table public.saved_sites
  add column if not exists is_aggregate boolean not null default false;

alter table public.saved_sites
  add column if not exists saved_search text;
