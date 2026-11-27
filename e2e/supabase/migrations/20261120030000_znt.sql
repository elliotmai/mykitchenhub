set check_function_bodies = off;
-- ZNT: the household's herd, breeding sessions, heat tracking and feeding.
-- Moved from Firebase project znt-manager, where it was one shared set of
-- documents. Each Firestore document becomes one row here, its fields kept
-- as JSON (dates as {"$ts": milliseconds}), so the app's records keep their
-- shape. Everything belongs to a household: every member sees and edits it.

create table znt.docs (
  household_id uuid not null default core.my_household() references core.households (id) on delete cascade,
  collection   text not null check (collection in (
                 'groups', 'cattle', 'heatEvents', 'lutalyseAdmin', 'hayRecords',
                 'cubesRecords', 'purchases', 'sessions', 'settings')),
  id           text not null check (length(id) between 1 and 128),
  data         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (household_id, collection, id)
);

-- One row per household once its Firebase records have been brought over.
create table znt.imports (
  household_id uuid primary key default core.my_household() references core.households (id) on delete cascade,
  rows         integer not null default 0,
  imported_by  uuid default auth.uid() references auth.users (id) on delete set null,
  imported_at  timestamptz not null default now()
);

-- The secret in the household's calendar feed link (calendar apps can't sign in).
create table znt.calendar_feeds (
  household_id uuid primary key default core.my_household() references core.households (id) on delete cascade,
  token        text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at   timestamptz not null default now()
);

create function znt.touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger docs_touch before update on znt.docs for each row execute function znt.touch();

alter table znt.docs           enable row level security;
alter table znt.imports        enable row level security;
alter table znt.calendar_feeds enable row level security;

create policy "household reads and writes its herd" on znt.docs for all to authenticated
  using (core.is_member(household_id)) with check (core.is_member(household_id));
create policy "household's import marker" on znt.imports for all to authenticated
  using (core.is_member(household_id)) with check (core.is_member(household_id));
create policy "household's calendar link" on znt.calendar_feeds for all to authenticated
  using (core.is_member(household_id)) with check (core.is_member(household_id));

grant select, insert, update, delete on znt.docs to authenticated;
grant select, insert on znt.imports to authenticated;
grant select, insert, delete on znt.calendar_feeds to authenticated;
grant all on all tables in schema znt to service_role;

-- The calendar feed: breeding sessions for whoever holds the link, nothing else.
create function znt.calendar_sessions(feed_token text) returns setof jsonb
language sql stable security definer set search_path = '' as $$
  select d.data || jsonb_build_object('id', d.id)
  from znt.calendar_feeds f
  join znt.docs d on d.household_id = f.household_id and d.collection = 'sessions'
  where f.token = feed_token and length(feed_token) >= 24
$$;

revoke execute on all functions in schema znt from public, anon, authenticated;
grant execute on function znt.calendar_sessions(text) to anon, authenticated;
grant execute on all functions in schema znt to service_role;
