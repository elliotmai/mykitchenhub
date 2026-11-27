set check_function_bodies = off;
-- People can change their own display name from Hive, and nothing else on
-- their profile: rows are made by triggers (core.handle_new_user and the
-- bringover), so signed-in clients never need to insert, delete, or rewrite
-- the email housemates see.
revoke insert, update, delete on core.profiles from authenticated, anon;
grant update (display_name) on core.profiles to authenticated;

alter table core.profiles drop constraint if exists profiles_display_name_len;
alter table core.profiles add constraint profiles_display_name_len
  check (display_name is null or char_length(btrim(display_name)) between 1 and 60);
