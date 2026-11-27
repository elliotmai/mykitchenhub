set check_function_bodies = off;
-- KitchenHub becomes the one place recipes live (the Let's Eat merge,
-- previewed on KitchenHub's kitchen-merge branch). Additive only: Let's Eat
-- keeps working as it is until it is retired.
--
-- Every Let's Eat recipe gets a KitchenHub copy (the meal sync already made
-- most of them: the legacy sync's copies carry legacyId, the sync's own are
-- 'recipes/le-<id>'), and from now on a recipe added in Let's Eat is copied
-- in when it is added. A copy the sync made is kept in step when the recipe
-- is renamed or its ingredients change in Let's Eat; the legacy sync's copies
-- are left alone, since cooks may have added steps to them in KitchenHub.

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

  if tg_op in ('INSERT', 'UPDATE') and new.path ~ '^recipes/[^/]+$' then
    perform kitchen.lets_eat_recipe(new.household_id, substr(new.path, 9));
    if tg_op = 'UPDATE' then
      update kitchen.docs k set data = k.data || jsonb_build_object(
          'name', coalesce(nullif(btrim(new.data ->> 'name'), ''), k.data ->> 'name'),
          'ingredients', coalesce((
            select jsonb_agg(jsonb_build_object('name', btrim(i), 'quantity', 1, 'unit', '',
                                                'normalized', lower(regexp_replace(btrim(i), '\s+', ' ', 'g'))))
            from jsonb_array_elements_text(case when jsonb_typeof(new.data -> 'ingredients') = 'array' then new.data -> 'ingredients' else '[]' end) i
            where btrim(i) <> ''), '[]'::jsonb))
        where k.household_id = new.household_id and k.path = 'recipes/le-' || substr(new.path, 9);
    end if;
  end if;
  return null;
end $$;

revoke execute on function kitchen.on_lets_eat_doc() from public, anon, authenticated;

-- Once: the Let's Eat recipes KitchenHub has no copy of yet.
select kitchen.lets_eat_recipe(household_id, substr(path, 9))
from letseat.docs where path ~ '^recipes/[^/]+$';
