// src/hooks/__tests__/useIdleReturn.test.js

import { renderHook, act } from '@testing-library/react';

import useIdleReturn, { DEFAULT_IDLE_MS } from '../useIdleReturn';

describe('useIdleReturn', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('fires once the room goes quiet', () => {
    const onIdle = jest.fn();
    renderHook(() => useIdleReturn(onIdle, { idleMs: 1000 }));

    expect(onIdle).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1000));
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('starts the count again on any touch, so it never interrupts someone typing', () => {
    const onIdle = jest.fn();
    renderHook(() => useIdleReturn(onIdle, { idleMs: 1000 }));

    act(() => jest.advanceTimersByTime(900));
    act(() => window.dispatchEvent(new Event('keydown')));
    act(() => jest.advanceTimersByTime(900));
    expect(onIdle).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(200));
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all when this device is not the fridge display', () => {
    const onIdle = jest.fn();
    renderHook(() => useIdleReturn(onIdle, { idleMs: 1000, enabled: false }));

    act(() => jest.advanceTimersByTime(10_000));
    expect(onIdle).not.toHaveBeenCalled();
  });

  // A re-rendered parent hands in a new closure every time. If that restarted
  // the timer the deadline would keep moving and the board would never return.
  it('keeps counting across a re-render that changes the callback', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = renderHook(({ fn }) => useIdleReturn(fn, { idleMs: 1000 }), {
      initialProps: { fn: first },
    });

    act(() => jest.advanceTimersByTime(600));
    rerender({ fn: second });
    act(() => jest.advanceTimersByTime(400));

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('stops counting once it is unmounted', () => {
    const onIdle = jest.fn();
    const { unmount } = renderHook(() => useIdleReturn(onIdle, { idleMs: 1000 }));

    unmount();
    act(() => jest.advanceTimersByTime(5000));
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('defaults to a couple of quiet minutes', () => {
    expect(DEFAULT_IDLE_MS).toBe(120_000);
  });
});
