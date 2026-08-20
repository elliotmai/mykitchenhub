// The update card. The half worth testing is what it looks like *while* the
// update runs — it used to vanish the instant you tapped it, which on a slow
// tablet is indistinguishable from a button that does nothing.

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import UpdateNotification from '../UpdateNotification';
import { KIOSK_MODE_KEY } from '../../utils/kioskMode';

const setup = (props = {}) => {
  const onUpdate = jest.fn();
  const onDismiss = jest.fn();
  const utils = render(
    <UpdateNotification show onUpdate={onUpdate} onDismiss={onDismiss} {...props} />
  );
  return { ...utils, onUpdate, onDismiss };
};

afterEach(() => {
  window.localStorage.removeItem(KIOSK_MODE_KEY);
});

it('renders nothing when there is no update', () => {
  const { container } = render(
    <UpdateNotification show={false} onUpdate={jest.fn()} onDismiss={jest.fn()} />
  );

  expect(container).toBeEmptyDOMElement();
});

it('offers the update, with a way to put it off', () => {
  setup();

  expect(screen.getByText('Update Available')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /update now/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /later/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
});

describe('while the update is running', () => {
  it('stays on screen and says what it is doing', () => {
    setup({ updating: true, stage: 'activating' });

    expect(screen.getByText('Updating')).toBeInTheDocument();
    expect(screen.getByText(/switching to the new version/i)).toBeInTheDocument();
  });

  it('names each stage as it reaches it', () => {
    const { rerender } = setup({ updating: true, stage: 'activating' });
    expect(screen.getByText(/switching to the new version/i)).toBeInTheDocument();

    rerender(<UpdateNotification show updating stage="clearing" />);
    expect(screen.getByText(/clearing out the old files/i)).toBeInTheDocument();

    rerender(<UpdateNotification show updating stage="reloading" />);
    expect(screen.getByText(/reloading/i)).toBeInTheDocument();
  });

  it('fills a progress bar that only ever moves forwards', () => {
    const { rerender } = setup({ updating: true, stage: 'activating' });
    const at = () => Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'));

    const first = at();
    rerender(<UpdateNotification show updating stage="clearing" />);
    const second = at();
    rerender(<UpdateNotification show updating stage="reloading" />);
    const third = at();

    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(third).toBe(100);
  });

  it('takes away the buttons, so the update cannot be started twice or cancelled', () => {
    setup({ updating: true, stage: 'activating' });

    expect(screen.queryByRole('button', { name: /update now/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /later/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
  });

  it('announces itself to a screen reader as busy', () => {
    setup({ updating: true, stage: 'activating' });

    expect(screen.getByRole('alert')).toHaveAttribute('aria-busy', 'true');
  });

  it('still shows something before the first stage arrives', () => {
    // A card reading "Updating" with a blank body is the same silence the
    // whole change is meant to remove.
    setup({ updating: true, stage: null });

    expect(screen.getByText(/starting/i)).toBeInTheDocument();
  });
});

describe('on the fridge tablet', () => {
  it('scales up, because the kiosk is read from across the room', () => {
    const { container: normal } = render(
      <UpdateNotification show onUpdate={jest.fn()} onDismiss={jest.fn()} />
    );
    const normalCard = normal.querySelector('[style*="max-width"]');
    const normalWidth = normalCard.style.maxWidth;

    window.localStorage.setItem(KIOSK_MODE_KEY, 'true');
    const { container: kiosk } = render(
      <UpdateNotification show onUpdate={jest.fn()} onDismiss={jest.fn()} />
    );
    const kioskCard = kiosk.querySelector('[style*="max-width"]');

    expect(parseInt(kioskCard.style.maxWidth, 10)).toBeGreaterThan(parseInt(normalWidth, 10));
  });

  it('keeps the buttons above the project’s 44px touch floor', () => {
    setup();

    const button = screen.getByRole('button', { name: /update now/i });
    expect(parseInt(button.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
  });
});

it('hands the tap straight to the caller', async () => {
  const user = userEvent.setup();
  const { onUpdate } = setup();

  await user.click(screen.getByRole('button', { name: /update now/i }));

  expect(onUpdate).toHaveBeenCalledTimes(1);
});

it('dismisses on both “Later” and the close button', async () => {
  const user = userEvent.setup();
  const { onDismiss } = setup();

  await user.click(screen.getByRole('button', { name: /later/i }));
  await user.click(screen.getByRole('button', { name: /dismiss/i }));

  expect(onDismiss).toHaveBeenCalledTimes(2);
});

/* An update that reloaded straight back onto the same build. Showing the same
   "Update Now" button again is what makes it read as an endless loop. */
describe('when the last update did not take', () => {
  it('says so rather than announcing the same update again', () => {
    setup({ stalled: true });

    expect(screen.getByText(/didn’t take/i)).toBeInTheDocument();
    expect(screen.getByText(/still on the old version/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/a new version of mykitchenhub is available/i)
    ).not.toBeInTheDocument();
  });

  it('offers the stronger action, not the one already tried', () => {
    setup({ stalled: true });

    expect(screen.getByRole('button', { name: /force update/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^update now$/i })).not.toBeInTheDocument();
  });

  it('warns that this one clears everything', () => {
    setup({ stalled: true });

    expect(screen.getByText(/clear everything and reinstall/i)).toBeInTheDocument();
  });

  it('can still be put off', async () => {
    const user = userEvent.setup();
    const { onDismiss } = setup({ stalled: true });

    await user.click(screen.getByRole('button', { name: /later/i }));

    expect(onDismiss).toHaveBeenCalled();
  });

  it('shows progress the same way once it starts', () => {
    setup({ stalled: true, updating: true, stage: 'reloading' });

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /force update/i })).not.toBeInTheDocument();
  });
});
