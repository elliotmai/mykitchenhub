set check_function_bodies = off;
-- Let's Eat: moved from Firebase (project let-s-eat-efb04), where it had no
-- sign-in at all: everything sat under one shared "users/userId" for anyone
-- on the internet to read and change. Here it belongs to a household (Hive's
-- core.households): its members read and change it, nobody else.
--
--   letseat.docs   one row per Firestore document, by path ('recipes/ID',
--                  'events/ID/days/ID')
--   letseat.lists  the shopping list and stores (were Realtime Database), one
--                  JSON tree per household, changed a path at a time
--   letseat.legacy what was in the old database, waiting to be claimed

create table letseat.docs (
  household_id uuid not null default core.my_household() references core.households (id) on delete cascade,
  path         text not null check (path ~ '^[^/]+/[^/]+(/[^/]+/[^/]+)*$' and length(path) < 400),
  parent       text generated always as (regexp_replace(path, '/[^/]+$', '')) stored,
  data         jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  primary key (household_id, path)
);
create index docs_parent on letseat.docs (household_id, parent);

create table letseat.lists (
  household_id uuid primary key default core.my_household() references core.households (id) on delete cascade,
  tree         jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

alter table letseat.docs  enable row level security;
alter table letseat.lists enable row level security;
create policy "the household's recipes and events" on letseat.docs for all to authenticated
  using (core.is_member(household_id)) with check (core.is_member(household_id));
create policy "the household's lists" on letseat.lists for all to authenticated
  using (core.is_member(household_id)) with check (core.is_member(household_id));

/** Set (or with null, remove) one path in my household's lists, in one step. */
create function letseat.list_set(p text[], value jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare hid uuid := core.my_household();
begin
  if hid is null then raise exception 'Join or make a household first.' using errcode = '42501'; end if;
  insert into letseat.lists (household_id) values (hid) on conflict do nothing;
  if value is null or value = 'null'::jsonb then
    update letseat.lists set tree = tree #- p, updated_at = now() where household_id = hid;
  else
    -- make the parents on the way, then set
    for i in 1 .. cardinality(p) - 1 loop
      update letseat.lists set tree = jsonb_set(tree, p[1:i], '{}'::jsonb, true)
        where household_id = hid and jsonb_typeof(tree #> p[1:i]) is distinct from 'object';
    end loop;
    update letseat.lists set tree = jsonb_set(tree, p, value, true), updated_at = now() where household_id = hid;
  end if;
end $$;

-- ── What was in the old database ─────────────────────────────────────────
create table letseat.legacy (path text primary key, data jsonb not null);
create table letseat.legacy_claim (
  only_once    boolean primary key default true check (only_once),
  household_id uuid references core.households (id) on delete set null,
  claimed_by   uuid references auth.users (id) on delete set null,
  claimed_at   timestamptz not null default now()
);
alter table letseat.legacy enable row level security;
alter table letseat.legacy_claim enable row level security;
-- no policies: only these functions and the service role.

/** Is the old data still waiting, and may I take it? */
create function letseat.legacy_status() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from letseat.legacy_claim) then 'claimed'
    when not exists (select 1 from letseat.legacy) then 'none'
    -- The old data was open to anyone, so it goes to an account that existed
    -- before the move (people signing up from now on can't take it).
    when (select created_at from auth.users where id = auth.uid()) >= timestamptz '2026-11-20 17:15:00+00' then 'not_eligible'
    else 'waiting'
  end
$$;

/** Take the old recipes and events into my household, once; `lists` is the old shopping list and stores. */
create function letseat.claim_legacy(lists jsonb default null) returns int
language plpgsql security definer set search_path = '' as $$
declare hid uuid := core.my_household(); n int;
begin
  if hid is null then raise exception 'Join or make a household first.' using errcode = '42501'; end if;
  if letseat.legacy_status() <> 'waiting' then raise exception 'There is nothing for you to bring over.' using errcode = '42501'; end if;
  insert into letseat.legacy_claim (household_id, claimed_by) values (hid, auth.uid());
  insert into letseat.docs (household_id, path, data) select hid, path, data from letseat.legacy on conflict do nothing;
  get diagnostics n = row_count;
  if lists is not null and jsonb_typeof(lists) = 'object' then
    insert into letseat.lists (household_id, tree) values (hid, lists) on conflict (household_id) do nothing;
  end if;
  delete from letseat.legacy where true; -- Supabase refuses a DELETE without WHERE
  return n;
end $$;

revoke all on all tables in schema letseat from anon, authenticated;
grant select, insert, update, delete on letseat.docs, letseat.lists to authenticated;
grant all on all tables in schema letseat to service_role;
revoke execute on all functions in schema letseat from public, anon, authenticated;
grant execute on function letseat.list_set(text[], jsonb), letseat.legacy_status(), letseat.claim_legacy(jsonb) to authenticated;
grant execute on all functions in schema letseat to service_role;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table letseat.docs, letseat.lists;
  end if;
end $$;
