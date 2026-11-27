set check_function_bodies = off;
-- Pool Heater: the household's pool and house temperature monitor.
-- Moved from Firebase project water-heater-sensors (Realtime Database, node
-- water-heater-user/). Each Firebase record becomes one row here with its
-- fields kept as JSON, so the app and the Pi keep their shapes.
--
-- Who can do what
--   * Everyone in the household reads everything and changes settings
--     (sensor names, colours, on/off, location) and sends the Pi commands.
--   * Viewing stays open without signing in, as it was on Firebase, while
--     pool.sites.public_view is on. A member can switch it off.
--   * There is no owners list any more: being in the household is the test,
--     and household membership is never public.
--   * The Pi (and, until it moves over, a bridge copying from Firebase) writes
--     through pool.device_sync() with its own device key. A device key can only
--     write readings, logs, weather, diagnostics, sensor last-seen times and the
--     progress of commands; it cannot read anything but commands.
--   * Rollups, retention and sensor health run in pg_cron (bottom of file).

create extension if not exists pg_cron;

create table pool.sites (
  household_id uuid primary key references core.households (id) on delete cascade,
  public_view  boolean not null default true,
  created_at   timestamptz not null default now()
);

-- Time series, keyed by unix seconds like the Firebase keys were.
--   tier raw     5-min readings   kept 7 days
--   tier hourly  min/max/avg      kept 90 days
--   tier daily   min/max/avg      kept forever
create table pool.readings (
  household_id uuid not null references core.households (id) on delete cascade,
  tier         text not null check (tier in ('raw', 'hourly', 'daily')),
  ts           bigint not null,
  data         jsonb not null,
  primary key (household_id, tier, ts)
);

-- Pi logs: info kept 14 days, warnings/errors 90 days.
create table pool.logs (
  household_id uuid not null references core.households (id) on delete cascade,
  kind         text not null check (kind in ('info', 'error')),
  ts           bigint not null,
  data         jsonb not null,
  primary key (household_id, kind, ts)
);

-- Weather the Pi looked up each cycle (kept 7 days), and the other 433MHz
-- chatter it heard (kept, as on Firebase).
create table pool.weather (
  household_id uuid not null references core.households (id) on delete cascade,
  ts           bigint not null,
  data         jsonb not null,
  primary key (household_id, ts)
);
create table pool.nonweather (
  household_id uuid not null references core.households (id) on delete cascade,
  ts           bigint not null,
  data         jsonb not null,
  primary key (household_id, ts)
);

-- Sensor settings: displayName, color, alive (shown as "enabled"), location,
-- status and lastSeen.
create table pool.sensors (
  household_id uuid not null default core.my_household() references core.households (id) on delete cascade,
  id           text not null check (length(id) between 1 and 128),
  data         jsonb not null default '{}'::jsonb,
  primary key (household_id, id)
);

-- Sensor history: moved, renamed, offline, online... kept forever.
create table pool.sensor_events (
  household_id uuid not null default core.my_household() references core.households (id) on delete cascade,
  id           text not null default gen_random_uuid()::text,
  ts           bigint not null,
  data         jsonb not null,
  primary key (household_id, id)
);
create index sensor_events_ts on pool.sensor_events (household_id, ts);

-- Single records: live, diagnostics, sdr_recovery, stats/records,
-- commands/restart, commands/reset_sdr, non-weather-latest.
create table pool.state (
  household_id uuid not null default core.my_household() references core.households (id) on delete cascade,
  key          text not null check (key in ('live', 'diagnostics', 'sdr_recovery', 'stats/records',
                 'commands/restart', 'commands/reset_sdr', 'non-weather-latest')),
  data         jsonb not null,
  updated_at   timestamptz not null default now(),
  primary key (household_id, key)
);

-- Devices that write for a household. Only a hash of each key is kept.
create table pool.devices (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references core.households (id) on delete cascade,
  name         text not null,
  key_hash     text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

alter table pool.sites         enable row level security;
alter table pool.readings      enable row level security;
alter table pool.logs          enable row level security;
alter table pool.weather       enable row level security;
alter table pool.nonweather    enable row level security;
alter table pool.sensors       enable row level security;
alter table pool.sensor_events enable row level security;
alter table pool.state         enable row level security;
alter table pool.devices       enable row level security;  -- no policies: nobody reads keys

-- Can this visitor look at this household's pool?
create function pool.can_view(hid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select core.is_member(hid)
      or exists (select 1 from pool.sites s where s.household_id = hid and s.public_view)
$$;

create policy "members, or anyone while viewing is open" on pool.sites for select to anon, authenticated
  using (pool.can_view(household_id));
create policy "members open or close viewing" on pool.sites for update to authenticated
  using (core.is_member(household_id)) with check (core.is_member(household_id));

create policy "view readings" on pool.readings for select to anon, authenticated using (pool.can_view(household_id));
create policy "view logs" on pool.logs for select to anon, authenticated using (pool.can_view(household_id));
create policy "view weather" on pool.weather for select to anon, authenticated using (pool.can_view(household_id));
create policy "view other chatter" on pool.nonweather for select to anon, authenticated using (pool.can_view(household_id));
create policy "view sensors" on pool.sensors for select to anon, authenticated using (pool.can_view(household_id));
create policy "view sensor history" on pool.sensor_events for select to anon, authenticated using (pool.can_view(household_id));
create policy "view state" on pool.state for select to anon, authenticated using (pool.can_view(household_id));

create policy "members add sensors" on pool.sensors for insert to authenticated
  with check (core.is_member(household_id));
create policy "members change sensors" on pool.sensors for update to authenticated
  using (core.is_member(household_id)) with check (core.is_member(household_id));
create policy "members note sensor changes" on pool.sensor_events for insert to authenticated
  with check (core.is_member(household_id));
create policy "members send the Pi commands" on pool.state for insert to authenticated
  with check (core.is_member(household_id) and key like 'commands/%');
create policy "members resend the Pi commands" on pool.state for update to authenticated
  using (core.is_member(household_id) and key like 'commands/%')
  with check (core.is_member(household_id) and key like 'commands/%');

grant select on pool.sites, pool.readings, pool.logs, pool.weather, pool.nonweather,
  pool.sensors, pool.sensor_events, pool.state to anon, authenticated;
grant update (public_view) on pool.sites to authenticated;
grant insert, update on pool.sensors to authenticated;
grant insert on pool.sensor_events to authenticated;
grant insert, update on pool.state to authenticated;
grant all on all tables in schema pool to service_role;

-- ─────────────────────────── The Pi's way in ───────────────────────────
--
-- POST /rest/v1/rpc/device_sync (Content-Profile: pool) with
--   {"device_key": "...", "ops": [{"op": "set"|"update"|"get", "path": "...", "value": ...}]}
-- Paths are the Firebase paths under water-heater-user/, so the Pi's code
-- barely changes. Returns one result per op (the value, for a get).

create function pool.device_sync(device_key text, ops jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  hid uuid;
  o jsonb;
  op text;
  path text;
  val jsonb;
  head text;
  rest text;
  results jsonb := '[]'::jsonb;
  k text;
  v jsonb;
begin
  if device_key is null or length(device_key) < 32 then
    raise exception 'unknown device' using errcode = '28000';
  end if;
  update pool.devices d set last_used_at = now()
   where d.key_hash = encode(extensions.digest(device_key, 'sha256'), 'hex') and d.revoked_at is null
  returning d.household_id into hid;
  if hid is null then
    raise exception 'unknown device' using errcode = '28000';
  end if;
  if jsonb_typeof(ops) <> 'array' or jsonb_array_length(ops) > 500 then
    raise exception 'ops must be an array of at most 500' using errcode = '22023';
  end if;

  for o in select * from jsonb_array_elements(ops) loop
    op := o->>'op';
    path := trim(both '/' from coalesce(o->>'path', ''));
    path := regexp_replace(path, '^water-heater-user/?', '');
    val := o->'value';
    head := split_part(path, '/', 1);
    rest := nullif(substr(path, length(head) + 2), '');

    if op = 'get' then
      if path not in ('commands/restart', 'commands/reset_sdr') then
        raise exception 'a device can only read commands, not %', path using errcode = '42501';
      end if;
      results := results || jsonb_build_array(
        (select s.data from pool.state s where s.household_id = hid and s.key = path));
      continue;
    end if;

    if op not in ('set', 'update') or val is null or jsonb_typeof(val) <> 'object' then
      raise exception 'bad op for %', path using errcode = '22023';
    end if;

    if head in ('readings_raw', 'logs', 'logs_errors', 'weather_history', 'non-weather-sensors') then
      if op <> 'set' or rest is null or rest !~ '^[0-9]{1,12}$' then
        raise exception 'bad path %', path using errcode = '22023';
      end if;
      if head = 'readings_raw' then
        insert into pool.readings values (hid, 'raw', rest::bigint, val)
          on conflict (household_id, tier, ts) do update set data = excluded.data;
      elsif head in ('logs', 'logs_errors') then
        insert into pool.logs values (hid, case head when 'logs' then 'info' else 'error' end, rest::bigint, val)
          on conflict (household_id, kind, ts) do update set data = excluded.data;
      elsif head = 'weather_history' then
        insert into pool.weather values (hid, rest::bigint, val)
          on conflict (household_id, ts) do update set data = excluded.data;
      else
        insert into pool.nonweather values (hid, rest::bigint, val)
          on conflict (household_id, ts) do update set data = excluded.data;
      end if;

    elsif path in ('live', 'diagnostics', 'sdr_recovery', 'non-weather-latest') then
      if op <> 'set' then raise exception 'bad op for %', path using errcode = '22023'; end if;
      insert into pool.state (household_id, key, data) values (hid, path, val)
        on conflict (household_id, key) do update set data = excluded.data, updated_at = now();

    elsif path in ('commands/restart', 'commands/reset_sdr') then
      -- The Pi reports progress on a command the dashboard sent.
      insert into pool.state (household_id, key, data) values (hid, path, val)
        on conflict (household_id, key) do update
          set data = case when op = 'set' then excluded.data else pool.state.data || excluded.data end,
              updated_at = now();

    elsif path = 'sensors' and op = 'update' then
      -- {"<sensor>/lastSeen": unix seconds, ...}: only last-seen times, never
      -- moved backwards.
      for k, v in select * from jsonb_each(val) loop
        if k !~ '^[^/]{1,128}/lastSeen$' or jsonb_typeof(v) <> 'number' then
          raise exception 'a device can only set lastSeen, not %', k using errcode = '42501';
        end if;
        insert into pool.sensors (household_id, id, data)
          values (hid, split_part(k, '/', 1), jsonb_build_object('lastSeen', v))
          on conflict (household_id, id) do update
            set data = pool.sensors.data || jsonb_build_object('lastSeen', greatest(v, pool.sensors.data->'lastSeen'));
      end loop;

    else
      raise exception 'a device cannot write %', path using errcode = '42501';
    end if;
    results := results || jsonb_build_array(true);
  end loop;
  return results;
end $$;

-- Settings saves merge into a sensor's record in one step, so a save never
-- undoes a last-seen time the Pi wrote meanwhile. Runs as the caller: the
-- household-member policies above decide.
create function pool.set_sensor(hid uuid, sensor text, patch jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if exists (select 1 from jsonb_object_keys(patch) k where k not in ('displayName', 'color', 'alive', 'location')) then
    raise exception 'only displayName, color, alive and location can be changed' using errcode = '22023';
  end if;
  insert into pool.sensors (household_id, id, data) values (hid, sensor, patch)
    on conflict (household_id, id) do update set data = pool.sensors.data || excluded.data;
end $$;
revoke execute on function pool.set_sensor(uuid, text, jsonb) from public, anon;
grant execute on function pool.set_sensor(uuid, text, jsonb) to authenticated, service_role;

-- ─────────────────────────── Rollups and upkeep ───────────────────────────

-- min/max/avg/last/count for one sensor or outside field, as the old
-- Firebase function wrote them.
create function pool.summarize(hid uuid, s bigint, e bigint) returns jsonb
language sql stable set search_path = '' as $$
  with r as (
    select ts, data from pool.readings where household_id = hid and tier = 'raw' and ts between s and e
  ), f as (
    select r.ts, kv.key, (kv.value)::text::float8 as v
    from r, jsonb_each(r.data) kv
    where jsonb_typeof(kv.value) = 'number' and kv.key not in ('timestamp', 'unix_timestamp')
  ), g as (
    select case when key like 'outside\_%' then 'outside' else 'sensors' end as grp,
           case when key like 'outside\_%' then substr(key, 9) else key end as name,
           jsonb_build_object(
             'min', round(min(v)::numeric, 2)::float8,
             'max', round(max(v)::numeric, 2)::float8,
             'avg', round(avg(v)::numeric, 2)::float8,
             'last', round((array_agg(v order by ts desc))[1]::numeric, 2)::float8,
             'count', count(*)) as agg
    from f group by 1, 2
  )
  select case when (select count(*) from r) = 0 then null else jsonb_build_object(
    'unix_timestamp', s, 'bucket_start', s, 'bucket_end', e,
    'count', (select count(*) from r),
    'sensors', coalesce((select jsonb_object_agg(name, agg) from g where grp = 'sensors'), '{}'::jsonb),
    'outside', coalesce((select jsonb_object_agg(name, agg) from g where grp = 'outside'), '{}'::jsonb)
      || coalesce((select jsonb_build_object('conditions_last', r.data->'outside_conditions') from r
                   where jsonb_typeof(r.data->'outside_conditions') = 'string' order by ts desc limit 1), '{}'::jsonb)
  ) end
$$;

create function pool.build_bucket(hid uuid, t text, s bigint, e bigint) returns jsonb
language plpgsql set search_path = '' as $$
declare doc jsonb := pool.summarize(hid, s, e);
begin
  if doc is not null then
    insert into pool.readings values (hid, t, s, doc)
      on conflict (household_id, tier, ts) do update set data = excluded.data;
  end if;
  return doc;
end $$;

-- Fold a daily bucket into the all-time records.
create function pool.fold_records(hid uuid, doc jsonb) returns void
language plpgsql set search_path = '' as $$
declare
  cur jsonb;
  grp text;
  name text;
  agg jsonb;
  rec jsonb;
  ts bigint := (doc->>'unix_timestamp')::bigint;
begin
  select data into cur from pool.state where household_id = hid and key = 'stats/records';
  cur := coalesce(cur, '{}'::jsonb);
  foreach grp in array array['sensors', 'outside'] loop
    for name, agg in select * from jsonb_each(coalesce(doc->grp, '{}'::jsonb)) loop
      continue when jsonb_typeof(agg) <> 'object' or jsonb_typeof(agg->'min') <> 'number';
      rec := coalesce(cur->grp->name, '{}'::jsonb);
      if rec->'min' is null or (agg->>'min')::float8 < (rec->'min'->>'value')::float8 then
        rec := rec || jsonb_build_object('min', jsonb_build_object('value', agg->'min', 'unix_timestamp', ts));
      end if;
      if rec->'max' is null or (agg->>'max')::float8 > (rec->'max'->>'value')::float8 then
        rec := rec || jsonb_build_object('max', jsonb_build_object('value', agg->'max', 'unix_timestamp', ts));
      end if;
      cur := jsonb_set(cur, array[grp], coalesce(cur->grp, '{}'::jsonb) || jsonb_build_object(name, rec));
    end loop;
  end loop;
  cur := cur || jsonb_build_object('updated', ts);
  insert into pool.state (household_id, key, data) values (hid, 'stats/records', cur)
    on conflict (household_id, key) do update set data = excluded.data, updated_at = now();
end $$;

-- Every hour: the last two full hours (the second catches late arrivals).
create function pool.rollup_hourly() returns void
language plpgsql set search_path = '' as $$
declare hid uuid; h bigint := floor(extract(epoch from now()) / 3600)::bigint * 3600 - 3600;
begin
  for hid in select household_id from pool.sites loop
    perform pool.build_bucket(hid, 'hourly', h - 3600, h - 1);
    perform pool.build_bucket(hid, 'hourly', h, h + 3599);
  end loop;
end $$;

-- Every day: the previous full UTC day, then the all-time records.
create function pool.rollup_daily() returns void
language plpgsql set search_path = '' as $$
declare hid uuid; d bigint := floor(extract(epoch from now()) / 86400)::bigint * 86400 - 86400; doc jsonb;
begin
  for hid in select household_id from pool.sites loop
    doc := pool.build_bucket(hid, 'daily', d, d + 86399);
    if doc is not null then perform pool.fold_records(hid, doc); end if;
  end loop;
end $$;

create function pool.enforce_ttl() returns void
language sql set search_path = '' as $$
  delete from pool.readings where tier = 'raw' and ts <= extract(epoch from now())::bigint - 7 * 86400;
  delete from pool.readings where tier = 'hourly' and ts <= extract(epoch from now())::bigint - 90 * 86400;
  delete from pool.logs where kind = 'info' and ts <= extract(epoch from now())::bigint - 14 * 86400;
  delete from pool.logs where kind = 'error' and ts <= extract(epoch from now())::bigint - 90 * 86400;
  delete from pool.weather where ts <= extract(epoch from now())::bigint - 7 * 86400;
$$;

-- A sensor silent for 20 minutes is offline; one heard again is back online.
create function pool.sensor_health() returns void
language plpgsql set search_path = '' as $$
declare r record; now_s bigint := extract(epoch from now())::bigint; silent bigint; status text;
begin
  for r in select household_id, id, data from pool.sensors where jsonb_typeof(data->'lastSeen') = 'number' loop
    silent := now_s - (r.data->>'lastSeen')::float8::bigint;
    status := coalesce(r.data->>'status', 'online');
    if silent > 20 * 60 and status <> 'offline' then
      update pool.sensors set data = data || '{"status": "offline"}' where household_id = r.household_id and id = r.id;
      insert into pool.sensor_events (household_id, ts, data) values (r.household_id, now_s, jsonb_build_object(
        'sensorId', r.id, 'event', 'offline', 'timestamp', to_char(to_timestamp(now_s) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"'),
        'unix_timestamp', now_s, 'note', format('No data for %s min', round(silent / 60.0))));
    elsif silent <= 20 * 60 and status = 'offline' then
      update pool.sensors set data = data || '{"status": "online"}' where household_id = r.household_id and id = r.id;
      insert into pool.sensor_events (household_id, ts, data) values (r.household_id, now_s, jsonb_build_object(
        'sensorId', r.id, 'event', 'online', 'timestamp', to_char(to_timestamp(now_s) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"'),
        'unix_timestamp', now_s));
    end if;
  end loop;
end $$;

revoke execute on all functions in schema pool from public, anon, authenticated;
grant execute on function pool.can_view(uuid) to anon, authenticated;
grant execute on function pool.device_sync(text, jsonb) to anon, authenticated;
grant execute on function pool.set_sensor(uuid, text, jsonb) to authenticated;
grant execute on all functions in schema pool to service_role;

select cron.schedule('pool-rollup-hourly', '5 * * * *', 'select pool.rollup_hourly()');
select cron.schedule('pool-rollup-daily', '15 0 * * *', 'select pool.rollup_daily()');
select cron.schedule('pool-enforce-ttl', '0 */6 * * *', 'select pool.enforce_ttl()');
select cron.schedule('pool-sensor-health', '*/15 * * * *', 'select pool.sensor_health()');

-- The Mais household's pool (the only one).
insert into pool.sites (household_id)
  select id from core.households where id = 'd990fc59-33aa-4ccd-8325-cecfe9b30782'
  on conflict do nothing;
