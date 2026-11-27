set check_function_bodies = off;
-- Compare read versions as timestamps (the page sends them as ISO text).
create or replace function sidequest.commit(reads jsonb, writes jsonb) returns void
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
