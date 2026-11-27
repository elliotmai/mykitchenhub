set check_function_bodies = off;
-- SideQuest: moved from Firebase (project sidequest-42196).
--
-- One row per Firestore document in sidequest.docs, keyed by its full path
-- ('sessions/7F3K9Q/players/<uid>'); `parent` is the collection it's in.
-- Reading: row-level security (sidequest.can_read). Writing: a trigger checks
-- each change against the old rules (sidequest.can_write), and
-- sidequest.update applies field operations (increment, add to a list, …) in
-- one step, as Firestore did, so two players scoring at once both count.

create table sidequest.docs (
  path       text primary key check (path ~ '^[^/]+(/[^/]+/[^/]+)*/[^/]+$' and length(path) < 500),
  parent     text not null,
  id         text not null,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index docs_parent on sidequest.docs (parent);

create function sidequest.me() returns text language sql stable set search_path = '' as $$ select auth.uid()::text $$;

create function sidequest.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select (data ->> 'isAdmin')::boolean from sidequest.docs where path = 'users/' || sidequest.me()), false)
$$;

create function sidequest.can_read(p text, d jsonb) returns boolean language sql stable security definer set search_path = '' as $$
  select sidequest.me() is not null and case split_part(p, '/', 1)
    when 'groups' then d -> 'members' ? sidequest.me()
    when 'invites' then sidequest.me() in (d ->> 'toUid', d ->> 'fromUid')
    else true
  end
$$;

/** The old rules, for one document going from `old` to `new` (null: absent). */
create function sidequest.can_write(p text, old jsonb, new jsonb) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare me text := sidequest.me(); s text[] := string_to_array(p, '/');
begin
  if me is null then return false; end if;
  case s[1]
  when 'packs', 'expansions' then return sidequest.is_admin();
  when 'usernames' then
    return (old is null and new ->> 'uid' = me) or (new is null and old ->> 'uid' = me);
  when 'users' then
    if cardinality(s) <> 2 then return false; end if;
    if s[2] = me then
      return new is null or coalesce(new -> 'isAdmin', 'false') = coalesce(old -> 'isAdmin', 'false') or sidequest.is_admin();
    end if;
    -- someone else may only add or remove themselves in your friends list
    return old is not null and new is not null and (old - 'friends') = (new - 'friends')
      and coalesce((select jsonb_agg(f) from jsonb_array_elements(new -> 'friends') f where f #>> '{}' <> me), '[]')
        = coalesce((select jsonb_agg(f) from jsonb_array_elements(old -> 'friends') f where f #>> '{}' <> me), '[]');
  when 'groups' then
    return (old is null and new -> 'members' ? me) or (old is not null and old -> 'members' ? me);
  when 'invites' then
    return (old is null and new ->> 'fromUid' = me) or (new is null and me in (old ->> 'toUid', old ->> 'fromUid'));
  when 'sessions' then
    if cardinality(s) = 2 then
      return (old is null and new ->> 'hostUid' = me) or (old is not null and new is not null);
    elsif s[3] = 'players' then
      return s[4] = me;
    elsif s[3] = 'events' then
      return old is null and new ->> 'uid' = me;
    end if;
    return false;
  else
    return false;
  end case;
end $$;

create function sidequest.guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'DELETE' then
    new.parent := regexp_replace(new.path, '/[^/]+$', '');
    new.id := regexp_replace(new.path, '^.*/', '');
    new.updated_at := now();
  end if;
  if auth.uid() is null or current_setting('sidequest.trusted', true) = 'on' then
    return coalesce(new, old);
  end if;
  if not sidequest.can_write(coalesce(new.path, old.path), case when tg_op = 'INSERT' then null else old.data end,
      case when tg_op = 'DELETE' then null else new.data end) then
    raise exception 'permission-denied' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger docs_guard before insert or update or delete on sidequest.docs for each row execute function sidequest.guard();

/** {"$ts": ms} for now. */
create function sidequest.now_ts() returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('$ts', (extract(epoch from clock_timestamp()) * 1000)::bigint)
$$;

/**
 * Firestore updateDoc on one document, in one step. `ops`: [{path: [field, …],
 * op: 'set' | 'delete' | 'increment' | 'union' | 'remove' | 'now', value}].
 * Runs as the caller, so the rules still decide.
 */
create function sidequest.update(doc_path text, ops jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare d jsonb; op jsonb; f text[]; cur jsonb; v jsonb;
begin
  select data into d from sidequest.docs where path = doc_path for update;
  if d is null then raise exception 'No document to update: %', doc_path using errcode = 'P0002'; end if;
  for op in select * from jsonb_array_elements(ops) loop
    f := array(select jsonb_array_elements_text(op -> 'path'));
    cur := d #> f;
    v := op -> 'value';
    d := case op ->> 'op'
      when 'delete' then d #- f
      when 'now' then jsonb_set(d, f, sidequest.now_ts(), true)
      when 'increment' then jsonb_set(d, f, to_jsonb(coalesce((cur #>> '{}')::numeric, 0) + (v #>> '{}')::numeric), true)
      when 'union' then jsonb_set(d, f, coalesce(case when jsonb_typeof(cur) = 'array' then cur end, '[]'::jsonb)
        || coalesce((select jsonb_agg(x) from jsonb_array_elements(v) x where not coalesce(case when jsonb_typeof(cur) = 'array' then cur end, '[]'::jsonb) @> jsonb_build_array(x)), '[]'::jsonb), true)
      when 'remove' then jsonb_set(d, f, coalesce((select jsonb_agg(x) from jsonb_array_elements(case when jsonb_typeof(cur) = 'array' then cur else '[]'::jsonb end) x
        where not v @> jsonb_build_array(x)), '[]'::jsonb), true)
      else jsonb_set(d, f, v, true)
    end;
  end loop;
  update sidequest.docs set data = d where path = doc_path;
end $$;

alter table sidequest.docs enable row level security;
create policy "the old read rules" on sidequest.docs for select to authenticated using (sidequest.can_read(path, data));
create policy "write (sidequest.guard checks)" on sidequest.docs for insert to authenticated with check (true);
create policy "change what you can see (guard checks)" on sidequest.docs for update to authenticated using (sidequest.can_read(path, data)) with check (true);
create policy "remove what you can see (guard checks)" on sidequest.docs for delete to authenticated using (sidequest.can_read(path, data));

-- ── Moving from Firebase ────────────────────────────────────────────────
-- Everything an old guest could read was copied over as it was; each person's
-- old Firebase id is swapped for their new one when they claim it (Hive checks
-- the old sign-in and records it in core.legacy_ids).
create function sidequest.claim() returns int
language plpgsql security definer set search_path = '' as $$
declare old_id text; r record; n int := 0; me text := auth.uid()::text;
begin
  if me is null then return 0; end if;
  perform set_config('sidequest.trusted', 'on', true);
  for old_id in select legacy_id from core.legacy_ids where app = 'sidequest' and user_id = auth.uid() loop
    if length(old_id) < 16 then continue; end if;
    for r in select path, data from sidequest.docs where path like '%' || old_id || '%' or data::text like '%"' || old_id || '"%' for update loop
      delete from sidequest.docs where path = r.path;
      insert into sidequest.docs (path, data) values (replace(r.path, old_id, me), replace(r.data::text, '"' || old_id || '"', '"' || me || '"')::jsonb)
        on conflict (path) do update set data = sidequest.docs.data || excluded.data;
      n := n + 1;
    end loop;
  end loop;
  perform set_config('sidequest.trusted', 'off', true);
  return n;
end $$;

revoke all on all tables in schema sidequest from anon, authenticated;
grant select, insert, update, delete on sidequest.docs to authenticated;
grant all on all tables in schema sidequest to service_role;
revoke execute on all functions in schema sidequest from public, anon, authenticated;
grant execute on function sidequest.update(text, jsonb), sidequest.claim(), sidequest.can_read(text, jsonb), sidequest.me(), sidequest.now_ts()
  to authenticated;
grant execute on all functions in schema sidequest to service_role;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table sidequest.docs;
  end if;
end $$;
