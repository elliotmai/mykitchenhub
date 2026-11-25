import {
  __resetRinger,
  askToNotify,
  audioReady,
  buzz,
  chime,
  notifyDone,
  startRinging,
  unlockAudio,
} from '../ringer';

const makeAudio = () => {
  const made = [];
  class FakeContext {
    constructor() {
      this.state = 'suspended';
      this.currentTime = 0;
      this.destination = {};
      made.push(this);
      this.oscillators = [];
    }
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    createGain() {
      const p = { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn(), value: 1 };
      return { gain: p, connect: jest.fn() };
    }
    createOscillator() {
      const osc = {
        frequency: { setValueAtTime: jest.fn() },
        connect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
      };
      this.oscillators.push(osc);
      return osc;
    }
  }
  return { FakeContext, made };
};

beforeEach(() => {
  __resetRinger();
  jest.useRealTimers();
});

describe('sound', () => {
  it('stays quiet until a tap unlocks it, then chimes three notes', () => {
    const { FakeContext, made } = makeAudio();
    window.AudioContext = FakeContext;
    expect(chime()).toBe(false);
    expect(audioReady()).toBe(false);

    expect(unlockAudio()).toBe(true);
    expect(audioReady()).toBe(true);
    expect(made).toHaveLength(1);
    expect(chime()).toBe(true);
    // one silent blip to unlock, then the three notes
    expect(made[0].oscillators).toHaveLength(4);

    unlockAudio(); // a second tap reuses the same context
    expect(made).toHaveLength(1);
    delete window.AudioContext;
  });

  it('does nothing where there is no Web Audio', () => {
    delete window.AudioContext;
    delete window.webkitAudioContext;
    expect(unlockAudio()).toBe(false);
  });
});

describe('ringing', () => {
  it('repeats chime and buzz until stopped', () => {
    jest.useFakeTimers();
    const vibrate = jest.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });

    const stop = startRinging({ repeatMs: 1000 });
    expect(vibrate).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(3000);
    expect(vibrate).toHaveBeenCalledTimes(4);

    stop();
    expect(vibrate).toHaveBeenLastCalledWith(0);
    jest.advanceTimersByTime(5000);
    expect(vibrate).toHaveBeenCalledTimes(5);
    expect(buzz()).toBe(true);
    delete navigator.vibrate;
  });
});

describe('system notifications', () => {
  afterEach(() => {
    delete window.Notification;
  });

  it('asks once, and shows one for a finished timer when allowed', async () => {
    const shown = [];
    function FakeNotification(title, options) {
      shown.push({ title, options });
    }
    FakeNotification.permission = 'default';
    FakeNotification.requestPermission = jest.fn(async () => 'granted');
    window.Notification = FakeNotification;

    await askToNotify();
    expect(FakeNotification.requestPermission).toHaveBeenCalled();
    expect(notifyDone({ id: 'a', label: 'Pasta' })).toBeNull();

    FakeNotification.permission = 'granted';
    expect(notifyDone({ id: 'a', label: 'Pasta' })).not.toBeNull();
    expect(shown[0]).toMatchObject({
      title: 'Pasta is done',
      options: { tag: 'kitchen-timer-a', requireInteraction: true },
    });
    expect(await askToNotify()).toBe('granted');
  });

  it('copes with a browser that has none', async () => {
    expect(await askToNotify()).toBe('unsupported');
    expect(notifyDone({ id: 'a', label: 'x' })).toBeNull();
  });
});
