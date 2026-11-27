set check_function_bodies = off;
-- JournalTogether: journal entries, habits ("vices") and timers, each owned
-- by one person, plus sharing by email. Moved from Firebase project
-- journal-together-9234f. Each Firestore document is one row; its fields are
-- kept as JSON (dates as {"$ts": milliseconds}).
--
-- Who can read what is decided here, not in the app:
--   - your own rows, always;
--   - someone else's entries, habits or timers when they have a sharing row
--     ("permissions") naming your account's email for that kind of thing;
--   - a sharing row that names your email (so you can see who shares with you).
-- Only the owner can write.

create table journal.docs (
  collection text not null check (collection in ('entries', 'habits', 'timers', 'permissions')),
  id         text not null check (length(id) between 1 and 128),
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
create index docs_owner on journal.docs (owner_id, collection);
create index docs_shared_with on journal.docs (lower(data ->> 'sharedWith')) where collection = 'permissions';

create table journal.imports (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  legacy_uid  text,
  rows        integer not null default 0,
  imported_at timestamptz not null default now()
);

create function journal.touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger docs_touch before update on journal.docs for each row execute function journal.touch();

-- The signed-in person's email, as their account knows it.
create function journal.my_email() returns text language sql stable security definer set search_path = '' as $$
  select lower(email) from auth.users where id = auth.uid()
$$;

-- Has `owner` shared this kind of thing with me? (Security definer: a rule
-- on journal.docs can't query journal.docs itself without looping.)
create function journal.shared_with_me(owner uuid, kind text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from journal.docs p
    where p.collection = 'permissions' and p.owner_id = owner
      and lower(p.data ->> 'sharedWith') = journal.my_email()
      and p.data ->> 'type' in (kind, 'both'))
$$;

alter table journal.docs    enable row level security;
alter table journal.imports enable row level security;

create policy "read mine, and what is shared with me" on journal.docs for select to authenticated using (
  owner_id = auth.uid()
  or (collection = 'permissions' and lower(data ->> 'sharedWith') = journal.my_email())
  or (collection = 'entries' and journal.shared_with_me(owner_id, 'entries'))
  or (collection in ('habits', 'timers') and journal.shared_with_me(owner_id, 'habits'))
);
create policy "write only mine" on journal.docs for insert to authenticated with check (owner_id = auth.uid());
create policy "change only mine" on journal.docs for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "delete only mine" on journal.docs for delete to authenticated using (owner_id = auth.uid());
create policy "my import" on journal.imports for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on journal.docs to authenticated;
grant select, insert on journal.imports to authenticated;
grant all on all tables in schema journal to service_role;
revoke all on all tables in schema journal from anon;

revoke execute on all functions in schema journal from public, anon, authenticated;
grant execute on function journal.my_email(), journal.shared_with_me(uuid, text) to authenticated;
grant execute on all functions in schema journal to service_role;

-- Live updates: a shared entry shows up on your partner's screen without a refresh.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table journal.docs;
  end if;
end $$;
