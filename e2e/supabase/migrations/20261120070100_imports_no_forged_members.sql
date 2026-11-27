set check_function_bodies = off;
-- Imports only bring trips and parties that aren't here yet, so a forged
-- "I was a member" record can't get anyone into a trip or party that exists.
-- Re-keyed records keep their old details when the new id already has one.
-- Imported profiles are old Firebase ids only.

create or replace function wander.rekey(old_id text, new_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if length(old_id) < 16 or old_id = new_id then return; end if;
  perform set_config('wander.trusted', 'on', true);
  for r in select collection, id, data from wander.docs where id = old_id or data::text like '%"' || old_id || '"%' for update loop
    delete from wander.docs where collection = r.collection and id = r.id;
    -- If the new id already has this record (say, a fresh profile), the old one's details win.
    insert into wander.docs (collection, id, data)
      values (r.collection, replace(r.id, old_id, new_id), replace(r.data::text, '"' || old_id || '"', '"' || new_id || '"')::jsonb)
      on conflict (collection, id) do update set data = wander.docs.data || excluded.data;
  end loop;
  perform set_config('wander.trusted', 'off', true);
end $$;

create or replace function wander.import(old_id text, rows jsonb) returns int
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
  -- Only trips that aren't here yet, or that I'm already on (my old id may
  -- have come over with someone else's import): never into anyone else's.
  perform wander.claim();
  trips := array(select t from unnest(trips) t where wander.is_traveller(t) or not exists (select 1 from wander.docs where trip_id = t));
  perform set_config('wander.trusted', 'on', true);
  for r in select * from jsonb_array_elements(rows) loop
    col := r ->> 'collection'; rid := r ->> 'id'; d := r -> 'data';
    ok := case col
      when 'profiles' then rid !~ '^[0-9a-f]{8}-[0-9a-f]{4}-' -- old Firebase ids only, never a new account's
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


create or replace function drinks.import(old_id text, tree jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare me text := drinks.me(); k text; v jsonb; p text[]; n int := 0; mine boolean; parties text[];
begin
  if me is null or old_id not in (select drinks.my_legacy_ids()) then
    raise exception 'Hive has not confirmed that old account is yours.' using errcode = '42501';
  end if;
  -- Parties: only ones that aren't here yet, or that I'm already in.
  perform drinks.claim();
  parties := array(select distinct split_part(key, '/', 2) from jsonb_object_keys(tree) key
    where key like 'parties/%/members/' || old_id);
  parties := array(select pid from unnest(parties) pid
    where drinks.party_member(pid, me) or not exists (select 1 from drinks.tree t where t.root = 'parties/' || pid));
  for k, v in select * from jsonb_each(tree) loop
    p := string_to_array(k, '/');
    if drinks.depth(p) is distinct from cardinality(p) then continue; end if;
    mine := case p[1]
      when 'users' then p[2] = old_id
      when 'friendships' then p[2] = old_id
      when 'userParties' then p[2] = old_id
      when 'friendRequests' then p[2] = old_id
      when 'drinkListShareRequests' then old_id in (p[2], p[3])
      when 'drinkListShares' then old_id in (p[2], p[3])
      when 'parties' then p[2] = any(parties)
      else false end;
    if not mine then continue; end if;
    insert into drinks.tree (path, value) values (p, v) on conflict (path) do nothing;
    if found then n := n + 1; end if;
  end loop;
  perform drinks.claim();
  insert into drinks.imports (user_id, rows) values (auth.uid(), n) on conflict (user_id) do nothing;
  return n;
end $$;

