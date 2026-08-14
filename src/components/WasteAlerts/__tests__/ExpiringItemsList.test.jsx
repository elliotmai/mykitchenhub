// The at-risk list and the count above it — the two things a cook reads first.

import React from 'react';
import { render, screen } from '@testing-library/react';

import ExpiringItemsList from '../ExpiringItemsList';
import ExpirationSummary from '../ExpirationSummary';
import WasteAlertNotifications from '../WasteAlertNotifications';
import userEvent from '@testing-library/user-event';
import {
  makeItem,
  makeLocation,
  makeNotification,
  daysFromNow,
} from '../../../test-utils/factories';

describe('ExpiringItemsList', () => {
  it('shows what each item is, where it lives and how long it has', () => {
    render(
      <ExpiringItemsList
        items={[
          makeItem({
            id: 'a',
            name: 'Spinach',
            quantity: 1,
            unit: 'bag',
            locationId: 'loc-fridge',
            expiresAt: daysFromNow(1),
          }),
        ]}
        locations={[makeLocation({ id: 'loc-fridge', label: 'Main Fridge', icon: '🧊' })]}
      />
    );

    expect(screen.getByText('Spinach')).toBeInTheDocument();
    expect(screen.getByText(/1 bag/)).toBeInTheDocument();
    expect(screen.getByText(/Main Fridge/)).toBeInTheDocument();
    expect(screen.getByText('Expires tomorrow')).toBeInTheDocument();
  });

  it('colour-codes each row by urgency', () => {
    const { container } = render(
      <ExpiringItemsList
        items={[
          makeItem({ id: 'a', name: 'Old Yogurt', expiresAt: daysFromNow(-2) }),
          makeItem({ id: 'b', name: 'Spinach', expiresAt: daysFromNow(4) }),
        ]}
      />
    );

    expect(container.querySelector('.expiration-critical')).toBeInTheDocument();
    expect(container.querySelector('.expiration-warning')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('Soon')).toBeInTheDocument();
  });

  it('falls back to the location type when the location document is missing', () => {
    render(
      <ExpiringItemsList items={[makeItem({ locationType: 'pantry', locationId: 'gone' })]} />
    );
    expect(screen.getByText(/pantry/)).toBeInTheDocument();
  });

  it('celebrates an empty list rather than showing a bare table', () => {
    render(<ExpiringItemsList items={[]} />);
    expect(screen.getByText(/Nothing is about to go off/)).toBeInTheDocument();
  });
});

describe('ExpirationSummary', () => {
  it('counts each urgency band', () => {
    render(<ExpirationSummary counts={{ expired: 2, critical: 1, warning: 3, total: 6 }} />);

    expect(screen.getByTestId('summary-expired')).toHaveTextContent('2');
    expect(screen.getByTestId('summary-critical')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-warning')).toHaveTextContent('3');
  });

  it('shows zeroes rather than blanks when there is nothing at risk', () => {
    render(<ExpirationSummary counts={undefined} />);
    expect(screen.getByTestId('summary-expired')).toHaveTextContent('0');
  });
});

describe('WasteAlertNotifications', () => {
  it('renders nothing at all when there are no alerts', () => {
    const { container } = render(<WasteAlertNotifications notifications={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('flags unread alerts and says when a text also went out', () => {
    render(
      <WasteAlertNotifications
        notifications={[
          makeNotification({ id: 'n-1', title: '2 items to use up soon', channel: 'sms' }),
        ]}
      />
    );

    expect(screen.getByText('2 items to use up soon')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText(/also sent by text/)).toBeInTheDocument();
  });

  it('marks one read and dismisses another', async () => {
    const onMarkRead = jest.fn();
    const onDismiss = jest.fn();
    render(
      <WasteAlertNotifications
        notifications={[makeNotification({ id: 'n-1', title: 'Use it up' })]}
        onMarkRead={onMarkRead}
        onDismiss={onDismiss}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /Mark "Use it up" as read/ }));
    expect(onMarkRead).toHaveBeenCalledWith('n-1');

    await userEvent.click(screen.getByRole('button', { name: /Dismiss "Use it up"/ }));
    expect(onDismiss).toHaveBeenCalledWith('n-1');
  });

  it('offers no "mark read" button for an alert already read', () => {
    render(
      <WasteAlertNotifications
        notifications={[makeNotification({ id: 'n-1', title: 'Seen it', read: true })]}
      />
    );

    expect(screen.queryByRole('button', { name: /as read/ })).not.toBeInTheDocument();
    expect(screen.queryByText('New')).not.toBeInTheDocument();
  });
});
