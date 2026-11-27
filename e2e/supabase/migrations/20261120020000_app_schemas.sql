set check_function_bodies = off;
-- Empty schemas for every app that moves in (docs/supabase-migration-plan.md),
-- made up front so they can all be exposed to the API in one step. Each app's
-- own migration fills its schema in. GalaxyFarm's schema is not exposed: it
-- talks to Postgres directly.
do $$
declare s text;
begin
  foreach s in array array['kitchen', 'letseat', 'wander', 'learnleaf', 'znt', 'drinks', 'journal', 'den', 'sidequest', 'aero', 'pool', 'tickets'] loop
    execute format('create schema if not exists %I', s);
    execute format('grant usage on schema %I to anon, authenticated, service_role', s);
  end loop;
end $$;
