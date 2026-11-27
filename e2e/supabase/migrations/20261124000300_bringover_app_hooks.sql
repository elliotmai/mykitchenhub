set check_function_bodies = off;
-- Apps can plug their own import into the quiet bringover without editing
-- core.adopt: register a function <schema>.adopt_legacy(old_id text, payload jsonb)
-- here. It runs as the person (auth.uid() is them) once their old id is
-- linked, exactly like the built-in apps; raise to leave the data waiting.

create table core.bringover_apps (
  app     text primary key,
  handler regprocedure not null
);
alter table core.bringover_apps enable row level security;
revoke all on core.bringover_apps from anon, authenticated;
grant all on core.bringover_apps to service_role;

create or replace function core.adopt(p_app text, p_legacy text, who uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  d jsonb;
  was_claims text := current_setting('request.jwt.claims', true);
  was_sub text := current_setting('request.jwt.claim.sub', true);
  was_role text := current_setting('request.jwt.claim.role', true);
  done boolean := false;
  h regprocedure;
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
          if d ? 'profile' then perform den.merge_profile(d -> 'profile'); end if;
          insert into den.imports (user_id) values (who) on conflict (user_id) do nothing;
        end if;
      when 'sidequest' then
        -- SideQuest's old data is already here under old ids; claiming swaps them.
        perform sidequest.claim();
      else
        -- Apps that plug in their own import (core.bringover_apps), run as
        -- the person like the ones above; any other app's data keeps waiting.
        select handler into h from core.bringover_apps where app = p_app;
        if h is not null and d is not null then
          execute format('select %s($1, $2)', h::regproc) using p_legacy, d;
        else
          d := null;
        end if;
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
