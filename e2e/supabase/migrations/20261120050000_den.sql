set check_function_bodies = off;
-- Our Den: a private space for two. Moved from Firebase project ourden.
--
-- A den (couple) has at most two members. Everything shared lives in
-- den.items, one row per Firestore document (fields kept as JSON, dates as
-- {"$ts": ms}). Each person's own profile is den.profiles. Google refresh
-- tokens (for the Calendar and Tasks link) are server-only.
--
-- Moving from Firebase: Firebase user ids appear inside the shared data (the
-- partners map, createdBy, assignee, answers, calendar snapshots). den.claim
-- swaps a person's old id for their new one, in their own den only, and only
-- for the person the den itself names by email.

create table den.couples (
  id         text primary key check (length(id) between 1 and 128),
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table den.members (
  couple_id text not null references den.couples (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (couple_id, user_id)
);
create index members_user on den.members (user_id);

create table den.invites (
  code      text primary key,
  couple_id text not null references den.couples (id) on delete cascade
);

create table den.items (
  couple_id  text not null references den.couples (id) on delete cascade,
  collection text not null check (collection ~ '^[A-Za-z]{1,40}$'),
  id         text not null check (length(id) between 1 and 128),
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (couple_id, collection, id)
);

create table den.profiles (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Server-only: Netlify functions read these with the service role.
create table den.google_tokens (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  updated_at    timestamptz not null default now()
);

create table den.imports (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  imported_at timestamptz not null default now()
);

create function den.touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger couples_touch before update on den.couples for each row execute function den.touch();
create trigger items_touch before update on den.items for each row execute function den.touch();
create trigger profiles_touch before update on den.profiles for each row execute function den.touch();

create function den.is_member(cid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from den.members where couple_id = cid and user_id = auth.uid())
$$;

create function den.my_email() returns text language sql stable security definer set search_path = '' as $$
  select lower(email) from auth.users where id = auth.uid()
$$;

-- Swap one id for another everywhere in a den's shared data. Ids are long
-- random strings (Firebase) or uuids, so a quoted match is exact.
create function den.rekey(cid text, old_id text, new_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if old_id is null or old_id = new_id or length(old_id) < 16 then return; end if;
  update den.couples set data = replace(data::text, '"' || old_id || '"', '"' || new_id || '"')::jsonb where id = cid;
  update den.items set
    data = replace(data::text, '"' || old_id || '"', '"' || new_id || '"')::jsonb,
    id = case when id = old_id then new_id else id end
  where couple_id = cid and (data::text like '%"' || old_id || '"%' or id = old_id);
end $$;

/** A new den with me in it, and an invite code for my partner. */
create function den.create_den(display_name text, zone text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); cid text; c text;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  cid := 'den_' || replace(gen_random_uuid()::text, '-', '');
  insert into den.couples (id, data) values (cid, jsonb_build_object(
    'inviteCode', c, 'nextVisit', null, 'members', jsonb_build_array(me::text),
    'partners', jsonb_build_object(me::text, jsonb_build_object('displayName', display_name, 'accent', 'blue', 'timeZone', zone, 'email', den.my_email()))));
  insert into den.members (couple_id, user_id) values (cid, me);
  insert into den.invites (code, couple_id) values (c, cid);
  insert into den.profiles (user_id, data) values (me, jsonb_build_object('coupleId', cid, 'displayName', display_name))
    on conflict (user_id) do update set data = den.profiles.data || excluded.data;
  return jsonb_build_object('coupleId', cid, 'code', c);
end $$;

/** Join my partner's den with their invite code. A den holds two. */
create function den.join_den(invite text, display_name text, zone text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); cid text;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select couple_id into cid from den.invites where code = upper(trim(invite));
  if cid is null then raise exception 'That invite code did not match a den.' using errcode = 'P0002'; end if;
  if not den.is_member(cid) then
    if (select count(*) from den.members where couple_id = cid) >= 2 then
      raise exception 'That den already has two people.' using errcode = '42501';
    end if;
    insert into den.members (couple_id, user_id) values (cid, me);
  end if;
  update den.couples set data = jsonb_set(
      jsonb_set(data, '{partners}', coalesce(data -> 'partners', '{}'::jsonb) || jsonb_build_object(me::text,
        coalesce(data -> 'partners' -> me::text, '{}'::jsonb) || jsonb_build_object('displayName', display_name, 'accent', 'gray', 'timeZone', zone, 'email', den.my_email()))),
      '{members}', (select coalesce(jsonb_agg(user_id::text), '[]'::jsonb) from den.members where couple_id = cid))
    where id = cid;
  insert into den.profiles (user_id, data) values (me, jsonb_build_object('coupleId', cid, 'displayName', display_name))
    on conflict (user_id) do update set data = den.profiles.data || excluded.data;
  return cid;
end $$;

/** Does this den exist yet? (Only says yes or no.) */
create function den.couple_exists(cid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from den.couples where id = cid)
$$;

/**
 * Bring a den over from Firebase. Only for a den that isn't here yet, so it
 * can't overwrite anyone's: the importer becomes its first member, and their
 * old id becomes their new one.
 */
create function den.import_den(cid text, couple_data jsonb, items jsonb, legacy_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if den.couple_exists(cid) then raise exception 'That den is already here.' using errcode = '23505'; end if;
  insert into den.couples (id, data) values (cid, coalesce(couple_data, '{}'::jsonb));
  insert into den.members (couple_id, user_id) values (cid, me);
  insert into den.items (couple_id, collection, id, data)
    select cid, i ->> 'collection', i ->> 'id', coalesce(i -> 'data', '{}'::jsonb)
    from jsonb_array_elements(coalesce(items, '[]'::jsonb)) i
    on conflict do nothing;
  if couple_data ? 'inviteCode' then
    insert into den.invites (code, couple_id) values (upper(couple_data ->> 'inviteCode'), cid) on conflict do nothing;
  end if;
  perform den.rekey(cid, legacy_id, me::text);
end $$;

/**
 * The second person arriving: join the den that names my email, swapping my
 * old id for my new one. Only while the den has room.
 */
create function den.claim_den(cid text, legacy_id text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); named boolean;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select lower(data -> 'partners' -> legacy_id ->> 'email') = den.my_email() into named from den.couples where id = cid;
  if den.is_member(cid) then
    perform den.rekey(cid, legacy_id, me::text);
    return true;
  end if;
  if not coalesce(named, false) or (select count(*) from den.members where couple_id = cid) >= 2 then
    return false;
  end if;
  insert into den.members (couple_id, user_id) values (cid, me);
  perform den.rekey(cid, legacy_id, me::text);
  return true;
end $$;

alter table den.couples       enable row level security;
alter table den.members       enable row level security;
alter table den.invites       enable row level security;
alter table den.items         enable row level security;
alter table den.profiles      enable row level security;
alter table den.google_tokens enable row level security;
alter table den.imports       enable row level security;

create policy "members read their den" on den.couples for select to authenticated using (den.is_member(id));
create policy "members change their den" on den.couples for update to authenticated using (den.is_member(id)) with check (den.is_member(id));
create policy "see my den's members" on den.members for select to authenticated using (den.is_member(couple_id));
create policy "members see their invite" on den.invites for select to authenticated using (den.is_member(couple_id));
create policy "members share everything in the den" on den.items for all to authenticated
  using (den.is_member(couple_id)) with check (den.is_member(couple_id));
create policy "my profile" on den.profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "my import" on den.imports for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- den.google_tokens: no policies; only the service role.

grant select, update on den.couples to authenticated;
grant select on den.members, den.invites to authenticated;
grant select, insert, update, delete on den.items to authenticated;
grant select, insert, update on den.profiles to authenticated;
grant select, insert on den.imports to authenticated;
grant all on all tables in schema den to service_role;
revoke all on all tables in schema den from anon;

revoke execute on all functions in schema den from public, anon, authenticated;
grant execute on function den.is_member(text), den.create_den(text, text), den.join_den(text, text, text),
  den.couple_exists(text), den.import_den(text, jsonb, jsonb, text), den.claim_den(text, text) to authenticated;
grant execute on all functions in schema den to service_role;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table den.couples, den.items, den.profiles;
  end if;
end $$;

-- Photos: a public bucket (links are long random paths, as Firebase download
-- links were); only a den's members can upload into its folder.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('den', 'den', true) on conflict (id) do nothing;
    create policy "den members upload to their den's folder" on storage.objects for insert to authenticated
      with check (bucket_id = 'den' and den.is_member((storage.foldername(name))[2]));
    create policy "den members remove their den's photos" on storage.objects for delete to authenticated
      using (bucket_id = 'den' and den.is_member((storage.foldername(name))[2]));
  end if;
end $$;
