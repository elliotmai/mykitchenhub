// Connected apps' data source: three callables, no Firestore access at all —
// the rules deny the client `apiTokens/**`.

import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';

import useApiTokens from '../useApiTokens';
import { AuthProvider } from '../useAuth';
import * as fs from '../../test-utils/mocks/firestore';
import * as fns from '../../test-utils/mocks/functions';
import * as authMock from '../../test-utils/mocks/auth';
import { makeUserProfile } from '../../test-utils/factories';

const UID = 'test-uid';
const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

const signedIn = () => {
  authMock.__setUser(authMock.__user({ uid: UID }));
  fs.getDoc.mockResolvedValue(fs.__doc(UID, makeUserProfile()));
};

const entry = (extra = {}) => ({
  id: 'abcdef012345',
  label: 'Fridge Board',
  createdAt: '2026-11-17T15:00:00.000Z',
  lastUsedAt: null,
  ...extra,
});

describe('useApiTokens', () => {
  it('loads nothing, and calls nothing, when signed out', async () => {
    authMock.__setUser(null);
    const { result } = renderHook(() => useApiTokens(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tokens).toEqual([]);
    expect(fns.__callable('listApiTokens')).not.toHaveBeenCalled();
  });

  it('lists the signed-in cook’s tokens', async () => {
    signedIn();
    fns.__callable('listApiTokens').mockResolvedValue({ data: { tokens: [entry()] } });
    const { result } = renderHook(() => useApiTokens(), { wrapper });
    await waitFor(() => expect(result.current.tokens).toEqual([entry()]));
    expect(result.current.error).toBeNull();
  });

  it('treats a malformed response as an empty list', async () => {
    signedIn();
    fns.__callable('listApiTokens').mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useApiTokens(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tokens).toEqual([]);
  });

  it('adds a minted token to the top of the list, without keeping the token', async () => {
    signedIn();
    fns.__callable('listApiTokens').mockResolvedValue({
      data: { tokens: [entry({ id: '111111111111', label: 'Old' })] },
    });
    fns.__callable('createApiToken').mockResolvedValue({
      data: { ...entry(), lastUsedAt: undefined, token: 'khapp_secret' },
    });
    const { result } = renderHook(() => useApiTokens(), { wrapper });
    await waitFor(() => expect(result.current.tokens).toHaveLength(1));

    let outcome;
    await act(async () => {
      outcome = await result.current.createToken('Fridge Board');
    });

    expect(outcome).toEqual({ success: true, token: 'khapp_secret' });
    expect(result.current.tokens.map((t) => t.label)).toEqual(['Fridge Board', 'Old']);
    expect(JSON.stringify(result.current.tokens)).not.toContain('khapp_secret');
  });

  it('turns an unexpected create failure into a sentence', async () => {
    signedIn();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    fns.__failCallable(
      'createApiToken',
      Object.assign(new Error('INTERNAL'), { code: 'functions/internal' })
    );
    const { result } = renderHook(() => useApiTokens(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome;
    await act(async () => {
      outcome = await result.current.createToken('Fridge Board');
    });
    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/Something went wrong on our side/);
    console.error.mockRestore();
  });
});
