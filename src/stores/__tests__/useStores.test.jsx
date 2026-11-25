import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';

import { AuthProvider } from '../../hooks/useAuth';
import useStores from '../useStores';
import * as fs from '../../test-utils/mocks/firestore';
import * as authMock from '../../test-utils/mocks/auth';
import { makeUserProfile } from '../../test-utils/factories';

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

const setup = async () => {
  const user = authMock.__user();
  authMock.__setUser(user);
  fs.getDoc.mockResolvedValue(fs.__doc(user.uid, makeUserProfile()));
  const view = renderHook(() => useStores(), { wrapper });
  await waitFor(() => expect(fs.__listenerCount('stores')).toBeGreaterThan(0));
  await act(async () => {
    fs.__emit('stores', [fs.__doc('costco', { name: 'Costco', order: 0 })]);
    fs.__emit('itemStores', [fs.__doc('milk', { store: 'costco', name: 'Milk' })]);
  });
  return view;
};

it('knows the stores and where items are usually bought', async () => {
  const { result } = await setup();
  expect(result.current.stores).toEqual([{ id: 'costco', name: 'Costco', order: 0 }]);
  expect(result.current.usualStore('Milk')).toBe('costco');
  expect(result.current.usualStore('Bread')).toBeNull();
  expect(result.current.storeOf({ name: 'milk' })).toBe('costco');
});

it('adds a store once, and removes one', async () => {
  const { result } = await setup();
  let out;
  await act(async () => {
    out = await result.current.addStore('Costco');
  });
  expect(out.success).toBe(false);
  await act(async () => {
    out = await result.current.addStore("Trader Joe's");
  });
  expect(out).toEqual({ success: true, id: 'trader-joe-s' });
  expect(fs.setDoc).toHaveBeenCalledWith(expect.objectContaining({ path: 'stores/trader-joe-s' }), {
    name: "Trader Joe's",
    order: 1,
  });
  await act(async () => {
    out = await result.current.addStore('  ');
  });
  expect(out.success).toBe(false);
  await act(async () => {
    await result.current.removeStore('costco');
  });
  expect(fs.pathOf(fs.deleteDoc.mock.calls.at(-1)[0])).toBe('stores/costco');
});

it('remembers an item’s store, and moves a typed line there', async () => {
  const { result } = await setup();
  await act(async () => {
    await result.current.setStore({ id: 'm1', name: 'Eggs', status: 'pending' }, 'costco');
  });
  expect(fs.setDoc).toHaveBeenCalledWith(
    expect.objectContaining({ path: 'itemStores/egg' }),
    { store: 'costco', name: 'Eggs' },
    { merge: true }
  );
  expect(fs.updateDoc).toHaveBeenCalledWith(
    expect.objectContaining({ path: 'users/test-uid/shoppingItems/m1' }),
    {
      store: 'costco',
    }
  );
  await act(async () => {
    await result.current.setStore({ key: 'k', name: 'Bread' }, 'none');
  });
  expect(fs.setDoc).toHaveBeenLastCalledWith(
    expect.objectContaining({ path: 'itemStores/bread' }),
    { store: null, name: 'Bread' },
    { merge: true }
  );
  expect(fs.updateDoc).toHaveBeenCalledTimes(1);
});

it('reports a refused write', async () => {
  const { result } = await setup();
  fs.setDoc.mockRejectedValueOnce(Object.assign(new Error('no'), { code: 'permission-denied' }));
  let out;
  await act(async () => {
    out = await result.current.setStore({ name: 'Eggs' }, 'costco');
  });
  expect(out.success).toBe(false);
  fs.deleteDoc.mockRejectedValueOnce(new Error('offline'));
  await act(async () => {
    out = await result.current.removeStore('x');
  });
  expect(out.success).toBe(false);
});
