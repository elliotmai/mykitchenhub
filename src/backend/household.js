// src/backend/household.js
// The household a kitchen belongs to (Hive's core.households): find it, make
// one, join one with its code, and show or renew the code for others to join.
// The same households, and the same codes, as Hive and Let's Eat.

import { core, forgetHousehold, myHousehold } from './supabase';

const fail = (error) => {
  if (error)
    throw Object.assign(new Error(error.message || 'Something went wrong.'), { code: error.code });
};

/** My household's id, or null when I have none yet. */
export async function currentHousehold() {
  try {
    return await myHousehold({ create: false });
  } catch (err) {
    if (err.code === 'permission-denied') return null;
    throw err;
  }
}

export async function createHousehold(name) {
  const { data, error } = await core.rpc('create_household', {
    name: String(name || '').trim() || 'Kitchen',
  });
  fail(error);
  forgetHousehold();
  return data;
}

export async function joinHousehold(code) {
  const { data, error } = await core.rpc('join_household', { invite: String(code || '').trim() });
  fail(error);
  forgetHousehold();
  return data;
}

/** The household's code (owners only); the same code until someone makes a new one. */
export async function householdCode(hid) {
  const { data, error } = await core.rpc('create_invite', { hid });
  fail(error);
  return data;
}

export async function newHouseholdCode(hid) {
  const { data, error } = await core.rpc('reset_invite', { hid });
  fail(error);
  return data;
}
