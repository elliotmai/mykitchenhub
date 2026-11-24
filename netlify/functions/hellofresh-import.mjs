/*
 * HelloFresh import, parse only (functions/src/hellofresh/importHandlers.js):
 *   POST /api/importHelloFreshFromPhoto  { image, mediaType }
 *   POST /api/importHelloFreshFromUrl    { url }
 * The browser saves the reviewed recipe itself.
 */
import handlersModule from '../../functions/src/hellofresh/importHandlers.js';
import { expressish } from '../lib/kitchen.mjs';

const { importHelloFreshFromPhoto, importHelloFreshFromUrl } = handlersModule;

export default async (req) => {
  const photo = new URL(req.url).pathname.endsWith('FromPhoto');
  return expressish(photo ? importHelloFreshFromPhoto : importHelloFreshFromUrl, req);
};

export const config = { path: ['/api/importHelloFreshFromPhoto', '/api/importHelloFreshFromUrl'] };
