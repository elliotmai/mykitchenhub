set check_function_bodies = off;
-- Exposing schemas in Supabase's Data API settings grants every function in
-- them to anon and authenticated again. Put back only what's meant to be
-- callable. Safe to re-run after any change to the exposed schemas.
revoke execute on all functions in schema core, stimul, znt from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

grant execute on function core.is_member(uuid), core.is_owner(uuid), core.my_household(),
  core.shares_household(uuid) to anon, authenticated;
grant execute on function core.create_household(text), core.create_invite(uuid),
  core.join_household(text) to authenticated;
grant execute on function znt.calendar_sessions(text) to anon, authenticated;

-- Tables: rows are guarded by row-level security either way, but signed-out
-- visitors get no rights at all where nothing is public.
revoke all on all tables in schema core, znt from anon;
revoke all on stimul.logs, stimul.imports from anon;
