// Storage locations own the safety rule that stops a user deleting a shelf
// that still has food on it, so the delete guard gets the most attention here.

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';

import useStorageLocations from '../useStorageLocations';
import { AuthProvider } from '../useAuth';
import * as fs from '../../test-utils/mocks/firestore';
import * as authMock from '../../test-utils/mocks/auth';
import { asDocs, makeLocation, makeItem, makeUserProfile } from '../../test-utils/factories';
import { expectHumanError } from '../../test-utils/humanErrors';

const UID = 'test-uid';
const LOCATIONS_PATH = `users/${UID}/storageLocations`;
const INVENTORY_PATH = `users/${UID}/inventory`;

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

const renderLocations = async (locations = []) => {
  authMock.__setUser(authMock.__user({ uid: UID }));
  fs.getDoc.mockResolvedValue(fs.__doc(UID, makeUserProfile()));

  const view = renderHook(() => useStorageLocations(), { wrapper });
  await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
  await act(async () => {
    fs.__emit(LOCATIONS_PATH, asDocs(locations));
  });
  return view;
};

describe('useStorageLocations subscription', () => {
  it("exposes the user's locations ordered by their display order", async () => {
    const { result } = await renderLocations([
      makeLocation({ id: 'l1', label: 'Fridge', order: 0 }),
      makeLocation({ id: 'l2', label: 'Freezer', type: 'freezer', order: 1 }),
    ]);

    expect(result.current.locations.map((l) => l.label)).toEqual(['Fridge', 'Freezer']);
    expect(fs.orderBy).toHaveBeenCalledWith('order', 'asc');
    expect(result.current.loading).toBe(false);
  });

  it('stays empty and silent when signed out', async () => {
    authMock.__setUser(null);
    const { result } = renderHook(() => useStorageLocations(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.locations).toEqual([]);
    expect(fs.onSnapshot).not.toHaveBeenCalled();
  });

  it('reports listener failures', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = await renderLocations([]);

    await act(async () => {
      fs.__emitError(LOCATIONS_PATH, new Error('permission-denied'));
    });

    expectHumanError(result.current.error, /storage locations/i);
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = await renderLocations([]);
    unmount();
    expect(fs.__listenerCount(LOCATIONS_PATH)).toBe(0);
  });
});

describe('useStorageLocations.createLocation', () => {
  it('appends the new location after the highest existing order', async () => {
    const { result } = await renderLocations([
      makeLocation({ id: 'l1', order: 0 }),
      makeLocation({ id: 'l2', order: 3 }),
    ]);

    await act(async () => {
      await result.current.createLocation({
        label: 'Garage Freezer',
        type: 'freezer',
        icon: '❄️',
        color: '#B8D4B8',
      });
    });

    const [ref, payload] = fs.addDoc.mock.calls[0];
    expect(fs.pathOf(ref)).toBe(LOCATIONS_PATH);
    expect(payload.order).toBe(4);
    expect(payload.isDefault).toBe(false);
    expect(payload.itemCount).toBe(0);
    expect(payload.label).toBe('Garage Freezer');
  });

  it('starts ordering at 0 when there are no locations yet', async () => {
    const { result } = await renderLocations([]);

    await act(async () => {
      await result.current.createLocation({
        label: 'Pantry',
        type: 'pantry',
        icon: '🏺',
        color: '#fff',
      });
    });

    expect(fs.addDoc.mock.calls[0][1].order).toBe(0);
  });

  it('refuses to write when signed out', async () => {
    authMock.__setUser(null);
    const { result } = renderHook(() => useStorageLocations(), { wrapper });

    let response;
    await act(async () => {
      response = await result.current.createLocation({ label: 'X', type: 'fridge' });
    });

    expect(response).toEqual({ success: false, error: 'Not authenticated' });
    expect(fs.addDoc).not.toHaveBeenCalled();
  });
});

describe('useStorageLocations.deleteLocation safety checks', () => {
  it('refuses to delete a default location', async () => {
    const { result } = await renderLocations([makeLocation({ id: 'l1', isDefault: true })]);

    let response;
    await act(async () => {
      response = await result.current.deleteLocation('l1');
    });

    expect(response).toEqual({ success: false, error: 'Cannot delete a default location.' });
    expect(fs.deleteDoc).not.toHaveBeenCalled();
  });

  it('refuses to delete a location that still holds items, and says how many', async () => {
    const { result } = await renderLocations([makeLocation({ id: 'l1', isDefault: false })]);

    fs.getDocs.mockResolvedValueOnce(
      fs.__querySnapshot(
        asDocs([
          makeItem({ id: 'i1', locationId: 'l1' }),
          makeItem({ id: 'i2', locationId: 'l1' }),
          makeItem({ id: 'i3', locationId: 'other' }),
        ])
      )
    );

    let response;
    await act(async () => {
      response = await result.current.deleteLocation('l1');
    });

    expect(response.success).toBe(false);
    expect(response.itemCount).toBe(2);
    expect(response.error).toMatch(/2 item\(s\)/);
    expect(fs.deleteDoc).not.toHaveBeenCalled();
  });

  it('deletes an empty, non-default location', async () => {
    const { result } = await renderLocations([makeLocation({ id: 'l1', isDefault: false })]);
    fs.getDocs.mockResolvedValueOnce(fs.__querySnapshot([]));

    let response;
    await act(async () => {
      response = await result.current.deleteLocation('l1');
    });

    expect(response).toEqual({ success: true });
    expect(fs.pathOf(fs.deleteDoc.mock.calls[0][0])).toBe(`${LOCATIONS_PATH}/l1`);
  });

  it('checks the inventory collection before deleting', async () => {
    const { result } = await renderLocations([makeLocation({ id: 'l1', isDefault: false })]);
    fs.getDocs.mockResolvedValueOnce(fs.__querySnapshot([]));

    await act(async () => {
      await result.current.deleteLocation('l1');
    });

    expect(fs.pathOf(fs.getDocs.mock.calls[0][0])).toBe(INVENTORY_PATH);
  });
});

describe('useStorageLocations lookups', () => {
  it('finds a location by id and returns null when absent', async () => {
    const { result } = await renderLocations([makeLocation({ id: 'l1', label: 'Fridge' })]);

    expect(result.current.getLocationById('l1').label).toBe('Fridge');
    expect(result.current.getLocationById('nope')).toBeNull();
  });

  it('filters locations by type', async () => {
    const { result } = await renderLocations([
      makeLocation({ id: 'l1', type: 'fridge' }),
      makeLocation({ id: 'l2', type: 'freezer' }),
      makeLocation({ id: 'l3', type: 'freezer' }),
    ]);

    expect(result.current.getLocationsByType('freezer')).toHaveLength(2);
    expect(result.current.getLocationsByType('pantry')).toEqual([]);
  });
});
