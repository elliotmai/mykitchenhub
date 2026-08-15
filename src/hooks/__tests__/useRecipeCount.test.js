// The recipe count is read from a collection another roadmap phase owns, so the
// interesting cases are all about it not being there yet.

import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import useRecipeCount from '../useRecipeCount';
import { AuthProvider } from '../useAuth';
import * as fs from '../../test-utils/mocks/firestore';
import * as authMock from '../../test-utils/mocks/auth';
import { asDocs, makeRecipe, makeUserProfile } from '../../test-utils/factories';
import { expectHumanError } from '../../test-utils/humanErrors';

const UID = 'test-uid';

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

const renderCount = async ({ signedIn = true } = {}) => {
  if (signedIn) {
    authMock.__setUser(authMock.__user({ uid: UID }));
    fs.getDoc.mockResolvedValue(fs.__doc(UID, makeUserProfile()));
  } else {
    authMock.__setUser(null);
  }

  const view = renderHook(() => useRecipeCount(), { wrapper });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
};

describe('useRecipeCount', () => {
  it('uses the server-side aggregation rather than reading every recipe', async () => {
    fs.getCountFromServer.mockResolvedValue({ data: () => ({ count: 512 }) });

    const { result } = await renderCount();

    expect(result.current.count).toBe(512);
    expect(fs.getCountFromServer).toHaveBeenCalled();
    expect(fs.getDocs).not.toHaveBeenCalled();
    expect(fs.pathOf(fs.getCountFromServer.mock.calls[0][0])).toBe('recipes');
  });

  it('falls back to counting documents when aggregation is unsupported', async () => {
    fs.getCountFromServer.mockRejectedValue(new Error('aggregation not supported'));
    fs.getDocs.mockResolvedValue(fs.__querySnapshot(asDocs([makeRecipe(), makeRecipe()])));

    const { result } = await renderCount();

    expect(result.current.count).toBe(2);
    expect(result.current.error).toBeNull();
  });

  it('reports zero when the recipe library is empty', async () => {
    fs.getCountFromServer.mockResolvedValue({ data: () => ({ count: 0 }) });

    const { result } = await renderCount();

    expect(result.current.count).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('reports zero, not a crash, when recipes cannot be read at all', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    fs.getCountFromServer.mockRejectedValue(new Error('unsupported'));
    fs.getDocs.mockRejectedValue(new Error('permission-denied'));

    const { result } = await renderCount();

    expect(result.current.count).toBe(0);
    expectHumanError(result.current.error, /recipes/i);
  });

  it('does not touch Firestore when signed out', async () => {
    const { result } = await renderCount({ signedIn: false });

    expect(result.current.count).toBe(0);
    expect(fs.getCountFromServer).not.toHaveBeenCalled();
    expect(fs.getDocs).not.toHaveBeenCalled();
  });

  it('falls back when the aggregation resolves without a usable count', async () => {
    // Some emulator builds answer the aggregation with an empty payload rather
    // than rejecting it, which would otherwise set the tile to undefined.
    fs.getCountFromServer.mockResolvedValue({ data: () => ({}) });
    fs.getDocs.mockResolvedValue(fs.__querySnapshot(asDocs([makeRecipe()])));

    const { result } = await renderCount();

    expect(result.current.count).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it('survives an aggregation response with no data() at all', async () => {
    fs.getCountFromServer.mockResolvedValue({});
    fs.getDocs.mockResolvedValue(fs.__querySnapshot(asDocs([])));

    const { result } = await renderCount();

    expect(result.current.count).toBe(0);
    expect(Number.isFinite(result.current.count)).toBe(true);
  });

  it('reports zero rather than a stale number after signing out', async () => {
    fs.getCountFromServer.mockResolvedValue({ data: () => ({ count: 7 }) });
    const { result, rerender } = await renderCount();
    expect(result.current.count).toBe(7);

    authMock.__setUser(null);
    rerender();

    await waitFor(() => expect(result.current.count).toBe(0));
    expect(result.current.error).toBeNull();
  });

  it('does not set state after unmounting, mid-read', async () => {
    // The read is async; a component unmounted while it is in flight must not
    // be written to, or React logs an update-on-unmounted warning at the user.
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    let resolveCount;
    fs.getCountFromServer.mockReturnValue(
      new Promise((resolve) => {
        resolveCount = resolve;
      })
    );

    authMock.__setUser(authMock.__user({ uid: UID }));
    fs.getDoc.mockResolvedValue(fs.__doc(UID, makeUserProfile()));
    const { unmount } = renderHook(() => useRecipeCount(), { wrapper });

    unmount();
    resolveCount({ data: () => ({ count: 9 }) });
    await waitFor(() => expect(fs.getCountFromServer).toHaveBeenCalled());

    const updateWarnings = warn.mock.calls.filter(([message]) =>
      String(message).includes("can't perform a React state update")
    );
    warn.mockRestore();

    expect(updateWarnings).toHaveLength(0);
  });

  it('re-reads on refresh', async () => {
    fs.getCountFromServer.mockResolvedValue({ data: () => ({ count: 3 }) });
    const { result } = await renderCount();
    expect(result.current.count).toBe(3);

    fs.getCountFromServer.mockResolvedValue({ data: () => ({ count: 4 }) });
    result.current.refresh();

    await waitFor(() => expect(result.current.count).toBe(4));
  });
});
