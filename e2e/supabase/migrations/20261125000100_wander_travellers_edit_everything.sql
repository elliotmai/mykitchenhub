set check_function_bodies = off;
-- Wander: anyone on a trip can read, add, edit and delete anything in it.
--
-- The owner's rule: "anybody who is part of a trip should be able to read and
-- write and edit and delete anything within that trip". Until now each kind of
-- record kept the old app's finer rules (only a poll's creator edits it, only
-- whoever added an album changes it, and so on). Now a traveller on the trip
-- (a trip member, or the person who made the trip) can do anything with
-- anything that belongs to it, the trip itself included.
--
-- Unchanged: a record still can't move to another trip; profiles,
-- friendships and personal calendar/app tokens still belong to their owner;
-- observers keep what they had (they follow a trip, they aren't on it);
-- creating a trip and adding yourself to a trip you made work as before.

create or replace function wander.can_write(col text, rid text, old jsonb, new jsonb) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare me text := wander.me(); d jsonb := coalesce(new, old); trip text := wander.trip_of(col, rid, coalesce(new, old));
  mine_new boolean := new ->> 'user_id' is not distinct from me;
begin
  if me is null then return false; end if;
  -- a record can't move to another trip
  if old is not null and new is not null and wander.trip_of(col, rid, old) is distinct from trip then return false; end if;
  -- on the trip: anything in it
  if col not in ('profiles', 'friendships', 'calendar_tokens', 'app_tokens') and wander.is_traveller(trip) then return true; end if;
  case col
  when 'profiles' then return rid = me;
  when 'friendships' then
    return (old is null or old -> 'users' ? me) and (new is null or (new -> 'users' ? me and jsonb_array_length(new -> 'users') = 2));
  when 'calendar_tokens', 'app_tokens' then
    return old is null and new ->> 'created_by' = me and (col = 'app_tokens' or wander.is_traveller(new ->> 'trip_id') or wander.is_observer(new ->> 'trip_id'))
        or new is null and old ->> 'created_by' = me;
  when 'trips' then
    return old is null and new ->> 'created_by' = me;
  when 'trip_members' then
    return old is null and mine_new and wander.creator_of('trips', trip) = me;
  when 'poll_votes', 'date_availability' then
    -- observers vote and say when they're free, as themselves
    if old is null then return mine_new and wander.is_observer(trip); end if;
    if new is null then return old ->> 'user_id' = me; end if;
    return col = 'date_availability' and old ->> 'user_id' = me and mine_new;
  when 'trip_observers' then
    -- an observer can leave
    return new is null and old ->> 'user_id' = me;
  when 'brainstorm_ideas' then
    if new is null then return old ->> 'created_by' = me; end if;
    return wander.is_observer(trip);
  when 'brainstorm_comments' then
    if new is null then return old ->> 'created_by' = me; end if;
    return old is null and wander.is_observer(trip);
  when 'trip_activity' then
    return new is null and old ->> 'actor_id' = me;
  else
    return false;
  end case;
end $$;
