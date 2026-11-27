set check_function_bodies = off;
-- Our Den's bringover also brings each person's den profile (name, settings),
-- as the app's own import did (den.merge_profile).

create or replace function core.adopt(p_app text, p_legacy text, who uuid) returns boolean
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
          if d ? 'profile' then perform den.merge_profile(d -> 'profile'); end if;
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
