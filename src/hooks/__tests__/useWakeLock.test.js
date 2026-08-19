// src/hooks/__tests__/useWakeLock.test.js

import { renderHook, act, waitFor } from '@testing-library/react';

import useWakeLock, { isWakeLockSupported } from '../useWakeLock';

const makeSentinel = () => {
  const listeners = {};
  return {
    release: jest.fn().mockResolvedValue(undefined),
    addEventListener: jest.fn((event, fn) => {
      listeners[event] = fn;
    }),
    fire: (event) => listeners[event]?.(),
  };
};

describe('useWakeLock', () => {
  let sentinel;

  beforeEach(() => {
    sentinel = makeSentinel();
    navigator.wakeLock = { request: jest.fn().mockResolvedValue(sentinel) };
  });

  afterEach(() => {
    delete navigator.wakeLock;
    jest.restoreAllMocks();
  });

  it('reports the API as missing when the browser has none', () => {
    delete navigator.wakeLock;
    expect(isWakeLockSupported()).toBe(false);
    const { result } = renderHook(() => useWakeLock(true));
    expect(result.current.supported).toBe(false);
    expect(result.current.active).toBe(false);
  });

  it('takes the lock and says so', async () => {
    const { result } = renderHook(() => useWakeLock(true));
    await waitFor(() => expect(result.current.active).toBe(true));
    expect(navigator.wakeLock.request).toHaveBeenCalledWith('screen');
  });

  // The honest-flag case: a refusal must not look like a held screen, because
  // the board uses this to decide whether to warn about the display timeout.
  it('stays inactive and records why when the browser refuses', async () => {
    navigator.wakeLock.request = jest.fn().mockRejectedValue(new Error('denied by policy'));
    const { result } = renderHook(() => useWakeLock(true));
    await waitFor(() => expect(result.current.error).toBe('denied by policy'));
    expect(result.current.active).toBe(false);
  });

  it('goes inactive when the browser drops the lock on its own', async () => {
    const { result } = renderHook(() => useWakeLock(true));
    await waitFor(() => expect(result.current.active).toBe(true));

    act(() => sentinel.fire('release'));
    await waitFor(() => expect(result.current.active).toBe(false));
  });

  it('releases the lock on unmount, so leaving the board lets the screen sleep', async () => {
    const { result, unmount } = renderHook(() => useWakeLock(true));
    await waitFor(() => expect(result.current.active).toBe(true));

    unmount();
    await waitFor(() => expect(sentinel.release).toHaveBeenCalled());
  });

  it('asks for nothing when disabled', () => {
    renderHook(() => useWakeLock(false));
    expect(navigator.wakeLock.request).not.toHaveBeenCalled();
  });
});
