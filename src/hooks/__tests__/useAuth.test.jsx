// Authentication is the gate on every piece of user data. These tests cover
// session state, the sign-up path that sets up a cook's kitchen, and the
// translation of auth error codes into human text.

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useAuth, AuthProvider } from '../useAuth';
import * as authMock from '../../test-utils/mocks/auth';
import * as fs from '../../test-utils/mocks/firestore';
import { makeUserProfile } from '../../test-utils/factories';

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

const renderAuth = () => renderHook(() => useAuth(), { wrapper });

/** Signed-in session with a profile document already in Firestore. */
const withSignedInUser = (profile = makeUserProfile()) => {
  const user = authMock.__user();
  authMock.__setUser(user);
  fs.getDoc.mockResolvedValue(fs.__doc(user.uid, profile));
  return user;
};

beforeEach(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ success: true }),
  }));
});

describe('useAuth outside a provider', () => {
  it('throws a helpful error rather than returning undefined', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow(/must be used within an AuthProvider/);
  });
});

describe('session state', () => {
  it('reports a signed-out visitor once auth resolves', async () => {
    authMock.__setUser(null);
    const { result } = renderAuth();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('exposes the signed-in user and their Firestore profile', async () => {
    withSignedInUser(makeUserProfile({ displayName: 'Chef Eli' }));
    const { result } = renderAuth();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user.uid).toBe('test-uid');
    await waitFor(() => expect(result.current.userProfile?.displayName).toBe('Chef Eli'));
  });

  it('gives someone from Hive a profile the first time they open KitchenHub', async () => {
    authMock.__setUser(authMock.__user());
    fs.getDoc.mockResolvedValue(fs.__doc('test-uid', null));
    const { result } = renderAuth();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.userProfile).toMatchObject({
      email: 'cook@example.com',
      displayName: 'Test Cook',
    });
    expect(fs.setDoc.mock.calls.map(([ref]) => fs.pathOf(ref))).toContain('users/test-uid');
  });

  it('does not leave the app stuck loading when the profile read fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    authMock.__setUser(authMock.__user());
    fs.getDoc.mockRejectedValue(new Error('permission-denied'));
    const { result } = renderAuth();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('stops listening to auth changes on unmount', async () => {
    authMock.__setUser(null);
    const { unmount } = renderAuth();

    await waitFor(() => expect(authMock.__listenerCount()).toBe(1));
    unmount();
    expect(authMock.__listenerCount()).toBe(0);
  });

  it('clears the session when the user signs out elsewhere', async () => {
    withSignedInUser();
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(async () => {
      authMock.__setUser(null);
    });

    expect(result.current.user).toBeNull();
    expect(result.current.userProfile).toBeNull();
  });
});

describe('login', () => {
  it('signs in with the given credentials', async () => {
    authMock.__setUser(null);
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.login('cook@example.com', 'hunter2');
    });

    expect(authMock.signInWithEmailAndPassword).toHaveBeenCalledWith(
      expect.anything(),
      'cook@example.com',
      'hunter2'
    );
  });

  it('turns a Firebase error code into a message a person can act on', async () => {
    authMock.__setUser(null);
    authMock.signInWithEmailAndPassword.mockRejectedValueOnce(
      authMock.__authError('auth/wrong-password')
    );
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    let response;
    await act(async () => {
      response = await result.current.login('cook@example.com', 'nope');
    });

    expect(response.success).toBe(false);
    expect(response.error).toMatch(/Incorrect password/i);
    expect(response.error).not.toMatch(/auth\//);
  });

  it('has a fallback message for an unrecognised error code', async () => {
    authMock.__setUser(null);
    authMock.signInWithEmailAndPassword.mockRejectedValueOnce(
      authMock.__authError('auth/some-new-code')
    );
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    let response;
    await act(async () => {
      response = await result.current.login('cook@example.com', 'nope');
    });

    expect(response.success).toBe(false);
    expect(response.error).toMatch(/unexpected error/i);
  });
});

describe('signup', () => {
  const signUpAndCollectWrites = async () => {
    authMock.__setUser(null);
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    let response;
    await act(async () => {
      response = await result.current.signup('new@example.com', 'hunter2', 'New Cook');
    });

    const writes = fs.setDoc.mock.calls.map(([ref, data]) => ({ path: fs.pathOf(ref), data }));
    return { writes, response };
  };

  it('creates the account and sets up the kitchen', async () => {
    const { writes, response } = await signUpAndCollectWrites();

    expect(authMock.createUserWithEmailAndPassword).toHaveBeenCalledWith(
      expect.anything(),
      'new@example.com',
      'hunter2'
    );
    expect(response.success).toBe(true);
    expect(writes.filter((w) => /^users\/[^/]+$/.test(w.path))).toHaveLength(1);
    expect(writes.filter((w) => w.path.includes('/storageLocations/'))).toHaveLength(4);
  });

  it('sets the kitchen up once, though the auth listener and signup both ask', async () => {
    const { writes } = await signUpAndCollectWrites();

    expect(writes).toHaveLength(5);
  });

  it('writes storage locations under `label`, the field the screens render', async () => {
    const { writes } = await signUpAndCollectWrites();
    const locations = writes.filter((w) => w.path.includes('/storageLocations/'));

    expect(locations.length).toBeGreaterThan(0);
    locations.forEach(({ data }) => {
      expect(data.label).toBeTruthy();
      expect(data).not.toHaveProperty('name');
      ['label', 'type', 'icon', 'color', 'order', 'isDefault', 'createdAt'].forEach((field) => {
        expect(data).toHaveProperty(field);
      });
      expect(['fridge', 'freezer', 'pantry']).toContain(data.type);
    });
  });

  it('puts helloFresh at the top level of the user document', async () => {
    const { writes } = await signUpAndCollectWrites();
    const profile = writes.find((w) => /^users\/[^/]+$/.test(w.path));

    expect(profile).toBeDefined();
    ['email', 'createdAt', 'preferences', 'helloFresh'].forEach((field) => {
      expect(profile.data).toHaveProperty(field);
    });
    expect(profile.data.preferences).not.toHaveProperty('helloFresh');
  });

  it('gives each of the four shelves its own document id', async () => {
    const { writes } = await signUpAndCollectWrites();
    const paths = writes.map((w) => w.path).filter((p) => p.includes('/storageLocations/'));

    // Two shelves are `type: 'pantry'`, so the id carries the order too.
    expect(paths).toHaveLength(4);
    expect(new Set(paths).size).toBe(4);
  });

  it('leaves a household that already has shelves with the ones it has', async () => {
    fs.getDocs.mockResolvedValue(fs.__querySnapshot([fs.__doc('fridge_1', { label: 'Fridge' })]));

    const { writes } = await signUpAndCollectWrites();

    expect(writes.map((w) => w.path)).toEqual(['users/new-uid']);
  });

  it('does not overwrite a profile that is already there', async () => {
    fs.getDoc.mockResolvedValue(fs.__doc('new-uid', makeUserProfile()));

    const { writes, response } = await signUpAndCollectWrites();

    expect(writes).toHaveLength(0);
    expect(response.success).toBe(true);
  });

  it('writes nothing when it cannot tell whether a profile exists', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    fs.getDoc.mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' }));

    const { writes, response } = await signUpAndCollectWrites();

    expect(writes).toHaveLength(0);
    expect(response.success).toBe(true);
  });

  it('surfaces an already-registered email as a clear message', async () => {
    authMock.__setUser(null);
    authMock.createUserWithEmailAndPassword.mockRejectedValueOnce(
      authMock.__authError('auth/email-already-in-use')
    );
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    let response;
    await act(async () => {
      response = await result.current.signup('taken@example.com', 'hunter2');
    });

    expect(response.success).toBe(false);
    expect(response.error).toMatch(/already registered/i);
  });
});

describe('logout', () => {
  it('signs the user out', async () => {
    withSignedInUser();
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(async () => {
      await result.current.logout();
    });

    expect(authMock.signOut).toHaveBeenCalled();
    expect(result.current.user).toBeNull();
  });
});

describe('password reset', () => {
  it('sends a reset email', async () => {
    authMock.__setUser(null);
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.resetPassword('cook@example.com');
    });

    expect(authMock.sendPasswordResetEmail).toHaveBeenCalledWith(
      expect.anything(),
      'cook@example.com'
    );
  });

  it('explains when the account does not exist', async () => {
    authMock.__setUser(null);
    authMock.sendPasswordResetEmail.mockRejectedValueOnce(
      authMock.__authError('auth/user-not-found')
    );
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    let response;
    await act(async () => {
      response = await result.current.resetPassword('ghost@example.com');
    });

    expect(response.success).toBe(false);
    expect(response.error).toMatch(/No account found/i);
  });
});
