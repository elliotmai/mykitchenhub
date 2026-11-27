set check_function_bodies = off;
-- KitchenHub cooking timers, shared by the household: the fridge board (Hive),
-- KitchenHub on every phone and laptop see the same timers and ring for them.
--
-- A timer is stored by when it ends, never as a running count, so it survives
-- reloads, closed tabs, switched apps and other devices: each screen works out
-- what is left from its own clock. Stopping a ringing timer (or cancelling a
-- running one) deletes the row, which silences it everywhere.
--
--   key   what started it, so a recipe step's button finds its own timer
--         ('recipe:<recipe id>:<step>'); null for a timer typed in by hand

create table kitchen.timers (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null default core.my_household() references core.households (id) on delete cascade,
  key          text check (key is null or length(key) between 1 and 200),
  label        text not null check (length(label) between 1 and 120),
  duration_s   integer not null check (duration_s between 1 and 86400),
  ends_at      timestamptz not null,
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index timers_household on kitchen.timers (household_id, ends_at);

alter table kitchen.timers enable row level security;
create policy "the household's timers" on kitchen.timers for all to authenticated
  using (core.is_member(household_id)) with check (core.is_member(household_id));

-- As everywhere outside ZNT (20261125020000): anonymous sessions get nothing.
create policy "no anonymous sessions" on kitchen.timers as restrictive for all to authenticated
  using (coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false)
  with check (coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false);

grant select, insert, update, delete on kitchen.timers to authenticated;
grant all on kitchen.timers to service_role;

-- Realtime: a timer started or stopped on one screen shows on the others.
alter table kitchen.timers replica identity full;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table kitchen.timers;
  end if;
end $$;
