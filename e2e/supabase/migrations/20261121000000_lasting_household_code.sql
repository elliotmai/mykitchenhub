set check_function_bodies = off;
-- One lasting invite code per household: it doesn't expire and works for
-- anyone who has it, until an owner replaces it (core.reset_invite), which
-- stops the old one.

alter table core.household_invites add column reusable boolean not null default false;
create unique index household_invites_one_lasting on core.household_invites (household_id) where reusable;

/** The household's lasting code: the one it has, or a new one. Owners only. */
create or replace function core.create_invite(hid uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if not core.is_owner(hid) then raise exception 'only an owner can invite' using errcode = '42501'; end if;
  select code into c from core.household_invites where household_id = hid and reusable;
  if c is not null then return c; end if;
  c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into core.household_invites (code, household_id, created_by, expires_at, reusable)
    values (c, hid, auth.uid(), 'infinity', true);
  return c;
end $$;

/** Replace the household's lasting code; the old one stops working. Owners only. */
create function core.reset_invite(hid uuid) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not core.is_owner(hid) then raise exception 'only an owner can invite' using errcode = '42501'; end if;
  delete from core.household_invites where household_id = hid and reusable;
  return core.create_invite(hid);
end $$;

create or replace function core.join_household(invite text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare inv core.household_invites;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into inv from core.household_invites where code = upper(trim(invite)) for update;
  if not found or (not inv.reusable and inv.used_at is not null) or inv.expires_at < now() then
    raise exception 'that invite code is not valid' using errcode = 'P0002';
  end if;
  insert into core.household_members (household_id, user_id) values (inv.household_id, auth.uid())
    on conflict do nothing;
  update core.household_invites set used_by = auth.uid(), used_at = now() where code = inv.code;
  return inv.household_id;
end $$;

revoke execute on function core.reset_invite(uuid) from public, anon;
grant execute on function core.reset_invite(uuid) to authenticated;
