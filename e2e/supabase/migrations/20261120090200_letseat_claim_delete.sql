set check_function_bodies = off;
-- Supabase's safety check refuses a DELETE with no WHERE clause; say which rows (all).
create or replace function letseat.claim_legacy(lists jsonb default null) returns int
language plpgsql security definer set search_path = '' as $$
declare hid uuid := core.my_household(); n int;
begin
  if hid is null then raise exception 'Join or make a household first.' using errcode = '42501'; end if;
  if letseat.legacy_status() <> 'waiting' then raise exception 'There is nothing for you to bring over.' using errcode = '42501'; end if;
  insert into letseat.legacy_claim (household_id, claimed_by) values (hid, auth.uid());
  insert into letseat.docs (household_id, path, data) select hid, path, data from letseat.legacy on conflict do nothing;
  get diagnostics n = row_count;
  if lists is not null and jsonb_typeof(lists) = 'object' then
    insert into letseat.lists (household_id, tree) values (hid, lists) on conflict (household_id) do nothing;
  end if;
  delete from letseat.legacy where true; -- Supabase refuses a DELETE without WHERE
  return n;
end $$;

