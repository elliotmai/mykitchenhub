// src/timers/ringer.js
// The sound, buzz and notification of a finished timer.
//
// Browsers only let a page make sound after the person has touched it, so
// `unlockAudio()` runs on the first tap anywhere (and on the tap that starts
// a timer) and keeps one AudioContext ready. The chime is made with Web Audio
// rather than a file: nothing to download, nothing to fail to load offline.
// It is three rising notes, bright and round rather than harsh, repeated
// every couple of seconds until the timer is stopped.

const NOTES = [784, 988, 1319]; // G5, B5, E6
const NOTE_S = 0.22;
const REPEAT_MS = 2200;
const BUZZ = [400, 150, 400];

let ctx = null;

const AudioCtor = () =>
  typeof window === 'undefined' ? null : window.AudioContext || window.webkitAudioContext || null;

/** Make sound possible from now on. Call it from a tap. Never throws. */
export function unlockAudio() {
  try {
    const Ctor = AudioCtor();
    if (!Ctor) return false;
    if (!ctx) ctx = new Ctor();
    if (ctx.state === 'suspended') ctx.resume();
    // A silent blip: some browsers only count audio started inside the tap.
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.connect(gain);
    osc.start();
    osc.stop(ctx.currentTime + 0.01);
    return true;
  } catch {
    return false;
  }
}

/** Whether a chime would be heard right now (audio has been unlocked). */
export const audioReady = () => Boolean(ctx && ctx.state === 'running');

/** One chime. */
export function chime() {
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended') ctx.resume();
    const start = ctx.currentTime + 0.02;
    NOTES.forEach((freq, i) => {
      const t = start + i * NOTE_S;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + NOTE_S * 1.8);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + NOTE_S * 2);
    });
    return true;
  } catch {
    return false;
  }
}

/** A buzz on phones that can. */
export function buzz() {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
      ? navigator.vibrate(BUZZ)
      : false;
  } catch {
    return false;
  }
}

/**
 * Ring until the returned function is called: a chime and a buzz now and
 * every REPEAT_MS.
 */
export function startRinging({ repeatMs = REPEAT_MS } = {}) {
  const ring = () => {
    chime();
    buzz();
  };
  ring();
  const id = setInterval(ring, repeatMs);
  return () => {
    clearInterval(id);
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(0);
      }
    } catch {
      /* nothing to stop */
    }
  };
}

const canNotify = () => typeof window !== 'undefined' && 'Notification' in window;

/** Ask once, from a tap, so a finished timer can also show as a system notification. */
export function askToNotify() {
  try {
    if (canNotify() && window.Notification.permission === 'default') {
      return window.Notification.requestPermission();
    }
  } catch {
    /* some browsers throw outside a secure context */
  }
  return Promise.resolve(canNotify() ? window.Notification.permission : 'unsupported');
}

/** A system notification for a finished timer, when allowed. Returns it, or null. */
export function notifyDone(timer) {
  try {
    if (!canNotify() || window.Notification.permission !== 'granted') return null;
    return new window.Notification(`${timer.label} is done`, {
      body: 'Tap to stop the timer.',
      tag: `kitchen-timer-${timer.id}`,
      requireInteraction: true,
      renotify: true,
    });
  } catch {
    return null;
  }
}

/** Tests only: forget the AudioContext. */
export const __resetRinger = () => {
  ctx = null;
};
