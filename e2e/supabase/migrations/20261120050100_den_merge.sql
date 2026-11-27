set check_function_bodies = off;
-- Our Den: changing part of a record in one step, so two phones changing the
-- same den at once can't undo each other (what Firestore's merge and update
-- did). These run as the caller, so the den's row-level security still decides.

/** b laid over a, all the way down. A value of {"$delete": true} removes that key. */
create function den.deep_merge(a jsonb, b jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; out jsonb := coalesce(a, '{}'::jsonb);
begin
  if jsonb_typeof(out) <> 'object' then out := '{}'::jsonb; end if;
  for k, v in select * from jsonb_each(coalesce(b, '{}'::jsonb)) loop
    if v = '{"$delete": true}'::jsonb then
      out := out - k;
    elsif jsonb_typeof(v) = 'object' and not (v ? '$ts') then
      out := jsonb_set(out, array[k], den.deep_merge(out -> k, v));
    else
      out := jsonb_set(out, array[k], v);
    end if;
  end loop;
  return out;
end $$;

/** Firestore setDoc(…, { merge: true }) on the den itself. */
create function den.merge_couple(cid text, patch jsonb) returns void
language sql security invoker set search_path = '' as $$
  update den.couples set data = den.deep_merge(data, patch) where id = cid
$$;

/** Firestore setDoc(…, { merge: true }) on one record: creates it if it isn't there. */
create function den.merge_item(cid text, col text, item_id text, patch jsonb) returns void
language sql security invoker set search_path = '' as $$
  insert into den.items (couple_id, collection, id, data) values (cid, col, item_id, den.deep_merge('{}', patch))
  on conflict (couple_id, collection, id) do update set data = den.deep_merge(den.items.data, patch)
$$;

/** Firestore updateDoc: replaces the named fields, leaves the rest. */
create function den.patch_item(cid text, col text, item_id text, patch jsonb) returns void
language sql security invoker set search_path = '' as $$
  update den.items set data = (data || patch) - array(select key from jsonb_each(patch) where value = '{"$delete": true}'::jsonb)
  where couple_id = cid and collection = col and id = item_id
$$;

/** My own profile, merged. */
create function den.merge_profile(patch jsonb) returns void
language sql security invoker set search_path = '' as $$
  insert into den.profiles (user_id, data) values (auth.uid(), den.deep_merge('{}', patch))
  on conflict (user_id) do update set data = den.deep_merge(den.profiles.data, patch)
$$;

revoke execute on function den.deep_merge(jsonb, jsonb), den.merge_couple(text, jsonb), den.merge_item(text, text, text, jsonb),
  den.patch_item(text, text, text, jsonb), den.merge_profile(jsonb) from public, anon;
grant execute on function den.deep_merge(jsonb, jsonb), den.merge_couple(text, jsonb), den.merge_item(text, text, text, jsonb),
  den.patch_item(text, text, text, jsonb), den.merge_profile(jsonb) to authenticated, service_role;

-- Hive's board reads a person's Google link by their Hive id (a pass's sub).
-- google_tokens stays service-only; nothing here changes that.
