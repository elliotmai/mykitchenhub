set check_function_bodies = off;
-- An owner can take someone out of the household, or move them to event
-- partner: they keep planning KitchenHub events with the household (every
-- event, as kitchen.event_partners already allows) but leave everything else
-- the household shares. Nobody can leave a household without an owner.

create or replace function core.remove_member(hid uuid, who uuid)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not core.is_owner(hid) and who <> auth.uid() then
    raise exception 'only an owner can remove someone' using errcode = '42501';
  end if;
  if exists (select 1 from core.household_members where household_id = hid and user_id = who and role = 'owner')
     and (select count(*) from core.household_members where household_id = hid and role = 'owner') = 1 then
    raise exception 'a household needs an owner: make someone else owner first' using errcode = 'P0001';
  end if;
  delete from core.household_members where household_id = hid and user_id = who;
end $$;

create or replace function kitchen.make_event_partner(hid uuid, who uuid, edit boolean default true)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not core.is_owner(hid) then raise exception 'only an owner can do that' using errcode = '42501'; end if;
  if who = auth.uid() then raise exception 'you can''t make yourself a partner' using errcode = 'P0001'; end if;
  perform core.remove_member(hid, who);
  insert into kitchen.event_partners (household_id, user_id, can_edit, added_by)
    values (hid, who, coalesce(edit, true), auth.uid())
    on conflict (household_id, user_id) do update set can_edit = excluded.can_edit;
end $$;

create or replace function kitchen.household_partners(hid uuid)
returns table (user_id uuid, name text, email text, can_edit boolean)
language sql stable security definer set search_path to '' as $$
  select p.user_id, coalesce(pr.display_name, split_part(pr.email, '@', 1)), pr.email, p.can_edit
  from kitchen.event_partners p left join core.profiles pr on pr.id = p.user_id
  where p.household_id = hid and core.is_member(hid)
  order by 2
$$;

create or replace function kitchen.remove_event_partner(hid uuid, who uuid)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not core.is_owner(hid) and who <> auth.uid() then
    raise exception 'only an owner can do that' using errcode = '42501';
  end if;
  delete from kitchen.event_partners where household_id = hid and user_id = who;
end $$;

revoke all on function core.remove_member(uuid, uuid), kitchen.make_event_partner(uuid, uuid, boolean),
  kitchen.household_partners(uuid), kitchen.remove_event_partner(uuid, uuid) from public, anon;
grant execute on function core.remove_member(uuid, uuid), kitchen.make_event_partner(uuid, uuid, boolean),
  kitchen.household_partners(uuid), kitchen.remove_event_partner(uuid, uuid) to authenticated;
