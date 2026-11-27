-- What a hosted Supabase project has from the day it is made, and the local
-- stack does not. Hive's first migrations expect it to be there.
create or replace function public.rls_auto_enable() returns void
language sql security definer as $$ select $$;
