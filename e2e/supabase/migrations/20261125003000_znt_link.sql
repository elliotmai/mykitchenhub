set check_function_bodies = off;
-- ZNT without a sign-in. Whoever opens ZNT uses the household's herd right
-- away: a Hive session (household member) just works; any other device gets in
-- by opening the household's "ZNT link" once. That device holds a Supabase
-- anonymous session (kept only by ZNT, never in the shared hive-auth cookie),
-- and znt.join_with_link records it in znt.devices: access to this
-- household's ZNT rows and nothing else. Anonymous users are never added to
-- core.household_members, so every other app (all policies on
-- core.is_member / auth.uid()) still shows them nothing. Hive's server code
-- refuses anonymous tokens (Fridge-Board netlify/lib/supabaseToken.mjs).

-- The household's link secret. Members read it through znt.my_link().
create table znt.links (
  household_id uuid primary key references core.households (id) on delete cascade,
  key          text not null unique check (length(key) >= 40),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

-- Devices that opened the link: the anonymous user, and whose herd it sees.
create table znt.devices (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  household_id uuid not null references core.households (id) on delete cascade,
  joined_at    timestamptz not null default now()
);

alter table znt.links   enable row level security;
alter table znt.devices enable row level security;
-- No policies and no grants: only the functions below touch these.
grant all on znt.links, znt.devices to service_role;

create function znt.new_key() returns text language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
$$;

-- The household ZNT shows you: your Hive household, or the one this device's link opened.
create function znt.household() returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(core.my_household(),
                  (select household_id from znt.devices where user_id = auth.uid()))
$$;

-- Whether you may read and write this household's ZNT rows.
create function znt.can_use(hid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select core.is_member(hid)
      or exists (select 1 from znt.devices where user_id = auth.uid() and household_id = hid)
$$;

-- Open the link: this session (normally a fresh anonymous one) gets the household's ZNT.
create function znt.join_with_link(link_key text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'no session' using errcode = '42501'; end if;
  select household_id into hid from znt.links where key = link_key and length(link_key) >= 40;
  if hid is null then raise exception 'that ZNT link is not valid' using errcode = 'P0002'; end if;
  if not core.is_member(hid) then
    insert into znt.devices (user_id, household_id) values (auth.uid(), hid)
      on conflict (user_id) do update set household_id = excluded.household_id, joined_at = now();
  end if;
  return hid;
end $$;

-- Household members (signed in to Hive) see the link; made on first ask.
create function znt.my_link() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare hid uuid := core.my_household(); k text;
begin
  if hid is null then raise exception 'only household members see the ZNT link' using errcode = '42501'; end if;
  select key into k from znt.links where household_id = hid;
  if k is null then
    insert into znt.links (household_id, key, created_by) values (hid, znt.new_key(), auth.uid())
      on conflict (household_id) do nothing;
    select key into k from znt.links where household_id = hid;
  end if;
  return k;
end $$;

-- A new link; every device that opened the old one is let go.
create function znt.reset_link() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare hid uuid := core.my_household(); k text := znt.new_key();
begin
  if hid is null then raise exception 'only household members reset the ZNT link' using errcode = '42501'; end if;
  insert into znt.links (household_id, key, created_by) values (hid, k, auth.uid())
    on conflict (household_id) do update set key = excluded.key, created_by = excluded.created_by, created_at = now();
  delete from znt.devices where household_id = hid;
  return k;
end $$;

-- ZNT's own rows now follow znt.can_use / znt.household instead of core membership alone.
alter table znt.docs           alter column household_id set default znt.household();
alter table znt.imports        alter column household_id set default znt.household();
alter table znt.calendar_feeds alter column household_id set default znt.household();

drop policy "household reads and writes its herd" on znt.docs;
drop policy "household's import marker" on znt.imports;
drop policy "household's calendar link" on znt.calendar_feeds;
create policy "household reads and writes its herd" on znt.docs for all to authenticated
  using (znt.can_use(household_id)) with check (znt.can_use(household_id));
create policy "household's import marker" on znt.imports for all to authenticated
  using (znt.can_use(household_id)) with check (znt.can_use(household_id));
create policy "household's calendar link" on znt.calendar_feeds for all to authenticated
  using (znt.can_use(household_id)) with check (znt.can_use(household_id));

revoke execute on function znt.new_key(), znt.household(), znt.can_use(uuid), znt.join_with_link(text),
  znt.my_link(), znt.reset_link() from public, anon;
grant execute on function znt.household(), znt.can_use(uuid), znt.join_with_link(text),
  znt.my_link(), znt.reset_link() to authenticated;
grant execute on all functions in schema znt to service_role;

-- Anonymous sessions exist only for ZNT devices: they get no profile (it
-- needs an email) and can never become household members, so creating or
-- joining a household as one fails.
create or replace function core.on_auth_user_created()
 returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if new.is_anonymous or new.email is null then return new; end if;
  insert into core.profiles (id, email, display_name)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name'))
  on conflict (id) do nothing;
  return new;
end $function$;

create function core.no_anonymous_members() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from auth.users where id = new.user_id and is_anonymous) then
    raise exception 'sign in to Hive to join a household' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function core.no_anonymous_members() from public, anon, authenticated;
create trigger no_anonymous_members before insert or update of user_id on core.household_members
  for each row execute function core.no_anonymous_members();
