set check_function_bodies = off;
-- StimulTrack: caffeine logs (private to each person) and the drink catalog
-- (anyone can read). Moved from Firebase project caffeine-tracker-bcd4a.

create schema if not exists stimul;
grant usage on schema stimul to anon, authenticated, service_role;

create table stimul.logs (
  id            uuid primary key default gen_random_uuid(), -- the app makes ids itself, so an offline write can be retried safely
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  drink         text not null check (length(drink) between 1 and 200),
  mg            integer not null check (mg between 0 and 5000),
  at            timestamptz not null,
  volume        numeric,
  unit          text not null default 'ml' check (unit in ('ml', 'oz')),
  base_volume   numeric,
  base_caffeine numeric,
  custom        boolean not null default false,
  legacy_id     text, -- the Firestore document id, for rows brought over from Firebase
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, legacy_id)
);
create index logs_user_at on stimul.logs (user_id, at desc);

create table stimul.drinks (
  id         text primary key,
  drink      text not null,
  caffeine   numeric not null,
  amount_ml  numeric,
  amount_oz  numeric
);

-- One row per person once their Firebase history has been brought over.
create table stimul.imports (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  legacy_uid  text not null,
  rows        integer not null default 0,
  imported_at timestamptz not null default now()
);

create function stimul.touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger logs_touch before update on stimul.logs for each row execute function stimul.touch();

alter table stimul.logs    enable row level security;
alter table stimul.drinks  enable row level security;
alter table stimul.imports enable row level security;

create policy "my logs" on stimul.logs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "anyone reads the catalog" on stimul.drinks for select to anon, authenticated using (true);
create policy "my import" on stimul.imports for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on stimul.logs to authenticated;
grant select, insert on stimul.imports to authenticated;
grant select on stimul.drinks to anon, authenticated;
grant all on all tables in schema stimul to service_role;
revoke execute on all functions in schema stimul from public, anon, authenticated;

-- Live updates: another device's log shows up without a refresh.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table stimul.logs;
  end if;
end $$;
