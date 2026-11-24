// src/backend/functions.js
// The callables KitchenHub used (generateMealPlan, syncLegacyRecipes, the
// Connected apps tokens) now run as Netlify functions on this site, under
// /api/<name>, and are called with the signed-in person's Supabase token.

import { accessToken } from './supabase';

const FUNCTIONS = { kind: 'functions' };
export const getFunctions = () => FUNCTIONS;

export const API_BASE = '/api';

export function httpsCallable(_functions, name) {
  return async (data = {}) => {
    const token = await accessToken();
    let res;
    try {
      res = await fetch(`${API_BASE}/${name}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ data }),
      });
    } catch (err) {
      throw Object.assign(new Error('Could not reach KitchenHub.'), {
        code: 'functions/unavailable',
      });
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) {
      const status = body.error?.status || 'internal';
      throw Object.assign(new Error(body.error?.message || 'Something went wrong.'), {
        code: `functions/${status}`,
        details: body.error?.details,
      });
    }
    return { data: body.result };
  };
}
