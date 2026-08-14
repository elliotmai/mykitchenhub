// The recipe count is read from a collection another roadmap phase owns, so the
// interesting cases are all about it not being there yet.

import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import useRecipeCount from '../useRecipeCount';
import { AuthProvider } from '../useAuth';
import * as fs from '../../test-utils/mocks/firestore';
import * as authMock from '../../test-utils/mocks/auth';
import { asDocs, makeRecipe, makeUserProfile } from '../../test-utils/factories';

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
    expect(result.current.error).toBe('Failed to load recipes');
  });

  it('does not touch Firestore when signed out', async () => {
    const { result } = await renderCount({ signedIn: false });

    expect(result.current.count).toBe(0);
    expect(fs.getCountFromServer).not.toHaveBeenCalled();
    expect(fs.getDocs).not.toHaveBeenCalled();
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
