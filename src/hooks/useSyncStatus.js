// src/hooks/useSyncStatus.js
// Live view of the legacy "Let's Eat" recipe sync — Phase 4.2.
//
// The Cloud Function keeps its bookkeeping in `syncMetadata/legacy-recipe-sync`.
// The security rules let any signed-in user *read* that document and let nobody
// write it from the client, so this hook is read-only plus one callable that
// asks the function to run the next batch.
//
// Running a batch spends real money (Spoonacular quota + Claude tokens), so the
// dashboard always sends an explicit batch size and the function enforces its
// own cost ceiling on top.

import { useState, useEffect, useCallback } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../services/firebase';
import { useAuth } from './useAuth';
import { friendlyError } from '../utils/firebaseErrors';

/** Fixed document id the Cloud Function writes its progress to. */
export const SYNC_DOC_ID = 'legacy-recipe-sync';

/** Shape the dashboard renders before the function has ever run. */
export const EMPTY_SYNC_STATUS = {
  currentStatus: 'idle',
  recipesToProcess: 0,
  recipesProcessed: 0,
  recipesImported: 0,
  recipesSkipped: 0,
  instructionSources: { spoonacular: 0, ai_generated: 0 },
  costAccumulated: 0,
  costLimitUsd: null,
  lastSyncTimestamp: null,
  lastError: null,
  cursor: null,
};

/** Percentage complete, clamped to 0–100 and safe against a zero total. */
export const syncProgressPercent = (status) => {
  const total = Number(status?.recipesToProcess) || 0;
  const done = Number(status?.recipesProcessed) || 0;
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
};

/**
 * useSyncStatus
 *
 * const { status, loading, error, running, runBatch } = useSyncStatus();
 */
const useSyncStatus = () => {
  const { user } = useAuth();
  const [status, setStatus] = useState(EMPTY_SYNC_STATUS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  useEffect(() => {
    if (!user?.uid) {
      setStatus(EMPTY_SYNC_STATUS);
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, 'syncMetadata', SYNC_DOC_ID),
      (snapshot) => {
        setStatus(
          snapshot?.exists?.() ? { ...EMPTY_SYNC_STATUS, ...snapshot.data() } : EMPTY_SYNC_STATUS
        );
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error reading sync status:', err);
        setError(friendlyError(err, { action: 'read the sync status' }));
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  /**
   * Ask the Cloud Function to process the next batch.
   *
   * @param {object}  options
   * @param {number}  options.limit   - how many legacy recipes to attempt
   * @param {boolean} options.dryRun  - report what would happen, write nothing
   * @param {boolean} options.restart - ignore the saved cursor and start over
   */
  const runBatch = useCallback(async ({ limit = 10, dryRun = false, restart = false } = {}) => {
    setRunning(true);
    setError(null);

    try {
      const callable = httpsCallable(functions, 'syncLegacyRecipes');
      const response = await callable({ limit, dryRun, restart });
      const data = response?.data ?? {};

      setLastResult(data);
      setRunning(false);
      return { success: true, data };
    } catch (err) {
      console.error('Error starting the legacy sync:', err);
      const message = err?.message || 'Could not start the sync.';
      setError(message);
      setRunning(false);
      return { success: false, error: message };
    }
  }, []);

  return {
    status,
    loading,
    error,
    running,
    lastResult,
    runBatch,
    progress: syncProgressPercent(status),
  };
};

export default useSyncStatus;
