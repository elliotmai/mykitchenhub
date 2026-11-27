set check_function_bodies = off;
-- Let's Eat → KitchenHub: a meal assigned to a day in Let's Eat shows on that
-- day in KitchenHub's meal plan, and stays in step.
--
-- Let's Eat keeps a planned day as letseat.docs 'events/<event>/days/<day>'
-- with { date: 'YYYY-MM-DD', name, recipes: [<Let's Eat recipe id>…] }.
-- KitchenHub's meal plan is kitchen.docs 'mealPlanEntries/<id>' with
-- { date, mealType, recipeName, recipeId, servings, status, source, … }.
--
-- Each (day, recipe) pair is one KitchenHub entry at a fixed path,
-- 'mealPlanEntries/le-<day>-<recipe>', so it can never be added twice:
--   day saved      → its entries are made or updated (a moved day moves them)
--   recipe taken off the day, day deleted or undated → its entries go
-- Entries a cook made in KitchenHub have other paths and are never touched,
-- and what a cook changed on a linked entry (cooked, skipped, servings, notes)
-- is kept when the day changes. Entries already cooked or skipped stay as
-- history when the day goes.
--
-- The entry links to KitchenHub's copy of the recipe (recipes with that
-- legacyId, which the earlier legacy sync made); a recipe KitchenHub doesn't
-- have yet is copied in, the way that sync copies one ('recipes/le-<id>').

create or replace function kitchen.lets_eat_recipe(hid uuid, le_id text) returns text
language plpgsql security definer set search_path = '' as $$
declare found text; le jsonb;
begin
  select substr(path, 9) into found from kitchen.docs
    where household_id = hid and path ~ '^recipes/[^/]+$' and data ->> 'legacyId' = le_id
    order by path limit 1;
  if found is not null then return found; end if;

  select data into le from letseat.docs where household_id = hid and path = 'recipes/' || le_id;
  if le is null then return null; end if;

  insert into kitchen.docs (household_id, path, data) values (hid, 'recipes/le-' || le_id, jsonb_build_object(
    'name', coalesce(nullif(btrim(le ->> 'name'), ''), 'Untitled Recipe'),
    'ingredients', coalesce((
      select jsonb_agg(jsonb_build_object('name', btrim(i), 'quantity', 1, 'unit', '',
                                          'normalized', lower(regexp_replace(btrim(i), '\s+', ' ', 'g'))))
      from jsonb_array_elements_text(case when jsonb_typeof(le -> 'ingredients') = 'array' then le -> 'ingredients' else '[]' end) i
      where btrim(i) <> ''), '[]'::jsonb),
    'instructions', '[]'::jsonb,
    'source', 'legacy',
    'legacyId', le_id,
    'createdAt', jsonb_build_object('$ts', (extract(epoch from now()) * 1000)::bigint),
    'tags', (select coalesce(jsonb_agg(distinct t), '[]'::jsonb) from (
               select lower(btrim(x)) t from jsonb_array_elements_text(
                 case when jsonb_typeof(le -> 'tags') = 'array' then le -> 'tags' else '[]' end) x
               where btrim(x) <> '' union select 'legacy') s),
    'servings', 4, 'difficulty', 'medium', 'timesCooked', 0,
    'prepTime', null, 'cookTime', null, 'imageUrl', null, 'sourceId', null))
  on conflict (household_id, path) do nothing;
  return 'le-' || le_id;
end $$;

/** Bring one Let's Eat day's entries in KitchenHub in line with it (null data: the day is gone). */
create or replace function kitchen.sync_lets_eat_day(hid uuid, day_path text, day jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  day_id text := split_part(day_path, '/', 4);
  on_date text := case when day ->> 'date' ~ '^\d{4}-\d{2}-\d{2}$' then day ->> 'date' end;
  wanted text[] := '{}';
  rid text; kh_recipe text; entry text; old jsonb; le_name text;
begin
  if on_date is not null and jsonb_typeof(day -> 'recipes') = 'array' then
    for rid in select distinct r from jsonb_array_elements_text(day -> 'recipes') r where r ~ '^[A-Za-z0-9_-]{1,100}$' loop
      entry := 'mealPlanEntries/le-' || day_id || '-' || rid;
      wanted := wanted || entry;
      kh_recipe := kitchen.lets_eat_recipe(hid, rid);
      select data ->> 'name' into le_name from letseat.docs where household_id = hid and path = 'recipes/' || rid;
      select data into old from kitchen.docs where household_id = hid and path = entry;
      insert into kitchen.docs (household_id, path, data) values (hid, entry,
        coalesce(old, jsonb_build_object(
          'mealType', 'dinner', 'servings', 4, 'status', 'planned', 'notes', '', 'cookedAt', null,
          'planId', null, 'batchGroup', null, 'usesIngredients', '[]'::jsonb,
          'createdAt', jsonb_build_object('$ts', (extract(epoch from now()) * 1000)::bigint)))
        || jsonb_build_object(
          'date', on_date,
          'source', 'lets-eat',
          'recipeId', kh_recipe,
          'recipeName', coalesce(nullif(btrim(le_name), ''),
                                 (select data ->> 'name' from kitchen.docs where household_id = hid and path = 'recipes/' || kh_recipe),
                                 'A Let''s Eat recipe'),
          'letsEat', jsonb_build_object('day', day_path, 'recipe', rid, 'dayName', day ->> 'name')))
      on conflict (household_id, path) do update set data = excluded.data
        where kitchen.docs.data is distinct from excluded.data;
    end loop;
  end if;

  delete from kitchen.docs
    where household_id = hid
      and path like 'mealPlanEntries/le-' || day_id || '-%'
      and data -> 'letsEat' ->> 'day' = day_path
      and not (path = any (wanted))
      and coalesce(data ->> 'status', 'planned') = 'planned';
end $$;

create or replace function kitchen.on_lets_eat_doc() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.path ~ '^events/[^/]+/days/[^/]+$'
     and (tg_op = 'DELETE' or new.path is distinct from old.path or new.household_id is distinct from old.household_id) then
    perform kitchen.sync_lets_eat_day(old.household_id, old.path, null);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.path ~ '^events/[^/]+/days/[^/]+$' then
    perform kitchen.sync_lets_eat_day(new.household_id, new.path, new.data);
  end if;
  return null;
end $$;

drop trigger if exists lets_eat_to_kitchen on letseat.docs;
create trigger lets_eat_to_kitchen after insert or update or delete on letseat.docs
  for each row execute function kitchen.on_lets_eat_doc();

revoke execute on function kitchen.lets_eat_recipe(uuid, text), kitchen.sync_lets_eat_day(uuid, text, jsonb),
  kitchen.on_lets_eat_doc() from public, anon, authenticated;
grant execute on function kitchen.lets_eat_recipe(uuid, text), kitchen.sync_lets_eat_day(uuid, text, jsonb)
  to service_role;

-- Once, for the days already planned.
select kitchen.sync_lets_eat_day(household_id, path, data)
from letseat.docs where path ~ '^events/[^/]+/days/[^/]+$';
