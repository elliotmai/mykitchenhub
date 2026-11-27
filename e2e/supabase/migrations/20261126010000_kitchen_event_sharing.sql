set check_function_bodies = off;
-- KitchenHub: planning events with people outside the household (the
-- kitchen-merge preview). Additive: household members keep exactly what they
-- had; these policies only add access for the people named here.
--
--   event partners   someone the household always plans events with (what
--                    Let's Eat was for): every event, its menus and who is
--                    bringing what, event shopping lines and stores, and the
--                    recipe book (read and write, as in Let's Eat) and dishes.
--                    Not the inventory, the day-by-day meal plan, timers,
--                    notifications, profiles or household settings.
--   event members    a guest on one event: that event (edit, or view only),
--                    the recipes on its menu (read), its shopping lines.
--
-- People join with a link (kitchen.share_links, joined through
-- kitchen.join_share) or an emailed invite (kitchen.share_invites, taken up
-- by kitchen.accept_my_invites once they sign in with that confirmed email).
-- Anonymous sessions get nothing, as everywhere outside ZNT.

create table kitchen.event_partners (
  household_id uuid not null references core.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  can_edit     boolean not null default true,  -- recipes and events; false = view only
  added_by     uuid references auth.users (id) on delete set null,
  added_at     timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table kitchen.event_members (
  household_id uuid not null references core.households (id) on delete cascade,
  event_id     text not null check (event_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  user_id      uuid not null references auth.users (id) on delete cascade,
  can_edit     boolean not null default true,
  added_by     uuid references auth.users (id) on delete set null,
  added_at     timestamptz not null default now(),
  primary key (household_id, event_id, user_id)
);
create index event_members_user on kitchen.event_members (user_id);
create index event_partners_user on kitchen.event_partners (user_id);

create table kitchen.share_links (
  token        text primary key default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  household_id uuid not null references core.households (id) on delete cascade,
  kind         text not null check (kind in ('partner', 'event')),
  event_id     text not null default '' check (event_id = '' or event_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  can_edit     boolean not null default true,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (household_id, kind, event_id)
);

create table kitchen.share_invites (
  household_id uuid not null references core.households (id) on delete cascade,
  kind         text not null check (kind in ('partner', 'event')),
  event_id     text not null default '',
  email        text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  can_edit     boolean not null default true,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (household_id, kind, event_id, email)
);

alter table kitchen.event_partners enable row level security;
alter table kitchen.event_members enable row level security;
alter table kitchen.share_links enable row level security;
alter table kitchen.share_invites enable row level security;
-- No direct policies: the household manages these through the functions below.
revoke all on kitchen.event_partners, kitchen.event_members, kitchen.share_links, kitchen.share_invites from anon, authenticated;
grant all on kitchen.event_partners, kitchen.event_members, kitchen.share_links, kitchen.share_invites to service_role;

-- ── Who may do what ─────────────────────────────────────────────────────
create function kitchen.not_anonymous() returns boolean language sql stable set search_path = '' as $$
  select auth.uid() is not null and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false
$$;

/** 'edit', 'view' or null: what I may do with the household's events (all of them). */
create function kitchen.partner_role(hid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when p.can_edit then 'edit' else 'view' end
  from kitchen.event_partners p where p.household_id = hid and p.user_id = auth.uid() and kitchen.not_anonymous()
$$;

/** 'edit', 'view' or null: what I may do with one event. */
create function kitchen.event_role(hid uuid, eid text) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when core.is_member(hid) then 'edit'
    when kitchen.partner_role(hid) is not null then kitchen.partner_role(hid)
    else (select case when m.can_edit then 'edit' else 'view' end from kitchen.event_members m
          where m.household_id = hid and m.event_id = eid and m.user_id = auth.uid() and kitchen.not_anonymous())
  end
$$;

/** Is this recipe on the menu of an event I'm a guest on? */
create function kitchen.on_my_event_menu(hid uuid, rid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from kitchen.event_members m
    join kitchen.docs e on e.household_id = m.household_id and e.path = 'events/' || m.event_id
    where m.household_id = hid and m.user_id = auth.uid() and kitchen.not_anonymous()
      and jsonb_path_exists(e.data, '$.days[*].menu[*] ? (@.recipeId == $id || exists(@.recipeIds[*] ? (@ == $id)))',
                            jsonb_build_object('id', rid)))
$$;

/** Reading a row of someone else's kitchen (household members already read everything). */
create function kitchen.shared_read(hid uuid, p text, d jsonb) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p ~ '^events/[^/]+$' then kitchen.event_role(hid, split_part(p, '/', 2)) is not null
    when p ~ '^recipes/[^/]+$' then kitchen.partner_role(hid) is not null or kitchen.on_my_event_menu(hid, split_part(p, '/', 2))
    when p ~ '^dishes/[^/]+$' then kitchen.partner_role(hid) is not null
    when p ~ '^shoppingItems/[^/]+$' then coalesce(d ->> 'eventId', '') <> '' and kitchen.event_role(hid, d ->> 'eventId') is not null
    when p ~ '^(stores|itemStores)/[^/]+$' then kitchen.partner_role(hid) is not null
      or exists (select 1 from kitchen.event_members m where m.household_id = hid and m.user_id = auth.uid())
    else false
  end
$$;

/** Writing one (op: insert, update, delete). */
create function kitchen.shared_write(hid uuid, p text, d jsonb, op text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p ~ '^events/[^/]+$' then
      kitchen.partner_role(hid) = 'edit'
      or (op <> 'delete' and kitchen.event_role(hid, split_part(p, '/', 2)) = 'edit')
    when p ~ '^(recipes|dishes)/[^/]+$' then kitchen.partner_role(hid) = 'edit'
    when p ~ '^shoppingItems/[^/]+$' then coalesce(d ->> 'eventId', '') <> '' and kitchen.event_role(hid, d ->> 'eventId') = 'edit'
    when p ~ '^(stores|itemStores)/[^/]+$' then kitchen.partner_role(hid) = 'edit'
      or exists (select 1 from kitchen.event_members m where m.household_id = hid and m.user_id = auth.uid() and m.can_edit)
    else false
  end
$$;

create policy "event partners and guests read" on kitchen.docs for select to authenticated
  using (kitchen.shared_read(household_id, path, data));
create policy "event partners and guests add" on kitchen.docs for insert to authenticated
  with check (kitchen.shared_write(household_id, path, data, 'insert'));
create policy "event partners and guests change" on kitchen.docs for update to authenticated
  using (kitchen.shared_write(household_id, path, data, 'update'))
  with check (kitchen.shared_write(household_id, path, data, 'update'));
create policy "event partners remove" on kitchen.docs for delete to authenticated
  using (kitchen.shared_write(household_id, path, data, 'delete'));

-- Recipe photos and scans: partners may add them too (paths under the household's folder).
create policy "event partners upload kitchen photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'kitchen' and kitchen.partner_role(((storage.foldername(name))[1])::uuid) = 'edit');

-- ── Sharing, for the household ──────────────────────────────────────────
create function kitchen.require_household() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare hid uuid := core.my_household();
begin
  if hid is null or not kitchen.not_anonymous() then raise exception 'Only the household can share its kitchen.' using errcode = '42501'; end if;
  return hid;
end $$;

/** The link for partners (event_id '') or one event; reset makes a new one and stops the old. */
create function kitchen.share_link(p_kind text, p_event text default '', p_reset boolean default false, p_can_edit boolean default null)
returns text language plpgsql security definer set search_path = '' as $$
declare hid uuid := kitchen.require_household(); t text;
begin
  if p_kind not in ('partner', 'event') then raise exception 'unknown kind'; end if;
  p_event := case when p_kind = 'partner' then '' else coalesce(p_event, '') end;
  if p_kind = 'event' and not exists (select 1 from kitchen.docs where household_id = hid and path = 'events/' || p_event) then
    raise exception 'No such event.';
  end if;
  if p_reset then delete from kitchen.share_links where household_id = hid and kind = p_kind and event_id = p_event; end if;
  insert into kitchen.share_links (household_id, kind, event_id, can_edit, created_by)
    values (hid, p_kind, p_event, coalesce(p_can_edit, true), auth.uid())
    on conflict (household_id, kind, event_id) do update set can_edit = coalesce(p_can_edit, kitchen.share_links.can_edit)
    returning token into t;
  return t;
end $$;

/** Join through a link. Returns where it leads: { household_id, kind, event_id, household }. */
create function kitchen.join_share(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l kitchen.share_links;
begin
  if not kitchen.not_anonymous() then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into l from kitchen.share_links where token = p_token and length(p_token) >= 24;
  if l is null then raise exception 'That link no longer works. Ask for a new one.' using errcode = '42501'; end if;
  if not exists (select 1 from core.household_members where household_id = l.household_id and user_id = auth.uid()) then
    if l.kind = 'partner' then
      insert into kitchen.event_partners (household_id, user_id, can_edit, added_by)
        values (l.household_id, auth.uid(), l.can_edit, l.created_by) on conflict do nothing;
    else
      insert into kitchen.event_members (household_id, event_id, user_id, can_edit, added_by)
        values (l.household_id, l.event_id, auth.uid(), l.can_edit, l.created_by) on conflict do nothing;
    end if;
  end if;
  return jsonb_build_object('household_id', l.household_id, 'kind', l.kind, 'event_id', l.event_id,
    'household', (select name from core.households where id = l.household_id));
end $$;

/** Invite by email; someone with that confirmed email already is added straight away. */
create function kitchen.invite_by_email(p_kind text, p_event text, p_email text, p_can_edit boolean default true)
returns text language plpgsql security definer set search_path = '' as $$
declare hid uuid := kitchen.require_household(); e text := lower(btrim(p_email));
begin
  p_event := case when p_kind = 'partner' then '' else coalesce(p_event, '') end;
  insert into kitchen.share_invites (household_id, kind, event_id, email, can_edit, created_by)
    values (hid, p_kind, p_event, e, p_can_edit, auth.uid())
    on conflict (household_id, kind, event_id, email) do update set can_edit = excluded.can_edit;
  perform kitchen.take_up_invites(u.id, u.email) from auth.users u
    where lower(u.email) = e and u.email_confirmed_at is not null;
  return e;
end $$;

create function kitchen.take_up_invites(who uuid, addr text) returns int
language plpgsql security definer set search_path = '' as $$
declare n int := 0; i kitchen.share_invites;
begin
  for i in select * from kitchen.share_invites where email = lower(addr) loop
    if not exists (select 1 from core.household_members where household_id = i.household_id and user_id = who) then
      if i.kind = 'partner' then
        insert into kitchen.event_partners (household_id, user_id, can_edit, added_by) values (i.household_id, who, i.can_edit, i.created_by) on conflict do nothing;
      else
        insert into kitchen.event_members (household_id, event_id, user_id, can_edit, added_by) values (i.household_id, i.event_id, who, i.can_edit, i.created_by) on conflict do nothing;
      end if;
    end if;
    delete from kitchen.share_invites where household_id = i.household_id and kind = i.kind and event_id = i.event_id and email = i.email;
    n := n + 1;
  end loop;
  return n;
end $$;

/** Signed in with a confirmed email: take up the invites waiting for it. */
create function kitchen.accept_my_invites() returns int
language sql security definer set search_path = '' as $$
  select coalesce((select kitchen.take_up_invites(u.id, u.email) from auth.users u
                   where u.id = auth.uid() and u.email_confirmed_at is not null and kitchen.not_anonymous()), 0)
$$;

/** Who the household shares with: partners (event '') or one event's guests, plus waiting invites. */
create function kitchen.sharing_people(p_kind text, p_event text default '')
returns table (user_id uuid, email text, name text, can_edit boolean, pending boolean)
language plpgsql stable security definer set search_path = '' as $$
declare hid uuid := kitchen.require_household();
begin
  p_event := case when p_kind = 'partner' then '' else coalesce(p_event, '') end;
  if p_kind = 'partner' then
    return query select p.user_id, u.email::text, coalesce(pr.display_name, u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1))::text, p.can_edit, false
      from kitchen.event_partners p join auth.users u on u.id = p.user_id left join core.profiles pr on pr.id = p.user_id
      where p.household_id = hid order by p.added_at;
  else
    return query select m.user_id, u.email::text, coalesce(pr.display_name, u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1))::text, m.can_edit, false
      from kitchen.event_members m join auth.users u on u.id = m.user_id left join core.profiles pr on pr.id = m.user_id
      where m.household_id = hid and m.event_id = p_event order by m.added_at;
  end if;
  return query select null::uuid, i.email, i.email, i.can_edit, true
    from kitchen.share_invites i where i.household_id = hid and i.kind = p_kind and i.event_id = p_event order by i.created_at;
end $$;

create function kitchen.set_sharing(p_kind text, p_event text, p_user uuid, p_email text, p_can_edit boolean, p_remove boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare hid uuid := kitchen.require_household();
begin
  p_event := case when p_kind = 'partner' then '' else coalesce(p_event, '') end;
  if p_user is null then
    if p_remove then delete from kitchen.share_invites where household_id = hid and kind = p_kind and event_id = p_event and email = lower(p_email);
    else update kitchen.share_invites set can_edit = p_can_edit where household_id = hid and kind = p_kind and event_id = p_event and email = lower(p_email); end if;
  elsif p_kind = 'partner' then
    if p_remove then delete from kitchen.event_partners where household_id = hid and user_id = p_user;
    else update kitchen.event_partners set can_edit = p_can_edit where household_id = hid and user_id = p_user; end if;
  else
    if p_remove then delete from kitchen.event_members where household_id = hid and event_id = p_event and user_id = p_user;
    else update kitchen.event_members set can_edit = p_can_edit where household_id = hid and event_id = p_event and user_id = p_user; end if;
  end if;
end $$;

/** What's shared with me: each kitchen I'm a partner in, and each event I'm a guest on. */
create function kitchen.my_shares() returns table (household_id uuid, household text, kind text, event_id text, can_edit boolean)
language sql stable security definer set search_path = '' as $$
  select p.household_id, h.name, 'partner', '', p.can_edit from kitchen.event_partners p join core.households h on h.id = p.household_id
    where p.user_id = auth.uid() and kitchen.not_anonymous()
  union all
  select m.household_id, h.name, 'event', m.event_id, m.can_edit from kitchen.event_members m join core.households h on h.id = m.household_id
    where m.user_id = auth.uid() and kitchen.not_anonymous()
      and not exists (select 1 from kitchen.event_partners p where p.household_id = m.household_id and p.user_id = m.user_id)
$$;

-- Event guests' and partners' Realtime: the read policy above already covers it.

revoke execute on all functions in schema kitchen from public, anon, authenticated;
grant execute on function kitchen.share_link(text, text, boolean, boolean), kitchen.join_share(text),
  kitchen.invite_by_email(text, text, text, boolean), kitchen.accept_my_invites(),
  kitchen.sharing_people(text, text), kitchen.set_sharing(text, text, uuid, text, boolean, boolean),
  kitchen.my_shares() to authenticated;
-- The policy helpers run inside policies, as the caller.
grant execute on function kitchen.not_anonymous(), kitchen.partner_role(uuid), kitchen.event_role(uuid, text),
  kitchen.on_my_event_menu(uuid, text), kitchen.shared_read(uuid, text, jsonb), kitchen.shared_write(uuid, text, jsonb, text)
  to authenticated;
grant execute on all functions in schema kitchen to service_role;

-- ── Let's Eat's recipes come across without the internal "legacy" tag ─────
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
    'instructions', '[]'::jsonb, 'source', 'legacy', 'legacyId', le_id,
    'createdAt', jsonb_build_object('$ts', (extract(epoch from now()) * 1000)::bigint),
    'tags', (select coalesce(jsonb_agg(distinct t order by t), '[]'::jsonb) from (
               select lower(regexp_replace(btrim(x), '\s+', ' ', 'g')) t from jsonb_array_elements_text(
                 case when jsonb_typeof(le -> 'tags') = 'array' then le -> 'tags' else '[]' end) x
               where btrim(x) <> '') s),
    'servings', 4, 'difficulty', 'medium', 'timesCooked', 0,
    'prepTime', null, 'cookTime', null, 'imageUrl', null, 'sourceId', null))
  on conflict (household_id, path) do nothing;
  return 'le-' || le_id;
end $$;
revoke execute on function kitchen.lets_eat_recipe(uuid, text) from public, anon, authenticated;

-- ── Let's Eat's events, copied into KitchenHub's (copy only; Let's Eat keeps
-- its own until it retires). Idempotent: one KitchenHub event per Let's Eat
-- event ('events/le-<id>'), added if missing; later edits in Let's Eat are
-- not carried over. Each day's recipes become menu lines on KitchenHub's copy.
create or replace function kitchen.copy_lets_eat_events() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
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
  from letseat.docs e where e.path ~ '^events/[^/]+$'
  on conflict (household_id, path) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function kitchen.copy_lets_eat_events() from public, anon, authenticated;
grant execute on function kitchen.copy_lets_eat_events() to service_role;

select kitchen.copy_lets_eat_events();
