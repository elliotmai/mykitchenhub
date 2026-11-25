// src/backend/sharing.js
// Planning events with people outside the household (kitchen.* sharing
// functions in Hive's Supabase project; the database enforces who sees what):
//   partner  always plans events with the household: every event, the
//            recipe book, event shopping and stores
//   event    a guest on one event
// Links and emailed invites bring people in; the household lists and
// removes them.

import { kitchen } from './supabase';

const call = async (fn, args) => {
  const { data, error } = await kitchen.rpc(fn, args);
  if (error)
    throw Object.assign(new Error(error.message || 'Something went wrong.'), { code: error.code });
  return data;
};

/** The invite link's token for partners, or for one event; `reset` stops the old one. */
export const shareLink = (kind, eventId = '', reset = false) =>
  call('share_link', { p_kind: kind, p_event: eventId || '', p_reset: reset });

/** Join with a link's token: { household_id, household, kind, event_id }. */
export const joinShare = (token) => call('join_share', { p_token: token });

export const inviteByEmail = (kind, eventId, email, canEdit = true) =>
  call('invite_by_email', {
    p_kind: kind,
    p_event: eventId || '',
    p_email: email,
    p_can_edit: canEdit,
  });

/** Take up any invites waiting for my (confirmed) email. */
export const acceptMyInvites = () => call('accept_my_invites', {});

/** [{ user_id, email, name, can_edit, pending }] */
export const sharingPeople = (kind, eventId = '') =>
  call('sharing_people', { p_kind: kind, p_event: eventId || '' });

export const setSharing = (kind, eventId, person, { canEdit = null, remove = false } = {}) =>
  call('set_sharing', {
    p_kind: kind,
    p_event: eventId || '',
    p_user: person.user_id || null,
    p_email: person.pending ? person.email : null,
    p_can_edit: canEdit,
    p_remove: remove,
  });

/** [{ household_id, household, kind, event_id, can_edit }] */
export const myShares = () => call('my_shares', {}).then((rows) => rows || []);

/** The address someone opens to join. */
export const joinUrl = (token) =>
  `${typeof window === 'undefined' ? '' : window.location.origin}/join/${token}`;
