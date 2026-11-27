set check_function_bodies = off;
-- Realtime filters on drinks.tree.root, but generated columns aren't sent to
-- Realtime, so root becomes an ordinary column kept by a trigger.
alter table drinks.tree alter column root drop expression;
create function drinks.set_root() returns trigger language plpgsql set search_path = '' as $$
begin new.root := new.path[1] || '/' || new.path[2]; return new; end $$;
create trigger tree_root before insert or update of path on drinks.tree for each row execute function drinks.set_root();
alter table drinks.tree alter column root set not null;
revoke execute on function drinks.set_root() from public, anon, authenticated;
