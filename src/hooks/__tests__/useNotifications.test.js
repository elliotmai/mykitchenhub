// In-app alerts are the channel that always works — with no SMS provider key
// configured, this is how the daily waste alert reaches anyone.

import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';

import useNotifications from '../useNotifications';
import { AuthProvider } from '../useAuth';
import * as fs from '../../test-utils/mocks/firestore';
import * as authMock from '../../test-utils/mocks/auth';
import { asDocs, makeNotification, makeUserProfile } from '../../test-utils/factories';

const UID = 'test-uid';
const NOTIFICATIONS_PATH = `users/${UID}/notifications`;

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

const renderNotifications = async (notifications = [], options) => {
  authMock.__setUser(authMock.__user({ uid: UID }));
  fs.getDoc.mockResolvedValue(fs.__doc(UID, makeUserProfile()));

  const view = renderHook(() => useNotifications(options), { wrapper });
  await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
  await act(async () => {
    fs.__emit(NOTIFICATIONS_PATH, asDocs(notifications));
  });
  return view;
};

describe('useNotifications subscription', () => {
  it("subscribes to the signed-in user's notifications, newest first", async () => {
    const { result } = await renderNotifications([
      makeNotification({ id: 'n-1', title: 'Today' }),
      makeNotification({ id: 'n-2', title: 'Yesterday' }),
    ]);

    expect(result.current.notifications).toHaveLength(2);
    expect(fs.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
  });

  it('filters to one kind of alert when asked', async () => {
    const { result } = await renderNotifications(
      [
        makeNotification({ id: 'n-1', type: 'waste-alert' }),
        makeNotification({ id: 'n-2', type: 'system' }),
      ],
      { type: 'waste-alert' }
    );

    expect(result.current.notifications.map((n) => n.id)).toEqual(['n-1']);
  });

  it('counts the unread ones for the badge', async () => {
    const { result } = await renderNotifications([
      makeNotification({ id: 'n-1', read: false }),
      makeNotification({ id: 'n-2', read: true }),
      makeNotification({ id: 'n-3', read: false }),
    ]);

    expect(result.current.unreadCount).toBe(2);
  });

  it('does not subscribe when signed out', async () => {
    authMock.__setUser(null);
    const { result } = renderHook(() => useNotifications(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notifications).toEqual([]);
    expect(fs.onSnapshot).not.toHaveBeenCalled();
  });

  it('surfaces a listener failure rather than spinning forever', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = await renderNotifications([]);

    await act(async () => {
      fs.__emitError(NOTIFICATIONS_PATH, new Error('permission-denied'));
    });

    expect(result.current.error).toBe('Failed to load notifications');
    expect(result.current.loading).toBe(false);
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = await renderNotifications([]);
    expect(fs.__listenerCount(NOTIFICATIONS_PATH)).toBe(1);

    unmount();
    expect(fs.__listenerCount(NOTIFICATIONS_PATH)).toBe(0);
  });
});

describe('useNotifications.markAsRead', () => {
  it('marks the addressed alert read without touching when it arrived', async () => {
    const { result } = await renderNotifications([makeNotification({ id: 'n-1' })]);

    await act(async () => {
      await result.current.markAsRead('n-1');
    });

    const [ref, patch] = fs.updateDoc.mock.calls[0];
    expect(fs.pathOf(ref)).toBe(`${NOTIFICATIONS_PATH}/n-1`);
    expect(patch).toEqual({ read: true });
  });

  it('refuses to write when signed out', async () => {
    authMock.__setUser(null);
    const { result } = renderHook(() => useNotifications(), { wrapper });

    let response;
    await act(async () => {
      response = await result.current.markAsRead('n-1');
    });

    expect(response).toEqual({ success: false, error: 'Not authenticated' });
    expect(fs.updateDoc).not.toHaveBeenCalled();
  });

  it('reports the failure rather than throwing', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = await renderNotifications([makeNotification({ id: 'n-1' })]);
    fs.updateDoc.mockRejectedValueOnce(new Error('offline'));

    let response;
    await act(async () => {
      response = await result.current.markAsRead('n-1');
    });

    expect(response).toEqual({ success: false, error: 'offline' });
  });
});

describe('useNotifications.dismiss', () => {
  it('deletes the addressed alert', async () => {
    const { result } = await renderNotifications([makeNotification({ id: 'n-1' })]);

    let response;
    await act(async () => {
      response = await result.current.dismiss('n-1');
    });

    expect(response.success).toBe(true);
    expect(fs.pathOf(fs.deleteDoc.mock.calls[0][0])).toBe(`${NOTIFICATIONS_PATH}/n-1`);
  });

  it('reports the failure rather than throwing', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = await renderNotifications([makeNotification({ id: 'n-1' })]);
    fs.deleteDoc.mockRejectedValueOnce(new Error('offline'));

    let response;
    await act(async () => {
      response = await result.current.dismiss('n-1');
    });

    expect(response).toEqual({ success: false, error: 'offline' });
  });
});
