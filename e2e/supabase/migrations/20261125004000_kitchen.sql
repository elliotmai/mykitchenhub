set check_function_bodies = off;
-- KitchenHub: moved from Firebase project mykitchenhub-db665.
--
-- One row per Firestore document, by path, its fields kept as JSON (dates as
-- {"$ts": milliseconds}), so the app's records keep their shape.
--
-- KitchenHub is a household app. What was under each cook's users/{uid}/ in
-- Firebase is now the household's, at the top level: the meal plan
-- (mealPlans, mealPlanEntries), the shopping list (shoppingItems), what is in
-- the kitchen (inventory, storageLocations, deliveries, importHistory) and the
-- recipe library (recipes, syncMetadata). Every member reads and changes them.
--
-- What stays a person's own keeps its users/<their uid>/ path: the profile
-- (users/<uid>: phone number for alerts, preferences) and notifications. Only
-- that person sees or changes those rows (owner_id comes from the path).
--
-- Tokens for the board API live in core.api_tokens (app 'kitchenhub').

create table kitchen.docs (
  household_id uuid not null default core.my_household() references core.households (id) on delete cascade,
  path         text not null check (path ~ '^[^/]+/[^/]+(/[^/]+/[^/]+)*$' and length(path) < 400),
  parent       text generated always as (regexp_replace(path, '/[^/]+$', '')) stored,
  owner_id     uuid generated always as (
                 case when path ~ '^users/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(/|$)'
                      then substring(path from 7 for 36)::uuid end) stored,
  data         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (household_id, path),
  -- under users/ only with a real person's id: no shared rows hide there
  check (path !~ '^users/' or owner_id is not null)
);
create index docs_parent on kitchen.docs (household_id, parent);
create index docs_owner on kitchen.docs (owner_id) where owner_id is not null;

create function kitchen.touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger docs_touch before update on kitchen.docs for each row execute function kitchen.touch();

alter table kitchen.docs enable row level security;
create policy "the household's kitchen, and my own rows" on kitchen.docs for all to authenticated
  using (core.is_member(household_id) and (owner_id is null or owner_id = auth.uid()))
  with check (core.is_member(household_id) and (owner_id is null or owner_id = auth.uid()));

-- Recipe photos: kitchen/<household id>/recipes/<recipe id>/<file>. Readable by
-- link (the links are unguessable, as Firebase's download links were); only
-- the household adds or removes them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kitchen', 'kitchen', true, 10485760,
        array['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;
create policy "kitchen members upload to their household's folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'kitchen' and core.is_member(((storage.foldername(name))[1])::uuid));
create policy "kitchen members replace their household's photos" on storage.objects for update to authenticated
  using (bucket_id = 'kitchen' and core.is_member(((storage.foldername(name))[1])::uuid));
create policy "kitchen members remove their household's photos" on storage.objects for delete to authenticated
  using (bucket_id = 'kitchen' and core.is_member(((storage.foldername(name))[1])::uuid));

-- ── Quiet bringover: a cook's own old rows (profile, notifications, tokens) ──
-- payload: { docs: [{ path: 'users/<old uid>[/…]' | '<household path>', data }],
--            tokens: [{ hash, label }] }
-- Runs as the person (auth.uid()); raises, leaving it waiting, until they have
-- a household.
create function kitchen.adopt_legacy(old_id text, payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare hid uuid := core.my_household(); me uuid := auth.uid();
begin
  if me is null then raise exception 'nobody to adopt for'; end if;
  if hid is null then raise exception 'no household yet'; end if;
  insert into kitchen.docs (household_id, path, data)
    select hid,
           case when r ->> 'path' = 'users/' || old_id or r ->> 'path' like 'users/' || old_id || '/%'
                then 'users/' || me::text || substr(r ->> 'path', length('users/' || old_id) + 1)
                else r ->> 'path' end,
           replace(coalesce(r -> 'data', '{}'::jsonb)::text, '"' || old_id || '"', '"' || me::text || '"')::jsonb
    from jsonb_array_elements(coalesce(payload -> 'docs', '[]'::jsonb)) r
    where (r ->> 'path') !~ '^users/' or r ->> 'path' = 'users/' || old_id or r ->> 'path' like 'users/' || old_id || '/%'
    on conflict (household_id, path) do nothing;
  insert into core.api_tokens (hash, user_id, app, label)
    select t ->> 'hash', me, 'kitchenhub', coalesce(t ->> 'label', 'Fridge Board')
    from jsonb_array_elements(coalesce(payload -> 'tokens', '[]'::jsonb)) t
    where (t ->> 'hash') ~ '^[0-9a-f]{64}$'
    on conflict (hash) do nothing;
end $$;

insert into core.bringover_apps (app, handler) values ('kitchenhub', 'kitchen.adopt_legacy(text,jsonb)')
on conflict (app) do update set handler = excluded.handler;

revoke all on all tables in schema kitchen from anon, authenticated;
grant select, insert, update, delete on kitchen.docs to authenticated;
grant all on all tables in schema kitchen to service_role;
revoke execute on all functions in schema kitchen from public, anon, authenticated;
grant execute on all functions in schema kitchen to service_role;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table kitchen.docs;
  end if;
end $$;
