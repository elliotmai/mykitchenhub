set check_function_bodies = off;
-- Realtime looks rows up by primary key and can't do that with an array key,
-- so the key becomes the path as text ('users/abc/drinks/xyz'). Path stays
-- unique; every function still finds records by path.
alter table drinks.tree add column key text;
update drinks.tree set key = array_to_string(path, '/');
alter table drinks.tree drop constraint tree_pkey;
alter table drinks.tree add constraint tree_path_key unique (path);
alter table drinks.tree alter column key set not null;
alter table drinks.tree add primary key (key);
create or replace function drinks.set_root() returns trigger language plpgsql set search_path = '' as $$
begin
  new.root := new.path[1] || '/' || new.path[2];
  new.key := array_to_string(new.path, '/');
  return new;
end $$;
alter table drinks.tree replica identity default;

-- Deletions: a full old row lets Realtime match a subscriber's root filter
-- (it still sends only the key, so nothing else of a removed row leaks).
alter table drinks.tree replica identity full;
