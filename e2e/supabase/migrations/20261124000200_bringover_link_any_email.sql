set check_function_bodies = off;
-- Link old accounts by email whether or not the old app confirmed it.
--
-- The Supabase side is always a confirmed address, so the data only ever goes
-- to whoever controls that inbox. The worst case is an old account someone
-- made with another person's address: that person receives the squatter's old
-- data. It never signs anyone in (carry-over still keeps passwords to
-- confirmed old emails), and most old accounts (all of Wander's and Our
-- Den's) were never confirmed, so without this they'd wait for a retyped
-- password instead of arriving on their own.

create or replace function core.link_by_email(who uuid, addr text) returns void
language sql security definer set search_path = '' as $$
  insert into core.legacy_ids (app, legacy_id, user_id)
  select w.app, w.legacy_id, who from core.waiting_accounts w
  where w.email is not null and lower(w.email) = lower(addr)
  on conflict (app, legacy_id) do nothing
$$;

create or replace function core.on_waiting_account() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who uuid;
begin
  if new.email is not null then
    select id into who from auth.users
    where lower(email) = lower(new.email) and coalesce(email_confirmed_at, confirmed_at) is not null limit 1;
    if who is not null then
      insert into core.legacy_ids (app, legacy_id, user_id) values (new.app, new.legacy_id, who)
        on conflict (app, legacy_id) do nothing;
    end if;
  end if;
  return null;
end $$;

drop index if exists core.waiting_accounts_email;
create index waiting_accounts_email on core.waiting_accounts (lower(email));
