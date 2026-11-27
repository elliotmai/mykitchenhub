set check_function_bodies = off;
-- Hive core: people, households, and the links back to old Firebase accounts.
-- Every app schema builds on these. See docs/supabase-migration-plan.md.
--
-- Access rules live here, in the database (row-level security), so an app
-- can't show one household's things to another by mistake.

create schema if not exists core;
grant usage on schema core to anon, authenticated, service_role;

-- ------------------------------------------------------------------ people --

create table core.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text,
  created_at   timestamptz not null default now()
);

-- Every new account gets a profile, whichever app it signed up in.
create function core.on_auth_user_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into core.profiles (id, email, display_name)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name'))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function core.on_auth_user_created();

-- -------------------------------------------------------------- households --

create table core.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 80),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table core.household_members (
  household_id uuid not null references core.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user on core.household_members (user_id);

create table core.household_invites (
  code         text primary key,
  household_id uuid not null references core.households (id) on delete cascade,
  created_by   uuid not null references auth.users (id) on delete cascade,
  expires_at   timestamptz not null default now() + interval '7 days',
  used_by      uuid references auth.users (id) on delete set null,
  used_at      timestamptz
);

-- The questions every access rule in every schema asks. Security definer so
-- a rule on another table can ask without needing its own rights here.
create function core.is_member(hid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from core.household_members where household_id = hid and user_id = auth.uid())
$$;

create function core.is_owner(hid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from core.household_members where household_id = hid and user_id = auth.uid() and role = 'owner')
$$;

-- My household, for apps that only ever deal with one. Null if none.
create function core.my_household() returns uuid
language sql stable security definer set search_path = '' as $$
  select household_id from core.household_members where user_id = auth.uid() order by joined_at limit 1
$$;

-- Two people share a household: lets a profile be seen by housemates.
create function core.shares_household(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from core.household_members a join core.household_members b using (household_id)
    where a.user_id = auth.uid() and b.user_id = other)
$$;

create function core.create_household(name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  insert into core.households (name, created_by) values (name, auth.uid()) returning id into hid;
  insert into core.household_members (household_id, user_id, role) values (hid, auth.uid(), 'owner');
  return hid;
end $$;

-- An owner makes a code; whoever they give it to joins with it.
create function core.create_invite(hid uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if not core.is_owner(hid) then raise exception 'only an owner can invite' using errcode = '42501'; end if;
  c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into core.household_invites (code, household_id, created_by) values (c, hid, auth.uid());
  return c;
end $$;

create function core.join_household(invite text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare inv core.household_invites;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into inv from core.household_invites where code = upper(trim(invite)) for update;
  if not found or inv.used_at is not null or inv.expires_at < now() then
    raise exception 'that invite code is not valid' using errcode = 'P0002';
  end if;
  insert into core.household_members (household_id, user_id) values (inv.household_id, auth.uid())
    on conflict do nothing;
  update core.household_invites set used_by = auth.uid(), used_at = now() where code = inv.code;
  return inv.household_id;
end $$;

-- ------------------------------------------------------ old Firebase links --

-- Which old account (app + Firebase uid, or a placeholder id like ZNT's
-- 'znt-manager-user') became which person. Import scripts read this to give
-- every row its owner. Server-only.
create table core.legacy_ids (
  app        text not null,
  legacy_id  text not null,
  user_id    uuid references auth.users (id) on delete cascade,
  household_id uuid references core.households (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (app, legacy_id),
  check (user_id is not null or household_id is not null)
);

-- Personal API tokens, one table for every app (KitchenHub, LearnLeaf and
-- Wander each had their own). Only the SHA-256 of a token is stored.
create table core.api_tokens (
  hash         text primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  app          text not null,
  label        text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index api_tokens_user on core.api_tokens (user_id);

-- ------------------------------------------------------------------ access --

alter table core.profiles          enable row level security;
alter table core.households        enable row level security;
alter table core.household_members enable row level security;
alter table core.household_invites enable row level security;
alter table core.legacy_ids        enable row level security;
alter table core.api_tokens        enable row level security;

create policy "see myself and housemates" on core.profiles for select
  using (id = auth.uid() or core.shares_household(id));
create policy "edit myself" on core.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

create policy "see my households" on core.households for select using (core.is_member(id));
create policy "owners rename" on core.households for update using (core.is_owner(id)) with check (core.is_owner(id));

create policy "see who is in my households" on core.household_members for select using (core.is_member(household_id));
create policy "leave, or owners remove" on core.household_members for delete
  using (user_id = auth.uid() or core.is_owner(household_id));

create policy "owners see their invites" on core.household_invites for select using (core.is_owner(household_id));
create policy "owners cancel invites" on core.household_invites for delete using (core.is_owner(household_id));

-- legacy_ids: no policies, so only the service role (import scripts) can touch it.

create policy "see my tokens" on core.api_tokens for select using (user_id = auth.uid());
create policy "revoke my tokens" on core.api_tokens for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, update on core.profiles to authenticated;
grant select, update on core.households to authenticated;
grant select, delete on core.household_members to authenticated;
grant select, delete on core.household_invites to authenticated;
grant select, update (revoked_at, label) on core.api_tokens to authenticated;
grant all on all tables in schema core to service_role;

-- Supabase grants every new function to anon and authenticated by default; start from none.
revoke execute on all functions in schema core from public, anon, authenticated;
-- Signed out, the questions just answer no; other schemas' rules can ask them safely.
grant execute on function core.is_member(uuid), core.is_owner(uuid), core.my_household(),
  core.shares_household(uuid) to anon, authenticated;
grant execute on function core.create_household(text), core.create_invite(uuid),
  core.join_household(text) to authenticated;
grant execute on all functions in schema core to service_role;
