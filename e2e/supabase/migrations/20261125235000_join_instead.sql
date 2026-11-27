set check_function_bodies = off;
-- Join a household with its code from anywhere, including when you're
-- already in one: you move to the new household (your own things stay yours).
-- Refused only when you're the sole owner of a household others still share,
-- so nobody is left in a household without an owner.
create or replace function core.join_household(invite text)
returns uuid language plpgsql security definer set search_path to '' as $$
declare inv core.household_invites; h record;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into inv from core.household_invites where code = upper(trim(invite)) for update;
  if not found or (not inv.reusable and inv.used_at is not null) or inv.expires_at < now() then
    raise exception 'that invite code is not valid' using errcode = 'P0002';
  end if;
  for h in select m.household_id from core.household_members m
           where m.user_id = auth.uid() and m.household_id <> inv.household_id loop
    if exists (select 1 from core.household_members where household_id = h.household_id and user_id = auth.uid() and role = 'owner')
       and (select count(*) from core.household_members where household_id = h.household_id and role = 'owner') = 1
       and (select count(*) from core.household_members where household_id = h.household_id) > 1 then
      raise exception 'you own a household others share: make someone else its owner, or remove them, before joining another' using errcode = 'P0001';
    end if;
    delete from core.household_members where household_id = h.household_id and user_id = auth.uid();
  end loop;
  insert into core.household_members (household_id, user_id) values (inv.household_id, auth.uid())
    on conflict do nothing;
  update core.household_invites set used_by = auth.uid(), used_at = now() where code = inv.code;
  return inv.household_id;
end $$;
