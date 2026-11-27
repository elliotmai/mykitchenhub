set check_function_bodies = off;
-- Drink Tracker: moved from Firebase Realtime Database (project alctracker-b6c8a).
--
-- The app reads and writes a JSON tree by path (users/{uid}/drinks/{id},
-- friendships/{uid}/{friend}, parties/{id}/entries/{id}, …). Here that tree is
-- drinks.tree: one row per record, keyed by its path. drinks.depth says how
-- deep a record sits; anything below that is JSON inside the row.
--
-- Reading: row-level security, by drinks.can_read (the old database rules).
-- Writing: only through drinks.write, which applies a batch of Firebase-style
-- set()s in one transaction and checks every changed record against
-- drinks.can_write (the old rules, with two holes closed: you can no longer
-- make yourself someone's friend, or share their drinks list with yourself,
-- without them asking first).

create table drinks.tree (
  path  text[] primary key check (cardinality(path) between 3 and 4),
  root  text generated always as (path[1] || '/' || path[2]) stored,
  value jsonb not null
);
create index tree_root on drinks.tree (root);

/** How many path segments a record has, for a path starting with these. Null: not a place records go. */
create function drinks.depth(p text[]) returns int language sql immutable set search_path = '' as $$
  select case p[1]
    when 'users' then case when p[3] in ('drinks', 'distinctDrinks', 'scannedProducts') then 4 else 3 end
    when 'parties' then case when p[3] in ('members', 'entries') then 4 else 3 end
    when 'friendRequests' then 3 when 'friendships' then 3
    when 'drinkListShareRequests' then 3 when 'drinkListShares' then 3
    when 'userParties' then 3
  end
$$;

create function drinks.me() returns text language sql stable set search_path = '' as $$ select auth.uid()::text $$;

create function drinks.has(p text[]) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from drinks.tree where path = p)
$$;

create function drinks.party_member(pid text, who text) returns boolean language sql stable security definer set search_path = '' as $$
  select who is not null and exists (select 1 from drinks.tree where path = array['parties', pid, 'members', who])
$$;

create function drinks.party_organizer(pid text) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select value ? drinks.me() from drinks.tree where path = array['parties', pid, 'organizers']), false)
$$;

create function drinks.party_active(pid text) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select value #>> '{}' = 'active' from drinks.tree where path = array['parties', pid, 'status']), false)
$$;

/** The old .read rules. */
create function drinks.can_read(p text[]) returns boolean language sql stable security definer set search_path = '' as $$
  select case p[1]
    when 'users' then p[2] = drinks.me()
      or (p[3] = 'aggregateStats' and drinks.has(array['friendships', p[2], drinks.me()]))
      or (p[3] = 'distinctDrinks' and drinks.has(array['drinkListShares', p[2], drinks.me()]))
    when 'friendRequests' then drinks.me() in (p[2], p[3])
    when 'drinkListShareRequests' then drinks.me() in (p[2], p[3])
    when 'drinkListShares' then drinks.me() in (p[2], p[3])
    when 'friendships' then p[2] = drinks.me()
    when 'userParties' then p[2] = drinks.me()
    when 'parties' then drinks.party_member(p[2], drinks.me())
    else false
  end
$$;

/** The old .write rules, for one record going from `old` to `new` (null: absent). */
create function drinks.can_write(p text[], old jsonb, new jsonb) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare me text := drinks.me(); pid text;
begin
  if me is null then return false; end if;
  case p[1]
  when 'users' then
    if p[2] = me then return true; end if;
    if p[3] <> 'drinks' then return false; end if;
    -- a friend logging a drink for you at a party you're both in
    if old is null then
      pid := new ->> 'partyId';
      return pid is not null and drinks.party_active(pid) and drinks.party_member(pid, p[2]) and drinks.party_member(pid, me)
        and drinks.has(array['friendships', p[2], me]);
    elsif new is null then
      return old ? 'partyId' and drinks.party_member(old ->> 'partyId', me);
    else
      return old ? 'partyId' and new ->> 'partyId' = old ->> 'partyId'
        and drinks.party_member(old ->> 'partyId', me) and drinks.party_member(old ->> 'partyId', p[2]);
    end if;
  when 'friendRequests', 'drinkListShareRequests' then
    return me in (p[2], p[3]);
  when 'friendships' then
    -- yours to change; on theirs, you may remove yourself, or add yourself when they asked you
    return p[2] = me or (p[3] = me and (new is null or drinks.has(array['friendRequests', me, p[2]])));
  when 'drinkListShares' then
    -- the owner's to change; the viewer may leave, or accept when the owner offered
    return p[2] = me or (p[3] = me and (new is null or drinks.has(array['drinkListShareRequests', me, p[2]])));
  when 'userParties' then
    return p[2] = me or drinks.party_member(p[3], me);
  when 'parties' then
    pid := p[2];
    case p[3]
    when 'members' then
      return drinks.party_member(pid, me) and (p[4] = me or drinks.has(array['friendships', p[4], me]));
    when 'organizers', 'status', 'name', 'date' then
      return drinks.party_organizer(pid);
    when 'entries' then
      if old is null then
        return new ->> 'addedBy' = me and drinks.party_active(pid) and drinks.party_member(pid, me)
          and drinks.party_member(pid, new ->> 'uid') and (new ->> 'uid' = me or drinks.has(array['friendships', new ->> 'uid', me]));
      elsif new is null then
        return drinks.party_member(pid, me);
      else
        return new ->> 'addedBy' is not distinct from old ->> 'addedBy' and drinks.party_member(pid, me)
          and drinks.party_member(pid, new ->> 'uid') and (new ->> 'uid' = me or drinks.has(array['friendships', new ->> 'uid', me]));
      end if;
    else
      return false;
    end case;
  else
    return false;
  end case;
end $$;

/** v with `sub` set to x (null removes it), creating objects on the way. */
create function drinks.deep_set(v jsonb, sub text[], x jsonb) returns jsonb language plpgsql immutable set search_path = '' as $$
declare cur jsonb := case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end; child jsonb;
begin
  if cardinality(sub) = 0 then return x; end if;
  if cardinality(sub) = 1 then
    return case when x is null then cur - sub[1] else jsonb_set(cur, sub[1:1], x) end;
  end if;
  child := drinks.deep_set(cur -> sub[1], sub[2:], x);
  if child is null or child = '{}'::jsonb then return cur - sub[1]; end if;
  return jsonb_set(cur, sub[1:1], child);
end $$;

/** Records a value at path p splits into: (path, value) pairs. */
create function drinks.flatten(p text[], v jsonb) returns table (path text[], value jsonb)
language plpgsql immutable set search_path = '' as $$
declare d int := drinks.depth(p); k text; x jsonb;
begin
  if d is null then raise exception 'Nothing can be stored at %', array_to_string(p, '/') using errcode = '42501'; end if;
  if v is null or v = 'null'::jsonb then return; end if;
  if cardinality(p) >= d then path := p; value := v; return next; return; end if;
  if jsonb_typeof(v) <> 'object' then raise exception 'Expected an object at %', array_to_string(p, '/') using errcode = '22023'; end if;
  for k, x in select * from jsonb_each(v) loop
    return query select * from drinks.flatten(p || k, x);
  end loop;
end $$;

/** Change one record, if the rules allow. */
create function drinks.put(p text[], new jsonb, trusted boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare old jsonb;
begin
  if new = 'null'::jsonb or new = '{}'::jsonb then new := null; end if;
  select value into old from drinks.tree where path = p for update;
  if old is not distinct from new then return; end if;
  if not trusted and not drinks.can_write(p, old, new) then
    raise exception 'permission_denied: %', array_to_string(p, '/') using errcode = '42501';
  end if;
  if new is null then delete from drinks.tree where path = p;
  else insert into drinks.tree (path, value) values (p, new) on conflict (path) do update set value = excluded.value;
  end if;
end $$;

/**
 * Firebase set(ref(path), value) for each {path: [...], value} in `ops`, in
 * order, all or nothing. A null value removes. (update() is several sets.)
 */
create function drinks.write(ops jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare op jsonb; p text[]; v jsonb; d int; r record; me text := drinks.me(); creating boolean;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  for op in select * from jsonb_array_elements(ops) loop
    p := array(select jsonb_array_elements_text(op -> 'path'));
    v := op -> 'value';
    if v = 'null'::jsonb then v := null; end if;
    d := drinks.depth(p);
    if d is null or cardinality(p) < 2 or exists (select 1 from unnest(p) s where s = '' or s ~ '[/.#$\[\]]') then
      raise exception 'Nothing can be stored at %', array_to_string(p, '/') using errcode = '42501';
    end if;
    if cardinality(p) >= d then
      select value into v from (select drinks.deep_set((select value from drinks.tree where path = p[1:d]), p[d + 1:], v) as value) s;
      perform drinks.put(p[1:d], v, false);
    else
      -- A new party, all at once: only by its creator, who must be its organizer and a member.
      creating := p[1] = 'parties' and cardinality(p) = 2;
      if creating and (exists (select 1 from drinks.tree t where t.root = 'parties/' || p[2])
          or v ->> 'createdBy' is distinct from me or (v -> 'organizers' ->> me) is distinct from 'true' or not (v -> 'members' ? me)) then
        raise exception 'permission_denied: %', array_to_string(p, '/') using errcode = '42501';
      end if;
      for r in select t.path from drinks.tree t where t.root = p[1] || '/' || p[2] and t.path[1:cardinality(p)] = p
          and not exists (select 1 from drinks.flatten(p, v) f where f.path = t.path) loop
        perform drinks.put(r.path, null, false);
      end loop;
      for r in select * from drinks.flatten(p, v) loop
        perform drinks.put(r.path, r.value, creating);
      end loop;
    end if;
  end loop;
end $$;

/** Everything at or under path p that you may see (Firebase get / onValue). */
create function drinks.read(p text[]) returns table (path text[], value jsonb)
language sql stable security invoker set search_path = '' as $$
  select t.path, t.value from drinks.tree t
  where t.root = p[1] || '/' || p[2]
    and (t.path[1:cardinality(p)] = p or t.path = p[1:drinks.depth(p)])
$$;

-- ── Moving from Firebase ────────────────────────────────────────────────
-- Records keep the old Firebase user ids of people who haven't moved yet.
-- When someone moves (Hive records their old id in core.legacy_ids after
-- checking their old sign-in), drinks.claim swaps their old id for the new
-- one everywhere, and drinks.import brings their own records.

create function drinks.my_legacy_ids() returns setof text language sql stable security definer set search_path = '' as $$
  select legacy_id from core.legacy_ids where app = 'alcohol' and user_id = auth.uid()
$$;

create function drinks.rekey(old_id text, new_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; np text[];
begin
  if length(old_id) < 16 or old_id = new_id then return; end if;
  for r in select path, value from drinks.tree where old_id = any(path) or value::text like '%"' || old_id || '"%' for update loop
    np := array_replace(r.path, old_id, new_id);
    delete from drinks.tree where path = r.path;
    insert into drinks.tree (path, value) values (np, replace(r.value::text, '"' || old_id || '"', '"' || new_id || '"')::jsonb)
      on conflict (path) do nothing;
  end loop;
end $$;

/** Swap each of my old ids for my new one, everywhere. */
create function drinks.claim() returns void
language plpgsql security definer set search_path = '' as $$
declare old_id text;
begin
  for old_id in select drinks.my_legacy_ids() loop
    perform drinks.rekey(old_id, auth.uid()::text);
  end loop;
end $$;

/**
 * Bring my records from Firebase: `tree` is what I could read there, as
 * {path: value} with my old id in the paths. Only records that were mine
 * (under my old id) and parties I was in are taken; nothing is overwritten.
 */
create function drinks.import(old_id text, tree jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare me text := drinks.me(); k text; v jsonb; p text[]; n int := 0; mine boolean;
begin
  if me is null or old_id not in (select drinks.my_legacy_ids()) then
    raise exception 'Hive has not confirmed that old account is yours.' using errcode = '42501';
  end if;
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
      when 'parties' then (tree -> ('parties/' || p[2] || '/members/' || old_id)) is not null
      else false end;
    if not mine then continue; end if;
    insert into drinks.tree (path, value) values (p, v) on conflict (path) do nothing;
    if found then n := n + 1; end if;
  end loop;
  perform drinks.claim();
  insert into drinks.imports (user_id, rows) values (auth.uid(), n) on conflict (user_id) do nothing;
  return n;
end $$;

create table drinks.imports (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  rows        int not null default 0,
  imported_at timestamptz not null default now()
);

alter table drinks.tree    enable row level security;
alter table drinks.imports enable row level security;
create policy "the old read rules" on drinks.tree for select to authenticated using (drinks.can_read(path));
create policy "my import" on drinks.imports for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on all tables in schema drinks from anon, authenticated;
grant select on drinks.tree to authenticated;
grant select, insert on drinks.imports to authenticated;
grant all on all tables in schema drinks to service_role;

revoke execute on all functions in schema drinks from public, anon, authenticated;
grant execute on function drinks.write(jsonb), drinks.read(text[]), drinks.import(text, jsonb), drinks.claim(),
  drinks.can_read(text[]), drinks.depth(text[]), drinks.me(), drinks.has(text[]), drinks.party_member(text, text) to authenticated;
grant execute on all functions in schema drinks to service_role;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table drinks.tree;
  end if;
end $$;
-- Realtime sends whole old rows on delete, so a subscriber's filter on root still matches.
alter table drinks.tree replica identity full;
