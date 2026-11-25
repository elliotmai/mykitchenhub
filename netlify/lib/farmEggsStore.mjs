/*
 * The one Eggs row, changed safely (POST /api/farm/eggs).
 *
 * kitchen.docs has no transactions through PostgREST, so the item is updated
 * compare-and-swap: read the row with its updated_at, work out the next data
 * (functions/src/farm/farmEggs.js), and write it only where updated_at is
 * still the one read. Two farm sends at once, or a cook saving the item in the
 * same instant, make one of them read again rather than lose the other.
 * The farm's ledger lives inside that same row, so the stock and "what each
 * farm record already counted" can never be written apart.
 *
 * Only inventory/<the eggs item> is ever written: this module cannot touch
 * any other document.
 */
import farmModule from '../../functions/src/farm/farmEggs.js';
import { service } from './kitchen.mjs';

const { EGGS_ITEM_ID, FarmEggsError, applyFarmEggs, newEggsItem, pickEggsItem, pickFridge } =
  farmModule;

const ATTEMPTS = 6;
const docs = () => service().schema('kitchen').from('docs');

const must = ({ data, error }) => {
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
};

const rowsUnder = async (householdId, parent) =>
  must(
    await docs()
      .select('path, data, updated_at')
      .eq('household_id', householdId)
      .eq('parent', parent)
  ) || [];

/**
 * Apply a parsed batch to the household's Eggs item, creating it in the fridge
 * when there is none.
 *
 * @returns {{ itemId, quantity, created, applied, unchanged, ignored }}
 */
export async function applyEggsBatch({ householdId, records, now, today }) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const found = pickEggsItem(await rowsUnder(householdId, 'inventory'));

    if (!found) {
      const location = pickFridge(await rowsUnder(householdId, 'storageLocations'));
      const result = applyFarmEggs(newEggsItem({ location, now, today }), records, { now, today });
      if (result.applied.length === 0) return summary(null, 0, false, result);
      const { error } = await docs().insert({
        household_id: householdId,
        path: `inventory/${EGGS_ITEM_ID}`,
        data: result.data,
        updated_at: now.toISOString(),
      });
      if (!error) return summary(EGGS_ITEM_ID, result.data.quantity, true, result);
      if (error.code === '23505') continue; // made by a send running alongside: read again
      throw new Error(error.message);
    }

    const itemId = found.path.split('/').pop();
    const result = applyFarmEggs(found.data, records, { now, today });
    if (!result.changed) return summary(itemId, Number(found.data.quantity) || 0, false, result);

    const written = must(
      await docs()
        .update({ data: result.data, updated_at: now.toISOString() })
        .eq('household_id', householdId)
        .eq('path', found.path)
        .eq('updated_at', found.updated_at)
        .select('path')
    );
    if (written && written.length === 1)
      return summary(itemId, result.data.quantity, false, result);
    // Somebody else wrote the row between our read and our write: start over.
  }
  throw new FarmEggsError(503, 'The eggs item is busy; try again.');
}

function summary(itemId, quantity, created, { applied, unchanged, ignored, delta }) {
  return { itemId, quantity, created, delta: delta || 0, applied, unchanged, ignored };
}
