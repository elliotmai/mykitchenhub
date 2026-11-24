// src/hooks/useApiTokens.js
// Settings → Connected apps: the tokens another of the cook's apps (Fridge
// Board, say) uses to read this kitchen through the `board` API.
//
// Everything goes through three callables — listApiTokens, createApiToken,
// revokeApiToken (functions/src/apiTokens/). The security rules deny the
// client `apiTokens/**` outright, and the token is generated on the server:
// the browser only ever holds a new token long enough to show it once.

import { useState, useEffect, useCallback } from 'react';
import { httpsCallable } from '../backend/functions';
import { functions } from '../services/firebase';
import { useAuth } from './useAuth';
import { errorCode, friendlyError } from '../utils/firebaseErrors';

/**
 * The server writes its invalid-argument messages for a person ("Give the app
 * a name.", the 20-app cap), so those are shown as they are. Everything else
 * goes through the app's usual translation.
 */
const messageFor = (err, action) => {
  const code = errorCode(err);
  if (/(^|\/)invalid-argument$/.test(code) && err?.message) return err.message;
  return friendlyError(err, { action });
};

/**
 * useApiTokens
 *
 * const { tokens, loading, error, createToken, revokeToken, reload } = useApiTokens();
 *
 * tokens: [{ id, label, createdAt, lastUsedAt }] — ISO strings, newest first.
 */
const useApiTokens = () => {
  const { user } = useAuth();
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!user?.uid) {
      setTokens([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await httpsCallable(functions, 'listApiTokens')({});
      setTokens(Array.isArray(response?.data?.tokens) ? response.data.tokens : []);
      setError(null);
    } catch (err) {
      console.error('Error loading connected apps:', err);
      setError(messageFor(err, 'load your connected apps'));
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    reload();
  }, [reload]);

  /** Mint a token. Resolves `{ success, token, error }`; the token is shown once. */
  const createToken = useCallback(async (label) => {
    try {
      const response = await httpsCallable(functions, 'createApiToken')({ label });
      const { token, ...entry } = response?.data ?? {};
      setTokens((current) => [
        { lastUsedAt: null, ...entry },
        ...current.filter((t) => t.id !== entry.id),
      ]);
      return { success: true, token };
    } catch (err) {
      console.error('Error connecting an app:', err);
      return { success: false, error: messageFor(err, 'connect that app') };
    }
  }, []);

  /** Revoke by public id. Resolves `{ success, error }`. */
  const revokeToken = useCallback(async (id) => {
    try {
      await httpsCallable(functions, 'revokeApiToken')({ id });
      setTokens((current) => current.filter((t) => t.id !== id));
      return { success: true };
    } catch (err) {
      console.error('Error revoking an app:', err);
      return { success: false, error: messageFor(err, 'revoke that app') };
    }
  }, []);

  return { tokens, loading, error, createToken, revokeToken, reload };
};

export default useApiTokens;
