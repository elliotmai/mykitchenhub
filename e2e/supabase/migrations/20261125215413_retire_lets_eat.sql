set check_function_bodies = off;
-- Retire Let's Eat into KitchenHub: Let's Eat's site forwards to KitchenHub
-- (lets-eat `retire-into-kitchenhub`), and this brings the rest of its data
-- across, into each household's kitchen. Additive only: nothing is deleted
-- or overwritten, and Let's Eat's own rows are left untouched, for the record.
--
-- Recipes are already KitchenHub's (20261125130000), and its events were
-- copied in once already (kitchen_event_sharing, 2026-11-25 17:52 UTC, as
-- 'events/le-<event>'). Since then an event copied that way may have been
-- deleted in KitchenHub on purpose, so this does NOT copy events again; it
-- brings only an event added or changed in Let's Eat after that copy, and
-- only if KitchenHub has no copy of it.
--
--   stores           → matched to KitchenHub's own stores by name ("Trader
--                      Joe's" is "Trader Joes", "Total Wine" is "Total
--                      Wine/Specs"); a store is added only when an item on
--                      the list needs it and KitchenHub has nothing like it
--   the shopping list → 'shoppingItems/le-<…>' by item, no amounts, in their
--                      store, ticked ones as bought
-- and stops the Let's Eat → KitchenHub meal sync (its days are events now;
-- the meal plan entries it made stay, as ordinary planned meals).
-- Safe to run twice: everything is keyed and inserted only if missing.

create or replace function kitchen.slug(t text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(left(trim(both '-' from regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', '-', 'g')), 60), ''), 'store')
$$;

/** A store's name reduced to letters and digits, for matching ("Trader Joe's" = "trader joes"). */
create or replace function kitchen.store_key(t text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', '', 'g')
$$;

/** KitchenHub's store for a Let's Eat store name: same name, or one name starting the other. Null if none. */
create or replace function kitchen.lets_eat_store(hid uuid, le_name text) returns text
language sql stable set search_path = '' as $$
  select substr(s.path, 8) from kitchen.docs s
  where s.household_id = hid and s.path ~ '^stores/[^/]+$' and kitchen.store_key(le_name) <> ''
    and (kitchen.store_key(s.data ->> 'name') = kitchen.store_key(le_name)
         or kitchen.store_key(s.data ->> 'name') like kitchen.store_key(le_name) || '%'
         or kitchen.store_key(le_name) like kitchen.store_key(s.data ->> 'name') || '%')
  order by (kitchen.store_key(s.data ->> 'name') = kitchen.store_key(le_name)) desc, s.path
  limit 1
$$;

create or replace function kitchen.retire_lets_eat() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n_events int; n_stores int; n_items int;
  copied_at constant timestamptz := '2026-11-25 17:52:33+00';
begin
  -- Events added or changed in Let's Eat since the first copy, with no copy yet.
  insert into kitchen.docs (household_id, path, data)
  select e.household_id, 'events/le-' || split_part(e.path, '/', 2), jsonb_build_object(
    'name', coalesce(nullif(btrim(e.data ->> 'name'), ''), 'Event'),
    'guests', '', 'notes', coalesce(e.data ->> 'notes', ''),
    'createdAt', coalesce(e.data -> 'createdAt', jsonb_build_object('$ts', (extract(epoch from now()) * 1000)::bigint)),
    'fromLetsEat', e.path,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', split_part(d.path, '/', 4),
        'name', coalesce(nullif(btrim(d.data ->> 'name'), ''), 'Day'),
        'date', case when d.data ->> 'date' ~ '^\d{4}-\d{2}-\d{2}$' then d.data ->> 'date' end,
        'status', case when d.data ->> 'status' in ('Not Started', 'Shopping', 'Cooking', 'Done') then d.data ->> 'status' else 'Not Started' end,
        'menu', coalesce((
          select jsonb_agg(jsonb_build_object(
            'recipeId', kitchen.lets_eat_recipe(d.household_id, r),
            'label', coalesce((select x.data ->> 'name' from letseat.docs x where x.household_id = d.household_id and x.path = 'recipes/' || r), '')))
          from jsonb_array_elements_text(case when jsonb_typeof(d.data -> 'recipes') = 'array' then d.data -> 'recipes' else '[]' end) r), '[]'::jsonb))
        order by d.data ->> 'date' nulls last)
      from letseat.docs d where d.household_id = e.household_id and d.path like e.path || '/days/%'), '[]'::jsonb))
  from letseat.docs e
  where e.path ~ '^events/[^/]+$'
    and (e.updated_at > copied_at or exists (
      select 1 from letseat.docs d where d.household_id = e.household_id and d.path like e.path || '/days/%' and d.updated_at > copied_at))
    and not exists (select 1 from kitchen.docs k where k.household_id = e.household_id and k.path ~ '^events/' and k.data ->> 'fromLetsEat' = e.path)
  on conflict (household_id, path) do nothing;
  get diagnostics n_events = row_count;

  -- Stores the list needs that KitchenHub has nothing like.
  insert into kitchen.docs (household_id, path, data)
  select distinct on (l.household_id, kitchen.slug(st.key)) l.household_id, 'stores/' || kitchen.slug(st.key),
         jsonb_build_object('name', st.key, 'order', (select count(*) from kitchen.docs s where s.household_id = l.household_id and s.path ~ '^stores/[^/]+$'))
  from letseat.lists l
  cross join lateral jsonb_each(coalesce(l.tree -> 'shoppingList', '{}'::jsonb)) st
  where coalesce(l.tree -> 'stores', '{}'::jsonb) ? st.key and st.key <> 'Uncategorized'
    and jsonb_typeof(st.value) = 'object' and st.value <> '{}'::jsonb
    and kitchen.lets_eat_store(l.household_id, st.key) is null
  on conflict (household_id, path) do nothing;
  get diagnostics n_stores = row_count;

  insert into kitchen.docs (household_id, path, data)
  select l.household_id, 'shoppingItems/le-' || left(md5(st.key || '/' || it.key), 20), jsonb_strip_nulls(jsonb_build_object(
    'name', btrim(it.value ->> 'ingredient'),
    'normalized', lower(btrim(it.value ->> 'ingredient')),
    'unit', '', 'notes', '',
    'status', case when (it.value ->> 'checked')::boolean then 'bought' else 'pending' end,
    'source', 'manual',
    'createdAt', jsonb_build_object('$ts', (extract(epoch from now()) * 1000)::bigint),
    'store', case when coalesce(l.tree -> 'stores', '{}'::jsonb) ? st.key and st.key <> 'Uncategorized' then kitchen.lets_eat_store(l.household_id, st.key) end,
    'recipeName', nullif(it.value ->> 'recipe', '')))
    || jsonb_build_object('quantity', null, 'boughtAt', null)
  from letseat.lists l
  cross join lateral jsonb_each(coalesce(l.tree -> 'shoppingList', '{}'::jsonb)) st
  cross join lateral jsonb_each(case when jsonb_typeof(st.value) = 'object' then st.value else '{}'::jsonb end) it
  where jsonb_typeof(it.value) = 'object' and coalesce(btrim(it.value ->> 'ingredient'), '') <> ''
  on conflict (household_id, path) do nothing;
  get diagnostics n_items = row_count;

  return jsonb_build_object('events', n_events, 'stores', n_stores, 'items', n_items);
end $$;

revoke execute on function kitchen.retire_lets_eat(), kitchen.slug(text), kitchen.store_key(text), kitchen.lets_eat_store(uuid, text) from public, anon, authenticated;
grant execute on function kitchen.retire_lets_eat() to service_role;

select kitchen.retire_lets_eat();

-- Let's Eat's days are KitchenHub events now: stop mirroring them onto the
-- meal plan (the entries already there stay, as ordinary planned meals).
drop trigger if exists lets_eat_to_kitchen on letseat.docs;
