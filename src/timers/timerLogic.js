// src/timers/timerLogic.js
// Cooking timers, worked out from the clock.
//
// A timer is stored by when it ends (kitchen.timers.ends_at), never as a
// count that something has to keep running, so a reload, a closed tab or a
// different device all agree on what is left: it is always endsAt - now.
// Pure functions only, so the arithmetic is easy to trust and to test.

const MAX_SECONDS = 24 * 60 * 60;

/** A kitchen.timers row → what the screens use (endsAt in milliseconds). */
export function fromRow(row) {
  return {
    id: row.id,
    key: row.key ?? null,
    label: row.label,
    durationS: row.duration_s,
    endsAt: new Date(row.ends_at).getTime(),
  };
}

/**
 * The row to insert for a new timer, or null for a duration that cannot be
 * one (nothing, negative, over a day).
 */
export function newTimerRow({ label, minutes, seconds, key = null, now = Date.now() }) {
  const total = Math.round(seconds ?? Number(minutes) * 60);
  if (!Number.isFinite(total) || total < 1 || total > MAX_SECONDS) return null;
  const name =
    String(label ?? '')
      .trim()
      .slice(0, 120) || `${formatDuration(total)} timer`;
  return {
    key: key ? String(key).slice(0, 200) : null,
    label: name,
    duration_s: total,
    ends_at: new Date(now + total * 1000).toISOString(),
  };
}

export const remainingMs = (timer, now) => Math.max(0, timer.endsAt - now);
export const isDone = (timer, now) => now >= timer.endsAt;

/** Whole seconds left, rounded up: a timer shows 0:01 until it is done. */
export const remainingSeconds = (timer, now) => Math.ceil(remainingMs(timer, now) / 1000);

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** What a chip shows: the time left, or "Done". */
export const timerText = (timer, now) =>
  isDone(timer, now) ? 'Done' : formatDuration(remainingSeconds(timer, now));

/** Ringing first (longest ringing at the top), then by what ends soonest. */
export function sortTimers(timers, now) {
  return [...timers].sort((a, b) => {
    const da = isDone(a, now);
    const db = isDone(b, now);
    if (da !== db) return da ? -1 : 1;
    return a.endsAt - b.endsAt || String(a.id).localeCompare(String(b.id));
  });
}

/** Timers that are done and still to be stopped. */
export const ringing = (timers, now) => timers.filter((t) => isDone(t, now));

/**
 * How long until the next timer ends, for a wake-up exactly then, or null
 * when nothing is still counting down.
 */
export function msUntilNextEnd(timers, now) {
  const next = timers.filter((t) => !isDone(t, now)).map((t) => t.endsAt - now);
  return next.length ? Math.min(...next) : null;
}

/** The timer a recipe step's button started, if it is still there. */
export const timerForKey = (timers, key) => timers.find((t) => t.key === key) || null;

/** The key a recipe step's timer is stored under. */
export const stepKey = (recipeId, stepIndex) => `recipe:${recipeId}:${stepIndex}`;

/**
 * Minutes a step tells the cook to wait, or null (the same reading as the
 * fridge board's step cards, functions/src/board/recipeCards.js).
 *
 * "Roast for 15 minutes" → 15. "Simmer 10–12 min" → 10, the first moment
 * worth checking. "1 hour" → 60. Seconds are not worth a timer.
 */
const DURATION =
  /(\d+(?:\.\d+)?)\s*(?:(?:-|–|—|to)\s*\d+(?:\.\d+)?\s*)?(minutes?|mins?\b|min\b|hours?|hrs?\b|hr\b)/i;

export function stepMinutes(text) {
  const match = String(text ?? '').match(DURATION);
  if (!match) return null;
  const amount = Number(match[1]);
  const minutes = Math.round(/^h/i.test(match[2]) ? amount * 60 : amount);
  return minutes > 0 && minutes <= MAX_SECONDS / 60 ? minutes : null;
}
