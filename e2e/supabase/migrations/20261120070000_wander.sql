set check_function_bodies = off;
-- Wander: moved from Firebase (project wander-f10b1).
--
-- One row per Firestore document in wander.docs (fields kept as JSON, dates
-- as {"$ts": ms}). The old rules let any signed-in person read and change any
-- trip ("enforced in the UI"); here a trip's records are for the people on it:
-- its travellers read and change them, its observers read them. The finer
-- rules the old database did have (only a poll's creator edits it, you can
-- only vote as yourself, …) are kept, in wander.can_write.

create table wander.docs (
  collection text not null check (collection ~ '^[a-z_]{1,40}$'),
  id         text not null check (length(id) between 1 and 200),
  data       jsonb not null default '{}'::jsonb,
  trip_id    text,          -- which trip this belongs to (kept by a trigger)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
create index docs_trip on wander.docs (trip_id, collection);
create index docs_members on wander.docs ((data ->> 'trip_id'), (data ->> 'user_id')) where collection in ('trip_members', 'trip_observers');
create index docs_user on wander.docs (collection, (data ->> 'user_id'));
create index docs_email on wander.docs ((lower(data ->> 'email'))) where collection = 'profiles';

create function wander.me() returns text language sql stable set search_path = '' as $$ select auth.uid()::text $$;

/** The trip a record belongs to. */
create function wander.trip_of(col text, rid text, d jsonb) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when col = 'trips' then rid
    when col = 'poll_options' then coalesce(d ->> 'trip_id', (select p.data ->> 'trip_id' from wander.docs p where p.collection = 'polls' and p.id = d ->> 'poll_id'))
    else d ->> 'trip_id'
  end
$$;

create function wander.is_traveller(trip text) returns boolean language sql stable security definer set search_path = '' as $$
  select trip is not null and (
    exists (select 1 from wander.docs where collection = 'trip_members' and data ->> 'trip_id' = trip and data ->> 'user_id' = wander.me())
    or exists (select 1 from wander.docs where collection = 'trips' and id = trip and data ->> 'created_by' = wander.me()))
$$;

create function wander.is_observer(trip text) returns boolean language sql stable security definer set search_path = '' as $$
  select trip is not null and exists (select 1 from wander.docs where collection = 'trip_observers' and data ->> 'trip_id' = trip and data ->> 'user_id' = wander.me())
$$;

create function wander.creator_of(col text, rid text) returns text language sql stable security definer set search_path = '' as $$
  select data ->> 'created_by' from wander.docs where collection = col and id = rid
$$;

/** Someone I share a trip or a friendship with. */
create function wander.knows(other text) returns boolean language sql stable security definer set search_path = '' as $$
  select other = wander.me()
    or exists (select 1 from wander.docs f where f.collection = 'friendships' and f.data -> 'users' ? wander.me() and f.data -> 'users' ? other)
    or exists (
      select 1 from wander.docs a join wander.docs b on a.data ->> 'trip_id' = b.data ->> 'trip_id'
      where a.collection in ('trip_members', 'trip_observers') and b.collection in ('trip_members', 'trip_observers')
        and a.data ->> 'user_id' = wander.me() and b.data ->> 'user_id' = other)
$$;

create function wander.can_read(col text, rid text, d jsonb, trip text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case col
    when 'profiles' then wander.knows(rid)
    when 'friendships' then d -> 'users' ? wander.me()
    when 'calendar_tokens' then d ->> 'created_by' = wander.me()
    when 'app_tokens' then d ->> 'created_by' = wander.me()
    else wander.is_traveller(trip) or wander.is_observer(trip)
  end
$$;

/** The old write rules, on trips you're on. `old`/`new` are null for a create/delete. */
create function wander.can_write(col text, rid text, old jsonb, new jsonb) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare me text := wander.me(); d jsonb := coalesce(new, old); trip text := wander.trip_of(col, rid, coalesce(new, old));
  mine_new boolean := new ->> 'user_id' is not distinct from me;
begin
  if me is null then return false; end if;
  -- a record can't move to another trip
  if old is not null and new is not null and wander.trip_of(col, rid, old) is distinct from trip then return false; end if;
  case col
  when 'profiles' then return rid = me;
  when 'friendships' then
    return (old is null or old -> 'users' ? me) and (new is null or (new -> 'users' ? me and jsonb_array_length(new -> 'users') = 2));
  when 'calendar_tokens', 'app_tokens' then
    return old is null and new ->> 'created_by' = me and (col = 'app_tokens' or wander.is_traveller(new ->> 'trip_id') or wander.is_observer(new ->> 'trip_id'))
        or new is null and old ->> 'created_by' = me;
  when 'trips' then
    return (old is null and new ->> 'created_by' = me) or (old is not null and wander.is_traveller(rid));
  when 'trip_members' then
    if old is null then
      return wander.is_traveller(trip)
        or (mine_new and wander.creator_of('trips', trip) = me);
    end if;
    return wander.is_traveller(trip) and (new is null or new ->> 'user_id' = old ->> 'user_id');
  when 'polls', 'date_polls' then
    if old is null then return wander.is_traveller(trip) and new ->> 'created_by' = me; end if;
    return old ->> 'created_by' = me and (new is null or new ->> 'created_by' = me);
  when 'poll_options' then
    if old is null then return wander.is_traveller(trip); end if;
    return wander.creator_of('polls', d ->> 'poll_id') = me;
  when 'poll_votes' then
    if old is null then return mine_new and (wander.is_traveller(trip) or wander.is_observer(trip)); end if;
    return new is null and (old ->> 'user_id' = me or wander.creator_of('polls', old ->> 'poll_id') = me);
  when 'date_availability' then
    if old is null then return mine_new and (wander.is_traveller(trip) or wander.is_observer(trip)); end if;
    if new is null then return old ->> 'user_id' = me or wander.creator_of('date_polls', old ->> 'poll_id') = me; end if;
    return old ->> 'user_id' = me and mine_new;
  when 'travel_details' then
    if old is null then return mine_new and wander.is_traveller(trip); end if;
    if new is null then return old ->> 'user_id' = me or wander.creator_of('trips', trip) = me; end if;
    return old ->> 'user_id' = me and mine_new;
  when 'trip_observers' then
    if old is null then return new ->> 'added_by' = me and wander.is_traveller(trip); end if;
    if new is null then return old ->> 'added_by' = me or old ->> 'user_id' = me; end if;
    return old ->> 'added_by' = me and (old - 'scope') = (new - 'scope');
  when 'brainstorm_ideas' then
    if new is null then return old ->> 'created_by' = me; end if;
    return wander.is_traveller(trip) or wander.is_observer(trip);
  when 'brainstorm_comments' then
    if new is null then return old ->> 'created_by' = me; end if;
    return old is null and wander.is_traveller(trip) or old is null and wander.is_observer(trip);
  when 'trip_activity' then
    if new is null then return old ->> 'actor_id' = me; end if;
    return wander.is_traveller(trip);
  when 'photo_albums' then
    if old is null then return wander.is_traveller(trip) and new ->> 'added_by' = me; end if;
    return old ->> 'added_by' = me;
  when 'itinerary_events', 'trip_legs', 'trip_accommodations' then
    return wander.is_traveller(trip);
  else
    return false;
  end case;
end $$;

create function wander.guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Wander's own server (service role) and imports skip the rules.
  if auth.uid() is null or current_setting('wander.trusted', true) = 'on' then
    if tg_op <> 'DELETE' then new.trip_id := wander.trip_of(new.collection, new.id, new.data); new.updated_at := now(); return new; end if;
    return old;
  end if;
  if not wander.can_write(coalesce(new.collection, old.collection), coalesce(new.id, old.id),
      case when tg_op = 'INSERT' then null else old.data end, case when tg_op = 'DELETE' then null else new.data end) then
    raise exception 'permission-denied' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.trip_id := wander.trip_of(new.collection, new.id, new.data);
  new.updated_at := now();
  return new;
end $$;
create trigger docs_guard before insert or update or delete on wander.docs for each row execute function wander.guard();

alter table wander.docs enable row level security;
create policy "people on the trip" on wander.docs for select to authenticated using (wander.can_read(collection, id, data, trip_id));
create policy "write (wander.guard checks)" on wander.docs for insert to authenticated with check (true);
create policy "change what you can see (wander.guard checks)" on wander.docs for update to authenticated using (wander.can_read(collection, id, data, trip_id)) with check (true);
create policy "remove what you can see (wander.guard checks)" on wander.docs for delete to authenticated using (wander.can_read(collection, id, data, trip_id));

/** Find a person to add, by their exact email. Only id, name and email. */
create function wander.find_profile(email text) returns table (id text, data jsonb)
language sql stable security definer set search_path = '' as $$
  select d.id, jsonb_build_object('id', d.id, 'email', d.data ->> 'email', 'name', d.data ->> 'name', 'display_name', d.data ->> 'display_name', 'avatar_url', d.data ->> 'avatar_url')
  from wander.docs d where auth.uid() is not null and d.collection = 'profiles' and lower(d.data ->> 'email') = lower(trim(email))
  limit 1
$$;

-- ── Moving from Firebase ────────────────────────────────────────────────
create table wander.imports (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  rows        int not null default 0,
  imported_at timestamptz not null default now()
);
alter table wander.imports enable row level security;
create policy "my import" on wander.imports for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create function wander.my_legacy_ids() returns setof text language sql stable security definer set search_path = '' as $$
  select legacy_id from core.legacy_ids where app = 'wander' and user_id = auth.uid()
$$;

create function wander.rekey(old_id text, new_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if length(old_id) < 16 or old_id = new_id then return; end if;
  perform set_config('wander.trusted', 'on', true);
  for r in select collection, id, data from wander.docs where id = old_id or data::text like '%"' || old_id || '"%' for update loop
    delete from wander.docs where collection = r.collection and id = r.id;
    insert into wander.docs (collection, id, data)
      values (r.collection, replace(r.id, old_id, new_id), replace(r.data::text, '"' || old_id || '"', '"' || new_id || '"')::jsonb)
      on conflict (collection, id) do nothing;
  end loop;
  perform set_config('wander.trusted', 'off', true);
end $$;

create function wander.claim() returns void language plpgsql security definer set search_path = '' as $$
declare old_id text;
begin
  for old_id in select wander.my_legacy_ids() loop perform wander.rekey(old_id, auth.uid()::text); end loop;
end $$;

/**
 * Bring my Wander over: `rows` is [{collection, id, data}] I could read
 * before. Taken: trips I was on and everything in them, my profile and the
 * profiles of people on those trips, my friendships and my tokens. Nothing
 * already here is overwritten.
 */
create function wander.import(old_id text, rows jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare r jsonb; n int := 0; trips text[]; col text; rid text; d jsonb; ok boolean;
begin
  if auth.uid() is null or old_id not in (select wander.my_legacy_ids()) then
    raise exception 'Hive has not confirmed that old account is yours.' using errcode = '42501';
  end if;
  select array_agg(x -> 'data' ->> 'trip_id') into trips from jsonb_array_elements(rows) x
    where x ->> 'collection' = 'trip_members' and x -> 'data' ->> 'user_id' = old_id;
  trips := coalesce(trips, '{}') || coalesce((select array_agg(x ->> 'id') from jsonb_array_elements(rows) x
    where x ->> 'collection' = 'trips' and x -> 'data' ->> 'created_by' = old_id), '{}');
  perform set_config('wander.trusted', 'on', true);
  for r in select * from jsonb_array_elements(rows) loop
    col := r ->> 'collection'; rid := r ->> 'id'; d := r -> 'data';
    ok := case col
      when 'profiles' then true
      when 'friendships' then d -> 'users' ? old_id
      when 'calendar_tokens' then d ->> 'created_by' = old_id
      when 'app_tokens' then d ->> 'created_by' = old_id
      else wander.trip_of(col, rid, d) = any(trips)
    end;
    if not ok then continue; end if;
    insert into wander.docs (collection, id, data) values (col, rid, d) on conflict (collection, id) do nothing;
    if found then n := n + 1; end if;
  end loop;
  perform set_config('wander.trusted', 'off', true);
  perform wander.claim();
  insert into wander.imports (user_id, rows) values (auth.uid(), n) on conflict (user_id) do update set rows = wander.imports.rows + excluded.rows;
  return n;
end $$;

revoke all on all tables in schema wander from anon, authenticated;
grant select, insert, update, delete on wander.docs to authenticated;
grant select, insert on wander.imports to authenticated;
grant all on all tables in schema wander to service_role;
revoke execute on all functions in schema wander from public, anon, authenticated;
grant execute on function wander.find_profile(text), wander.import(text, jsonb), wander.claim(), wander.can_read(text, text, jsonb, text),
  wander.me(), wander.is_traveller(text), wander.is_observer(text), wander.knows(text) to authenticated;
grant execute on all functions in schema wander to service_role;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table wander.docs;
  end if;
end $$;
