// Settings → Connected apps. The callables are mocked; what matters here is
// the flow a cook sees: connect, copy the token once, revoke with an in-page
// confirmation, and the empty state.

import React from 'react';

import ConnectedApps, { lastUsedLabel, createdLabel } from '../ConnectedApps';
import {
  renderWithProviders,
  screen,
  waitFor,
  act,
  userEvent,
  authMock,
  functionsMock as fns,
} from '../../../test-utils';

const UID = 'test-uid';
const TOKEN = `khapp_${'x'.repeat(43)}`;

const app = (extra = {}) => ({
  id: 'abcdef012345',
  label: 'Fridge Board',
  createdAt: '2026-11-01T10:00:00.000Z',
  lastUsedAt: null,
  ...extra,
});

const renderPanel = async (tokens = []) => {
  fns.__callable('listApiTokens').mockResolvedValue({ data: { tokens } });
  const view = renderWithProviders(<ConnectedApps />, {
    route: '/settings',
    user: authMock.__user({ uid: UID }),
  });
  await waitFor(() => expect(screen.queryByText(/Loading connected apps/)).not.toBeInTheDocument());
  return view;
};

describe('lastUsedLabel', () => {
  const now = new Date('2026-11-17T15:00:00Z');

  it('says "Never used" for a token never used', () => {
    expect(lastUsedLabel(null, now)).toBe('Never used');
    expect(lastUsedLabel('not a date', now)).toBe('Never used');
  });

  it('is relative', () => {
    jest.useFakeTimers().setSystemTime(now);
    try {
      expect(lastUsedLabel('2026-11-17T13:00:00Z', now)).toBe('Last used 2 hours ago');
      expect(lastUsedLabel('2026-11-17T15:00:05Z', now)).toBe('Last used 0 seconds ago');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('createdLabel', () => {
  it('formats the date, and is blank without one', () => {
    expect(createdLabel('2026-11-01T10:00:00.000Z')).toBe('Connected 1 Nov 2026');
    expect(createdLabel(null)).toBe('');
  });
});

describe('ConnectedApps', () => {
  it('shows the empty state when nothing is connected', async () => {
    await renderPanel([]);
    expect(
      screen.getByText('No apps connected. Connect one to let another of your apps read this one.')
    ).toBeInTheDocument();
    expect(fns.__callable('listApiTokens')).toHaveBeenCalledWith({});
  });

  it('lists connected apps with when they were last used', async () => {
    await renderPanel([
      app(),
      app({ id: '111111111111', label: 'Old tablet', lastUsedAt: new Date().toISOString() }),
    ]);
    const rows = screen.getAllByTestId('connected-app');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Fridge Board');
    expect(rows[0]).toHaveTextContent('Never used');
    expect(rows[1]).toHaveTextContent(/Last used .* ago/);
  });

  it('connects an app and shows its token once, with Copy and Done', async () => {
    await renderPanel([]);
    fns.__callable('createApiToken').mockResolvedValue({
      data: {
        id: 'abcdef012345',
        label: 'Fridge Board',
        createdAt: '2026-11-17T15:00:00.000Z',
        token: TOKEN,
      },
    });
    const writeText = jest.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /Connect an app/ }));
    });
    await act(async () => {
      await userEvent.type(screen.getByLabelText('App name'), '  Fridge Board ');
      await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    });

    expect(fns.__callable('createApiToken')).toHaveBeenCalledWith({ label: 'Fridge Board' });
    const field = screen.getByLabelText('Token');
    expect(field).toHaveValue(TOKEN);
    expect(field).toHaveAttribute('readonly');
    expect(screen.getByText('Copy this now. You won’t see it again.')).toBeInTheDocument();
    expect(screen.getByTestId('connected-app')).toHaveTextContent('Fridge Board');

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /Copy/ }));
    });
    expect(writeText).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByRole('button', { name: /Copied/ })).toBeInTheDocument();

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    });
    expect(screen.queryByLabelText('Token')).not.toBeInTheDocument();
    expect(screen.queryByText(TOKEN)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Connect an app/ })).toBeInTheDocument();
  });

  it('asks for a name before calling the server', async () => {
    await renderPanel([]);
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /Connect an app/ }));
    });
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    });
    expect(screen.getByText('Give the app a name.')).toBeInTheDocument();
    expect(fns.__callable('createApiToken')).not.toHaveBeenCalled();
  });

  it('shows the server’s reason when it refuses, such as the 20-app cap', async () => {
    await renderPanel([]);
    const err = Object.assign(
      new Error('You can connect up to 20 apps. Revoke one you no longer use first.'),
      { code: 'functions/invalid-argument' }
    );
    fns.__callable('createApiToken').mockRejectedValue(err);
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /Connect an app/ }));
    });
    await act(async () => {
      await userEvent.type(screen.getByLabelText('App name'), 'One more');
      await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    });

    expect(screen.getByText(/You can connect up to 20 apps/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Token')).not.toBeInTheDocument();
    console.error.mockRestore();
  });

  it('can cancel connecting', async () => {
    await renderPanel([]);
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /Connect an app/ }));
    });
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    expect(screen.queryByLabelText('App name')).not.toBeInTheDocument();
  });

  it('revokes only after an in-page confirmation', async () => {
    await renderPanel([app()]);
    const confirm = jest.spyOn(window, 'confirm');

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    });
    expect(
      screen.getByText('Revoke Fridge Board? It stops working straight away.')
    ).toBeInTheDocument();
    expect(fns.__callable('revokeApiToken')).not.toHaveBeenCalled();

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Revoke Fridge Board' }));
    });

    expect(fns.__callable('revokeApiToken')).toHaveBeenCalledWith({ id: 'abcdef012345' });
    expect(screen.queryByTestId('connected-app')).not.toBeInTheDocument();
    expect(screen.getByText(/No apps connected/)).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('keeps the app when the cook backs out', async () => {
    await renderPanel([app()]);
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    });
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    });
    expect(screen.queryByText(/It stops working straight away/)).not.toBeInTheDocument();
    expect(fns.__callable('revokeApiToken')).not.toHaveBeenCalled();
    expect(screen.getByTestId('connected-app')).toBeInTheDocument();
  });

  it('keeps the row and says so when revoking fails', async () => {
    await renderPanel([app()]);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    fns.__failCallable(
      'revokeApiToken',
      Object.assign(new Error('x'), { code: 'functions/unavailable' })
    );

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    });
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Revoke Fridge Board' }));
    });

    expect(screen.getByTestId('connected-app')).toBeInTheDocument();
    expect(screen.getByText(/Couldn't reach the kitchen/)).toBeInTheDocument();
    console.error.mockRestore();
  });

  it('says so when the list cannot be loaded', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    fns.__failCallable(
      'listApiTokens',
      Object.assign(new Error('x'), { code: 'functions/internal' })
    );
    renderWithProviders(<ConnectedApps />, { user: authMock.__user({ uid: UID }) });

    expect(await screen.findByText(/Something went wrong on our side/)).toBeInTheDocument();
    expect(screen.queryByText(/No apps connected/)).not.toBeInTheDocument();
    console.error.mockRestore();
  });
});
