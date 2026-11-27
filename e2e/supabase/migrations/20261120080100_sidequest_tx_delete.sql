set check_function_bodies = off;
-- SideQuest: hosts can delete a game (and its players and events), as the
-- old rules now allow; and transactions — read some documents, then write,
-- only if nobody changed what was read in between (sidequest.commit).

create or replace function sidequest.can_write(p text, old jsonb, new jsonb) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare me text := sidequest.me(); s text[] := string_to_array(p, '/');
  host text := (select data ->> 'hostUid' from sidequest.docs where path = 'sessions/' || s[2]);
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
    return old is not null and new is not null and (old - 'friends') = (new - 'friends')
      and coalesce((select jsonb_agg(f) from jsonb_array_elements(new -> 'friends') f where f #>> '{}' <> me), '[]')
        = coalesce((select jsonb_agg(f) from jsonb_array_elements(old -> 'friends') f where f #>> '{}' <> me), '[]');
  when 'groups' then
    return (old is null and new -> 'members' ? me) or (old is not null and old -> 'members' ? me);
  when 'invites' then
    return (old is null and new ->> 'fromUid' = me) or (new is null and me in (old ->> 'toUid', old ->> 'fromUid'));
  when 'sessions' then
    if cardinality(s) = 2 then
      return (old is null and new ->> 'hostUid' = me) or (old is not null and new is not null)
        or (new is null and old ->> 'hostUid' = me);
    elsif s[3] = 'players' then
      return s[4] = me or (new is null and host = me);
    elsif s[3] = 'events' then
      return (old is null and new ->> 'uid' = me) or (new is null and host = me);
    end if;
    return false;
  else
    return false;
  end case;
end $$;

/**
 * Commit a transaction: `reads` is [{path, version}] as read (version null for
 * "wasn't there"); `writes` is [{path, kind: 'update' | 'set' | 'delete', ops?, data?}].
 * If any read document changed since, nothing is written and it raises PT409 (HTTP 409)
 * (the page reads again and retries). Runs as the caller: the rules decide.
 */
create function sidequest.commit(reads jsonb, writes jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare r jsonb; w jsonb; cur timestamptz;
begin
  for r in select * from jsonb_array_elements(reads) loop
    select updated_at into cur from sidequest.docs where path = r ->> 'path' for update;
    if cur is distinct from (r ->> 'version')::timestamptz then
      raise exception 'changed meanwhile: %', r ->> 'path' using errcode = 'PT409'; -- HTTP 409; not 40001, which the API would retry by itself
    end if;
  end loop;
  for w in select * from jsonb_array_elements(writes) loop
    case w ->> 'kind'
    when 'update' then perform sidequest.update(w ->> 'path', w -> 'ops');
    when 'delete' then delete from sidequest.docs where path = w ->> 'path';
    else insert into sidequest.docs (path, data) values (w ->> 'path', w -> 'data') on conflict (path) do update set data = excluded.data;
    end case;
  end loop;
end $$;
revoke execute on function sidequest.commit(jsonb, jsonb) from public, anon;
grant execute on function sidequest.commit(jsonb, jsonb) to authenticated, service_role;
