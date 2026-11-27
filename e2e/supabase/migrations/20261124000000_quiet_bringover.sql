set check_function_bodies = off;
-- Bringing old data over without anyone noticing.
--
-- Until now each app's page had to notice an old account, ask the person to
-- open it, read their Firebase data and call the app's import. Mostly that
-- never happened, and when it did, people saw banners and popups.
--
-- Instead, a one-time server export (scripts/bringover/) copies every old
-- account's data here ahead of time, waiting under its old Firebase id:
--
--   core.waiting_accounts  (app, old id) → the email the old app knew, and
--                          whether that app had confirmed it
--   core.waiting_data      (app, old id) → that account's data, in the shape
--                          the app's own import takes
--
-- The moment an old id belongs to someone (core.legacy_ids), their data moves
-- into the app as them, through the app's own import, and the app's imports
-- row is written so no banner asks again. An old id comes to belong to someone:
--
--   - by email, when their Supabase account's email is confirmed and the old
--     app had confirmed the same email (Google accounts always had);
--   - by password, when carry-over proves the old password (it records the
--     old id itself), which is the only way for old accounts whose email was
--     never confirmed: an unconfirmed address proves nothing on its own.
--
-- None of this can fail a sign-in: a step that goes wrong is logged as a
-- warning and its data stays waiting, to be retried with core.adopt_waiting().

create table core.waiting_accounts (
  app            text not null,
  legacy_id      text not null,
  email          text,
  email_verified boolean not null default false,
  created_at     timestamptz not null default now(),
  primary key (app, legacy_id)
);
create index waiting_accounts_email on core.waiting_accounts (lower(email)) where email_verified;

create table core.waiting_data (
  app        text not null,
  legacy_id  text not null,
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  primary key (app, legacy_id)
);

alter table core.waiting_accounts enable row level security;
alter table core.waiting_data     enable row level security;
-- No policies: only the service role (the export) and the functions below touch them.
revoke all on core.waiting_accounts, core.waiting_data from anon, authenticated;
grant all on core.waiting_accounts, core.waiting_data to service_role;

/**
 * Move one old account's waiting data into its app as `who`, using the app's
 * own import, so the app's rules (no forged members, own rows only) still
 * apply. Runs with `who` as auth.uid() for the duration, then restores
 * whoever was calling.
 */
create function core.adopt(p_app text, p_legacy text, who uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  d jsonb;
  was_claims text := current_setting('request.jwt.claims', true);
  was_sub text := current_setting('request.jwt.claim.sub', true);
  was_role text := current_setting('request.jwt.claim.role', true);
  done boolean := false;
begin
  if who is null then return false; end if;
  select payload into d from core.waiting_data where app = p_app and legacy_id = p_legacy;
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', who::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin
    case p_app
      when 'wander' then
        if d is not null then perform wander.import(p_legacy, d); end if;
        perform wander.claim();
      when 'alcohol' then
        if d is not null then perform drinks.import(p_legacy, d); end if;
        perform drinks.claim();
      when 'journal' then
        if d is not null then
          insert into journal.docs (collection, id, owner_id, data)
            select r ->> 'collection', r ->> 'id', who, coalesce(r -> 'data', '{}'::jsonb)
            from jsonb_array_elements(d -> 'docs') r
            on conflict (collection, id) do nothing;
          insert into journal.imports (user_id, legacy_uid, rows)
            values (who, p_legacy, jsonb_array_length(d -> 'docs')) on conflict (user_id) do nothing;
        end if;
      when 'stimultrack' then
        if d is not null then
          insert into stimul.logs (id, user_id, drink, mg, at, volume, unit, base_volume, base_caffeine, custom, legacy_id)
            select coalesce((r ->> 'id')::uuid, gen_random_uuid()), who, r ->> 'drink', (r ->> 'mg')::int, (r ->> 'at')::timestamptz,
                   (r ->> 'volume')::numeric, coalesce(r ->> 'unit', 'ml'), (r ->> 'base_volume')::numeric,
                   (r ->> 'base_caffeine')::numeric, coalesce((r ->> 'custom')::boolean, false), r ->> 'legacy_id'
            from jsonb_array_elements(d -> 'logs') r
            on conflict do nothing;
          insert into stimul.imports (user_id, legacy_uid, rows)
            values (who, p_legacy, jsonb_array_length(d -> 'logs')) on conflict (user_id) do nothing;
        end if;
      when 'ourden' then
        -- The same den waits under both partners' old ids: the first to arrive
        -- brings it over, the second joins it.
        if d is not null then
          if den.couple_exists(d ->> 'cid') then
            perform den.claim_den(d ->> 'cid', p_legacy);
          else
            perform den.import_den(d ->> 'cid', d -> 'couple', d -> 'items', p_legacy);
          end if;
          insert into den.imports (user_id) values (who) on conflict (user_id) do nothing;
        end if;
      when 'sidequest' then
        -- SideQuest's old data is already here under old ids; claiming swaps them.
        perform sidequest.claim();
      else
        -- Apps that haven't moved yet: their data keeps waiting.
        d := null;
    end case;
    if d is not null then delete from core.waiting_data where app = p_app and legacy_id = p_legacy; end if;
    done := true;
  exception when others then
    raise warning '[bringover] % % for %: %', p_app, p_legacy, who, sqlerrm;
  end;
  perform set_config('request.jwt.claims', coalesce(was_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(was_sub, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(was_role, ''), true);
  return done;
end $$;

/** Link old ids to `who` by a confirmed email the old app had confirmed too. */
create function core.link_by_email(who uuid, addr text) returns void
language sql security definer set search_path = '' as $$
  insert into core.legacy_ids (app, legacy_id, user_id)
  select w.app, w.legacy_id, who from core.waiting_accounts w
  where w.email_verified and lower(w.email) = lower(addr)
  on conflict (app, legacy_id) do nothing
$$;

-- An old id now belongs to someone: bring its data over.
create function core.on_legacy_linked() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is not null then perform core.adopt(new.app, new.legacy_id, new.user_id); end if;
  return null;
end $$;
create trigger legacy_linked after insert or update of user_id on core.legacy_ids
  for each row execute function core.on_legacy_linked();

-- Someone's email is confirmed (a new account, a Google sign-in, a confirmation link).
create function core.on_user_confirmed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is not null and coalesce(new.email_confirmed_at, new.confirmed_at) is not null
     and (tg_op = 'INSERT' or coalesce(old.email_confirmed_at, old.confirmed_at) is null or old.email is distinct from new.email) then
    begin
      perform core.link_by_email(new.id, new.email);
    exception when others then
      raise warning '[bringover] linking % failed: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end $$;
create trigger bringover_on_confirm after insert or update of email_confirmed_at, email on auth.users
  for each row execute function core.on_user_confirmed();

-- Old data arrives for someone already here (signed up before the export ran).
create function core.on_waiting_account() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who uuid;
begin
  if new.email_verified and new.email is not null then
    select id into who from auth.users
    where lower(email) = lower(new.email) and coalesce(email_confirmed_at, confirmed_at) is not null limit 1;
    if who is not null then
      insert into core.legacy_ids (app, legacy_id, user_id) values (new.app, new.legacy_id, who)
        on conflict (app, legacy_id) do nothing;
    end if;
  end if;
  return null;
end $$;
create trigger waiting_account_arrived after insert or update on core.waiting_accounts
  for each row execute function core.on_waiting_account();

create function core.on_waiting_data() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who uuid;
begin
  select user_id into who from core.legacy_ids where app = new.app and legacy_id = new.legacy_id;
  if who is not null then perform core.adopt(new.app, new.legacy_id, who); end if;
  return null;
end $$;
create trigger waiting_data_arrived after insert or update of payload on core.waiting_data
  for each row execute function core.on_waiting_data();

/** Retry everything that is linked but still waiting (after a fix, or an app moving). Returns how many moved. */
create function core.adopt_waiting() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select w.app, w.legacy_id, l.user_id from core.waiting_data w
           join core.legacy_ids l using (app, legacy_id) where l.user_id is not null loop
    if core.adopt(r.app, r.legacy_id, r.user_id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

revoke execute on function core.adopt(text, text, uuid), core.link_by_email(uuid, text), core.adopt_waiting(),
  core.on_legacy_linked(), core.on_user_confirmed(), core.on_waiting_account(), core.on_waiting_data()
  from public, anon, authenticated;
grant execute on function core.adopt(text, text, uuid), core.adopt_waiting() to service_role;
