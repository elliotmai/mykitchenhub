// Toasts are the app's feedback channel for every async action, so the
// contract tested here is: it shows up, it can be dismissed, and a burst of
// them can't flood the screen.

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ToastProvider, useToast, toast, setToastRef } from '../Toast';

/** Exposes the toast API to a test via a ref-like escape hatch. */
const Harness = ({ onReady }) => {
  const api = useToast();
  React.useEffect(() => onReady(api), [api, onReady]);
  return null;
};

const setup = (providerProps = {}) => {
  let api;
  render(
    <ToastProvider {...providerProps}>
      <Harness
        onReady={(a) => {
          api = a;
        }}
      />
    </ToastProvider>
  );
  return { getApi: () => api };
};

describe('useToast', () => {
  it('throws a helpful error when used outside a provider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const Orphan = () => {
      useToast();
      return null;
    };

    expect(() => render(<Orphan />)).toThrow(/must be used within a ToastProvider/);
  });

  it.each([
    ['showSuccess', 'Item saved'],
    ['showError', 'Save failed'],
    ['showWarning', 'Running low'],
    ['showInfo', 'Sync started'],
  ])('%s displays its message', async (method, message) => {
    const { getApi } = setup();

    await act(async () => {
      getApi()[method](message);
    });

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('shows a custom title alongside the message', async () => {
    const { getApi } = setup();

    await act(async () => {
      getApi().showSuccess('Milk added', 'Inventory updated');
    });

    expect(await screen.findByText('Inventory updated')).toBeInTheDocument();
    expect(screen.getByText('Milk added')).toBeInTheDocument();
  });

  it('stacks multiple toasts', async () => {
    const { getApi } = setup();

    await act(async () => {
      getApi().showSuccess('First');
      getApi().showInfo('Second');
    });

    expect(await screen.findByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('keeps only the most recent toasts when the cap is exceeded', async () => {
    const { getApi } = setup({ maxToasts: 2 });

    await act(async () => {
      getApi().showInfo('One');
      getApi().showInfo('Two');
      getApi().showInfo('Three');
    });

    expect(screen.queryByText('One')).not.toBeInTheDocument();
    expect(await screen.findByText('Two')).toBeInTheDocument();
    expect(screen.getByText('Three')).toBeInTheDocument();
  });

  it('clears every toast on request', async () => {
    const { getApi } = setup();

    await act(async () => {
      getApi().showInfo('Temporary');
    });
    expect(await screen.findByText('Temporary')).toBeInTheDocument();

    await act(async () => {
      getApi().clearAll();
    });

    expect(screen.queryByText('Temporary')).not.toBeInTheDocument();
  });

  it('removes a toast by the id it returned', async () => {
    const { getApi } = setup();
    let id;

    await act(async () => {
      id = getApi().showInfo('Dismiss me');
    });
    expect(await screen.findByText('Dismiss me')).toBeInTheDocument();

    await act(async () => {
      getApi().removeToast(id);
    });

    expect(screen.queryByText('Dismiss me')).not.toBeInTheDocument();
  });

  it('lets the user dismiss a toast from the UI', async () => {
    const { getApi } = setup();

    await act(async () => {
      getApi().showError('Something broke');
    });
    expect(await screen.findByText('Something broke')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(screen.queryByText('Something broke')).not.toBeInTheDocument();
  });
});

describe('standalone toast helper', () => {
  it('does nothing when no provider ref is registered, rather than throwing', () => {
    setToastRef(null);
    expect(() => toast.success('ignored')).not.toThrow();
  });

  it('forwards to the registered provider once a ref is set', async () => {
    const { getApi } = setup();

    await act(async () => {
      setToastRef(getApi());
      toast.success('From outside React');
    });

    expect(await screen.findByText('From outside React')).toBeInTheDocument();
    setToastRef(null);
  });
});
