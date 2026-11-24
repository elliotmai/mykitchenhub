/* Settings → Connected apps: /api/listApiTokens, /api/createApiToken, /api/revokeApiToken. */
import tokensModule from '../../functions/src/apiTokens/apiTokens.js';
import { callable } from '../lib/kitchen.mjs';
import { tokenStore } from '../lib/kitchenAuth.mjs';

const { handlers } = tokensModule;

export default async (req, context) => {
  const name = new URL(req.url).pathname.split('/').pop();
  const handler = handlers[name];
  if (!handler) return Response.json({ error: { status: 'not-found', message: 'Not found.' } }, { status: 404 });
  return callable(({ uid, data }) => handler({ store: tokenStore(), uid, data }), { needsKitchen: false })(req, context);
};

export const config = { path: ['/api/listApiTokens', '/api/createApiToken', '/api/revokeApiToken'] };
