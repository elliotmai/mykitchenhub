// The legacy sync dashboard.
//
// This screen exists because the sync spends real money, so the tests care
// mostly about that: the running total is visible, a dry run is the default,
// and every run sends an explicit batch size rather than "everything".

import React from 'react';
import { renderWithProviders, screen, act, waitFor } from '../../../test-utils';
import * as fs from '../../../test-utils/mocks/firestore';
import * as fns from '../../../test-utils/mocks/functions';
import { makeSyncMetadata } from '../../../test-utils/factories';
import SyncDashboard, { formatSyncTime, formatUsd } from '../SyncDashboard';

const SYNC_PATH = 'syncMetadata/legacy-recipe-sync';

/** Render the dashboard and deliver one metadata snapshot. */
const renderDashboard = async (metadata = makeSyncMetadata()) => {
  const view = renderWithProviders(<SyncDashboard show onHide={jest.fn()} />);

  await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
  const { id, ...data } = metadata ?? {};
  await act(async () => {
    fs.__emitDoc(SYNC_PATH, 'legacy-recipe-sync', metadata === null ? null : data);
  });

  return view;
};

describe('formatUsd', () => {
  it('shows money as money', () => {
    expect(formatUsd(1.5)).toBe('$1.50');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(undefined)).toBe('$0.00');
  });
});

describe('formatSyncTime', () => {
  it('says "Never" rather than "Invalid Date" before the first run', () => {
    expect(formatSyncTime(null)).toBe('Never');
    expect(formatSyncTime('nonsense')).toBe('Never');
  });

  it('formats a Firestore timestamp', () => {
    const date = new Date('2026-08-01T10:00:00.000Z');
    expect(formatSyncTime({ toDate: () => date })).toBe(date.toLocaleString());
  });
});

describe('SyncDashboard', () => {
  it('shows the current status', async () => {
    await renderDashboard(makeSyncMetadata({ currentStatus: 'in-progress' }));

    expect(screen.getByText('in-progress')).toBeInTheDocument();
  });

  it('shows progress through the legacy library', async () => {
    await renderDashboard(makeSyncMetadata({ recipesToProcess: 200, recipesProcessed: 50 }));

    expect(screen.getByLabelText('Sync progress')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('breaks down where the instructions came from', async () => {
    await renderDashboard(
      makeSyncMetadata({ instructionSources: { spoonacular: 320, ai_generated: 60 } })
    );

    expect(screen.getByText('320')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
  });

  it('leads with what has been spent, against the ceiling', async () => {
    await renderDashboard(makeSyncMetadata({ costAccumulated: 8.5, costLimitUsd: 10 }));

    expect(screen.getByText(/\$8\.50 of \$10\.00/)).toBeInTheDocument();
  });

  it('surfaces the last error', async () => {
    await renderDashboard(makeSyncMetadata({ lastError: 'Stopped at the $10 ceiling.' }));

    expect(screen.getByText(/Stopped at the \$10 ceiling/)).toBeInTheDocument();
  });

  it('warns that a real run costs money', async () => {
    await renderDashboard();

    expect(screen.getByText(/costs money/i)).toBeInTheDocument();
  });

  // Defaulting to a live run would let a stray click spend real money.
  it('defaults to a dry run', async () => {
    await renderDashboard();

    expect(screen.getByLabelText(/dry run/i)).toBeChecked();
  });

  it('runs a batch with the size on screen', async () => {
    const { user } = await renderDashboard();

    await user.click(screen.getByRole('button', { name: /run batch/i }));

    await waitFor(() => expect(fns.__callable('syncLegacyRecipes')).toHaveBeenCalled());
    expect(fns.__callable('syncLegacyRecipes')).toHaveBeenCalledWith({
      limit: 10,
      dryRun: true,
      restart: false,
    });
  });

  it('sends a changed batch size', async () => {
    const { user } = await renderDashboard();

    const size = screen.getByLabelText('Recipes this batch');
    await user.clear(size);
    await user.type(size, '25');
    await user.click(screen.getByRole('button', { name: /run batch/i }));

    await waitFor(() => expect(fns.__callable('syncLegacyRecipes')).toHaveBeenCalled());
    expect(fns.__callable('syncLegacyRecipes').mock.calls[0][0].limit).toBe(25);
  });

  it('runs live once the dry-run switch is turned off', async () => {
    const { user } = await renderDashboard();

    await user.click(screen.getByLabelText(/dry run/i));
    await user.click(screen.getByRole('button', { name: /run batch/i }));

    await waitFor(() => expect(fns.__callable('syncLegacyRecipes')).toHaveBeenCalled());
    expect(fns.__callable('syncLegacyRecipes').mock.calls[0][0].dryRun).toBe(false);
  });

  it('rewinds to the first recipe on "Start over"', async () => {
    const { user } = await renderDashboard();

    await user.click(screen.getByRole('button', { name: /start over/i }));

    await waitFor(() => expect(fns.__callable('syncLegacyRecipes')).toHaveBeenCalled());
    expect(fns.__callable('syncLegacyRecipes').mock.calls[0][0].restart).toBe(true);
  });

  it('reports what the run did', async () => {
    fns.__callable('syncLegacyRecipes').mockResolvedValue({
      data: { processed: 10, imported: 8, skipped: 2, cost: 0.12, dryRun: true },
    });
    const { user } = await renderDashboard();

    await user.click(screen.getByRole('button', { name: /run batch/i }));

    // Scoped: the dry-run switch label also contains the words "Dry run".
    expect(await screen.findByText(/dry run finished/i)).toBeInTheDocument();
    expect(screen.getByText(/8 imported/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.12 spent/)).toBeInTheDocument();
  });

  it('shows a failed run instead of failing silently', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    fns.__failCallable('syncLegacyRecipes', new Error('permission-denied'));
    const { user } = await renderDashboard();

    await user.click(screen.getByRole('button', { name: /run batch/i }));

    expect(await screen.findByText(/permission-denied/)).toBeInTheDocument();
  });

  it('renders an empty state before the sync has ever run', async () => {
    await renderDashboard(null);

    expect(screen.getByText('idle')).toBeInTheDocument();
    expect(screen.getByText(/Last run: Never/)).toBeInTheDocument();
  });
});
