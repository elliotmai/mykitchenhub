// Authentication is the gate on every piece of user data. These tests cover
// session state, the sign-up path that provisions a user's kitchen via Cloud
// Functions, and the translation of Firebase error codes into human text.

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

  it('still signs the user in when the profile document is missing', async () => {
    authMock.__setUser(authMock.__user());
    fs.getDoc.mockResolvedValue(fs.__doc('test-uid', null));
    const { result } = renderAuth();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.userProfile).toBeNull();
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
  it('creates the account and provisions the kitchen via the Cloud Function', async () => {
    authMock.__setUser(null);
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signup('new@example.com', 'hunter2', 'New Cook');
    });

    expect(authMock.createUserWithEmailAndPassword).toHaveBeenCalledWith(
      expect.anything(),
      'new@example.com',
      'hunter2'
    );

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain('/onUserCreated');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toMatchObject({
      email: 'new@example.com',
      displayName: 'New Cook',
    });
  });

  // ---------------------------------------------------------------------------
  // The fallback path — roadmap 9.4
  //
  // When the Cloud Function is unreachable, signup provisions the kitchen from
  // the browser instead. That copy of the shape had drifted from
  // firestore.rules in two ways that only bite later: the kitchen it built
  // rendered with blank location names, and every document it wrote would be
  // rejected the moment step 10.2 turns production rules on.
  // ---------------------------------------------------------------------------
  describe('when the Cloud Function is unreachable', () => {
    /** Fails the provisioning call however many times withRetry attempts it. */
    const withFailingSetup = () => {
      global.fetch = jest.fn(async () => ({
        ok: false,
        json: async () => ({ error: 'boom' }),
      }));
    };

    const signUpAndCollectWrites = async () => {
      withFailingSetup();
      authMock.__setUser(null);
      const { result } = renderAuth();
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.signup('new@example.com', 'hunter2', 'New Cook');
      });

      return fs.setDoc.mock.calls.map(([ref, data]) => ({ path: fs.pathOf(ref), data }));
    };

    it('writes storage locations under `label`, the field the rules require', async () => {
      const writes = await signUpAndCollectWrites();
      const locations = writes.filter((w) => w.path.includes('/storageLocations/'));

      expect(locations.length).toBeGreaterThan(0);
      locations.forEach(({ data }) => {
        expect(data).toHaveProperty('label');
        expect(data.label).toBeTruthy();
        // `name` is what the drift wrote; the list and dropdown both read
        // `label`, so a fallback kitchen showed nameless shelves.
        expect(data).not.toHaveProperty('name');
      });
    });

    it('writes every field firestore.rules requires of a storage location', async () => {
      const writes = await signUpAndCollectWrites();
      const locations = writes.filter((w) => w.path.includes('/storageLocations/'));

      locations.forEach(({ data }) => {
        ['label', 'type', 'icon', 'color', 'order', 'isDefault', 'createdAt'].forEach((field) => {
          expect(data).toHaveProperty(field);
        });
        expect(['fridge', 'freezer', 'pantry']).toContain(data.type);
      });
    });

    it('puts helloFresh at the top level of the user document, where the rules look', async () => {
      const writes = await signUpAndCollectWrites();
      const profile = writes.find((w) => /^users\/[^/]+$/.test(w.path));

      expect(profile).toBeDefined();
      ['email', 'createdAt', 'preferences', 'helloFresh'].forEach((field) => {
        expect(profile.data).toHaveProperty(field);
      });
      expect(profile.data.preferences).not.toHaveProperty('helloFresh');
    });

    it('gives each of the four shelves its own document id', async () => {
      const writes = await signUpAndCollectWrites();
      const paths = writes.map((w) => w.path).filter((p) => p.includes('/storageLocations/'));

      // Two shelves are `type: 'pantry'`, so the id carries the order too.
      // A collision would silently leave a new cook with three shelves.
      expect(paths).toHaveLength(4);
      expect(new Set(paths).size).toBe(4);
    });
  });

  // ---------------------------------------------------------------------------
  // When the Cloud Function worked and something *after* it did not
  //
  // The read-back used to sit inside the same try as the provisioning call, so
  // a dropped connection while reading a profile that had just been created
  // successfully sent signup into the fallback — which then rewrote the
  // existing document with a fresh serverTimestamp(). firestore.rules pins
  // `createdAt` on update, so that write is refused, and a cook whose account
  // was provisioned perfectly is told signup failed. Trying again then says the
  // email is taken, which is a dead end.
  // ---------------------------------------------------------------------------
  describe('when the function succeeds but the read-back does not', () => {
    const signUp = async () => {
      authMock.__setUser(null);
      const { result } = renderAuth();
      await waitFor(() => expect(result.current.loading).toBe(false));

      let response;
      await act(async () => {
        response = await result.current.signup('new@example.com', 'hunter2', 'New Cook');
      });
      return response;
    };

    it('does not overwrite a profile the Cloud Function already created', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      // Provisioning succeeds (the default fetch mock); reading it back does not.
      fs.getDoc.mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' }));

      const response = await signUp();

      // Not a single write — there was nothing that needed writing.
      expect(fs.setDoc).not.toHaveBeenCalled();
      // And the cook is signed up, because they are.
      expect(response.success).toBe(true);
    });

    it('still provisions locally when the function reports success but wrote nothing', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      fs.getDoc.mockResolvedValue(fs.__doc('missing', undefined));

      const response = await signUp();

      const paths = fs.setDoc.mock.calls.map(([ref]) => fs.pathOf(ref));
      expect(paths.some((p) => /^users\/[^/]+$/.test(p))).toBe(true);
      expect(paths.filter((p) => p.includes('/storageLocations/'))).toHaveLength(4);
      expect(response.success).toBe(true);
    });
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
