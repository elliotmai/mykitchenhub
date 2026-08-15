// The legacy sync dashboard's data source. The security rules make this
// document read-only from the client, so the hook is a listener plus one
// callable — and the callable is the thing that spends money, which is why the
// batch size and dry-run flag are always sent explicitly.

import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';

import useSyncStatus, {
  SYNC_DOC_ID,
  EMPTY_SYNC_STATUS,
  syncProgressPercent,
} from '../useSyncStatus';
import { AuthProvider } from '../useAuth';
import * as fs from '../../test-utils/mocks/firestore';
import * as fns from '../../test-utils/mocks/functions';
import * as authMock from '../../test-utils/mocks/auth';
import { makeUserProfile, makeSyncMetadata } from '../../test-utils/factories';

const UID = 'test-uid';
const SYNC_PATH = `syncMetadata/${SYNC_DOC_ID}`;

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

const renderSyncStatus = async (metadata) => {
  authMock.__setUser(authMock.__user({ uid: UID }));
  fs.getDoc.mockResolvedValue(fs.__doc(UID, makeUserProfile()));

  const view = renderHook(() => useSyncStatus(), { wrapper });
  await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());

  if (metadata !== undefined) {
    const { id, ...data } = metadata ?? {};
    await act(async () => {
      fs.__emitDoc(SYNC_PATH, SYNC_DOC_ID, metadata === null ? null : data);
    });
  }

  return view;
};

describe('syncProgressPercent', () => {
  it('reports the share of recipes processed', () => {
    expect(syncProgressPercent({ recipesToProcess: 200, recipesProcessed: 50 })).toBe(25);
  });

  it('is zero before the first run, rather than NaN', () => {
    expect(syncProgressPercent({ recipesToProcess: 0, recipesProcessed: 0 })).toBe(0);
    expect(syncProgressPercent(undefined)).toBe(0);
  });

  it('never exceeds 100, even if the totals drift', () => {
    expect(syncProgressPercent({ recipesToProcess: 10, recipesProcessed: 40 })).toBe(100);
  });
});

describe('useSyncStatus subscription', () => {
  it('reads the fixed metadata document the function writes', async () => {
    await renderSyncStatus();

    expect(fs.pathOf(fs.onSnapshot.mock.calls[0][0])).toBe(SYNC_PATH);
  });

  it('exposes the stored progress', async () => {
    const { result } = await renderSyncStatus(makeSyncMetadata());

    expect(result.current.status.recipesImported).toBe(35);
    expect(result.current.status.costAccumulated).toBe(1.25);
    expect(result.current.progress).toBe(40);
    expect(result.current.loading).toBe(false);
  });

  it('shows an empty state before the sync has ever run', async () => {
    const { result } = await renderSyncStatus(null);

    expect(result.current.status).toEqual(EMPTY_SYNC_STATUS);
  });

  it('fills in the fields an older metadata document is missing', async () => {
    const { result } = await renderSyncStatus({ currentStatus: 'in-progress' });

    expect(result.current.status.currentStatus).toBe('in-progress');
    expect(result.current.status.instructionSources).toEqual({ spoonacular: 0, ai_generated: 0 });
  });

  it('does not subscribe when signed out', async () => {
    authMock.__setUser(null);
    const { result } = renderHook(() => useSyncStatus(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fs.onSnapshot).not.toHaveBeenCalled();
  });

  it('surfaces a read failure', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = await renderSyncStatus();

    await act(async () => {
      fs.__emitError(SYNC_PATH, new Error('permission-denied'));
    });

    expect(result.current.error).toMatch(/could not read/i);
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = await renderSyncStatus();
    expect(fs.__listenerCount(SYNC_PATH)).toBe(1);

    unmount();
    expect(fs.__listenerCount(SYNC_PATH)).toBe(0);
  });
});

describe('useSyncStatus.runBatch', () => {
  it('calls the sync function with an explicit batch size', async () => {
    const { result } = await renderSyncStatus(makeSyncMetadata());
    fns.__callable('syncLegacyRecipes').mockResolvedValue({ data: { imported: 3 } });

    await act(async () => {
      await result.current.runBatch({ limit: 5, dryRun: true });
    });

    expect(fns.__callable('syncLegacyRecipes')).toHaveBeenCalledWith({
      limit: 5,
      dryRun: true,
      restart: false,
    });
  });

  it('defaults to a small live batch rather than the whole library', async () => {
    const { result } = await renderSyncStatus(makeSyncMetadata());

    await act(async () => {
      await result.current.runBatch();
    });

    const [args] = fns.__callable('syncLegacyRecipes').mock.calls[0];
    expect(args.limit).toBeLessThanOrEqual(10);
  });

  it('passes the restart flag through', async () => {
    const { result } = await renderSyncStatus(makeSyncMetadata());

    await act(async () => {
      await result.current.runBatch({ restart: true });
    });

    expect(fns.__callable('syncLegacyRecipes').mock.calls[0][0].restart).toBe(true);
  });

  it('keeps the result of the last run for the dashboard to show', async () => {
    const { result } = await renderSyncStatus(makeSyncMetadata());
    fns.__callable('syncLegacyRecipes').mockResolvedValue({
      data: { imported: 3, skipped: 1, cost: 0.05, dryRun: false },
    });

    await act(async () => {
      await result.current.runBatch({ limit: 5 });
    });

    expect(result.current.lastResult).toMatchObject({ imported: 3, cost: 0.05 });
    expect(result.current.running).toBe(false);
  });

  it('reports a failed run instead of throwing', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = await renderSyncStatus(makeSyncMetadata());
    fns.__failCallable('syncLegacyRecipes', new Error('permission-denied'));

    let response;
    await act(async () => {
      response = await result.current.runBatch({ limit: 5 });
    });

    expect(response.success).toBe(false);
    expect(result.current.error).toMatch(/permission-denied/);
    expect(result.current.running).toBe(false);
  });
});
