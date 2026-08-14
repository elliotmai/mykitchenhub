// useHelloFreshRecipes — the picker feed for the Add Delivery workflow.

import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import useHelloFreshRecipes, { RECIPE_LIMIT } from '../useHelloFreshRecipes';
import { AuthProvider } from '../useAuth';
import * as fs from '../../test-utils/mocks/firestore';
import * as authMock from '../../test-utils/mocks/auth';
import { asDocs, makeHelloFreshRecipe, makeUserProfile } from '../../test-utils/factories';

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

beforeEach(() => {
  const user = authMock.__user();
  authMock.__setUser(user);
  fs.getDoc.mockResolvedValue(fs.__doc(user.uid, makeUserProfile()));
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const render = () => renderHook(() => useHelloFreshRecipes(), { wrapper });

it('asks only for HelloFresh recipes, newest first, in a picker-sized batch', () => {
  render();

  expect(fs.where).toHaveBeenCalledWith('source', '==', 'hellofresh');
  expect(fs.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
  expect(fs.limit).toHaveBeenCalledWith(RECIPE_LIMIT);
});

it('exposes what the listener emits', async () => {
  const { result } = render();

  await act(async () => {
    fs.__emit('recipes', asDocs([makeHelloFreshRecipe({ id: 'r1', name: 'Sweet Chili Chicken' })]));
  });

  expect(result.current.recipes).toHaveLength(1);
  expect(result.current.recipes[0].name).toBe('Sweet Chili Chicken');
  expect(result.current.loading).toBe(false);
});

it('reports a failure rather than showing an empty picker', async () => {
  const { result } = render();

  await act(async () => {
    fs.__emitError('recipes');
  });

  expect(result.current.error).toMatch(/failed to load/i);
  expect(result.current.loading).toBe(false);
});

it('does not subscribe when signed out — the recipes rules need an account', async () => {
  authMock.__setUser(null);
  const { result } = render();

  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(result.current.recipes).toEqual([]);
  expect(fs.__listenerCount('recipes')).toBe(0);
});

it('drops the listener on unmount', async () => {
  const { unmount } = render();
  await waitFor(() => expect(fs.__listenerCount('recipes')).toBe(1));

  unmount();
  expect(fs.__listenerCount('recipes')).toBe(0);
});
