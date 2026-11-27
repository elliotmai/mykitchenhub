set check_function_bodies = off;
-- Anonymous sessions only ever get into ZNT.
--
-- ZNT's device links (20261125003000_znt_link.sql) turned on anonymous
-- sign-ins for the whole project. Every app's rows are keyed to real accounts
-- or households, so an anonymous session can't read anyone's data, but the
-- apps' own "write my rows" policies would still let it create junk (an empty
-- den, a trip, a log). A restrictive policy on every table outside ZNT closes
-- that: whatever else a policy allows, an anonymous session gets nothing.
-- Pool Heater's open viewing uses the `anon` role (no session), not this.

do $$
declare t record;
begin
  for t in
    select n.nspname as s, c.relname as r
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and c.relrowsecurity
      and n.nspname in ('core', 'den', 'drinks', 'journal', 'kitchen', 'letseat', 'pool', 'sidequest', 'stimul', 'wander')
  loop
    execute format('drop policy if exists "no anonymous sessions" on %I.%I', t.s, t.r);
    execute format($p$create policy "no anonymous sessions" on %I.%I as restrictive for all to authenticated
      using (coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false)
      with check (coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false)$p$, t.s, t.r);
  end loop;
end $$;

-- The same for files (KitchenHub's and Our Den's photos).
drop policy if exists "no anonymous sessions" on storage.objects;
create policy "no anonymous sessions" on storage.objects as restrictive for all to authenticated
  using (coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false)
  with check (coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false);

-- core.bringover_apps: a plain function name instead of regprocedure, which
-- would block Postgres upgrades (pg_upgrade). core.adopt casts it when it runs.
alter table core.bringover_apps alter column handler type text using handler::text;
