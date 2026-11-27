set check_function_bodies = off;
-- The old data goes to an account made before the move (17:15 UTC on 20 Nov 2026).
create or replace function letseat.legacy_status() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from letseat.legacy_claim) then 'claimed'
    when not exists (select 1 from letseat.legacy) then 'none'
    -- The old data was open to anyone, so it goes to an account that existed
    -- before the move (people signing up from now on can't take it).
    when (select created_at from auth.users where id = auth.uid()) >= timestamptz '2026-11-20 17:15:00+00' then 'not_eligible'
    else 'waiting'
  end
$$;

