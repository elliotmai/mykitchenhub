// src/backend/timers.js
// The household's cooking timers, in kitchen.timers (Hive's Supabase
// project). The fridge board, KitchenHub on every device and Hive all read
// the same rows; a new or stopped timer reaches the others through Realtime.

import { kitchen, myHousehold, supabase } from './supabase';

const fail = (error) => {
  if (error)
    throw Object.assign(new Error(error.message || 'Database error'), { code: error.code });
};

const COLUMNS = 'id, key, label, duration_s, ends_at';

/** Every timer in my household, soonest first. */
export async function listTimers() {
  const hid = await myHousehold();
  const { data, error } = await kitchen
    .from('timers')
    .select(COLUMNS)
    .eq('household_id', hid)
    .order('ends_at', { ascending: true });
  fail(error);
  return data || [];
}

/** Start one (a row from timerLogic.newTimerRow). Resolves to the stored row. */
export async function addTimer(row) {
  const hid = await myHousehold();
  const { data, error } = await kitchen
    .from('timers')
    .insert({ ...row, household_id: hid })
    .select(COLUMNS)
    .single();
  fail(error);
  return data;
}

/** Stop one: cancel it while it runs, or silence it once it rings. Everywhere. */
export async function removeTimer(id) {
  const hid = await myHousehold();
  const { error } = await kitchen.from('timers').delete().eq('household_id', hid).eq('id', id);
  fail(error);
}

/** Call `onChange` whenever my household's timers change anywhere. Returns the unsubscribe. */
export function watchTimers(onChange) {
  let channel = null;
  let live = true;
  myHousehold()
    .then((hid) => {
      if (!live) return;
      channel = supabase
        .channel(`kitchen-timers:${hid}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'kitchen', table: 'timers', filter: `household_id=eq.${hid}` },
          () => onChange()
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'kitchen', table: 'timers', filter: `household_id=eq.${hid}` },
          () => onChange()
        )
        // Deletes can't be filtered by column; a refetch only ever sees my own.
        .on('postgres_changes', { event: 'DELETE', schema: 'kitchen', table: 'timers' }, () =>
          onChange()
        )
        .subscribe();
    })
    .catch(() => {});
  return () => {
    live = false;
    if (channel) supabase.removeChannel(channel);
  };
}
