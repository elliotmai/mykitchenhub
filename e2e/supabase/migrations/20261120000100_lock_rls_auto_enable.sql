set check_function_bodies = off;
-- Supabase's new-project helper that turns on row-level security for new
-- tables. It runs on its own (as an event trigger); nobody needs to call it
-- through the API.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
