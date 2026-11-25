/* POST /api/importInventoryFromCSV { csvData, fileName }: bulk inventory import for a signed-in cook. */
import csvModule from '../../functions/src/csvImport/importInventoryFromCSV.js';
import { expressish, kitchenFor, service } from '../lib/kitchen.mjs';

const { makeHandler } = csvModule;

const handler = makeHandler({
  authenticate: async (header) => {
    const token = String(header)
      .replace(/^Bearer\s+/i, '')
      .trim();
    const { data, error } = await service().auth.getUser(token);
    if (error || !data?.user) throw new Error('bad token');
    return { uid: data.user.id };
  },
  openDb: async ({ uid }) => {
    const kitchen = await kitchenFor(uid);
    if (!kitchen) throw new Error('Join or make a household first.');
    return kitchen.db;
  },
});

export default (req) => expressish(handler, req);

export const config = { path: '/api/importInventoryFromCSV' };
