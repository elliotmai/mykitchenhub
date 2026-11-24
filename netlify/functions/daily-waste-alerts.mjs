/*
 * The 9 AM waste alert (functions/src/wasteAlerts): for every household with
 * a kitchen, what is about to expire, texted to whoever asked for texts and
 * always left as an in-app notification.
 *
 * Netlify schedules in UTC. 9 AM in New York is 14:00 UTC in winter and 13:00
 * in summer, so this fires at both and runs in the one isAlertHour( ) says is
 * 9 AM there. The notification id is the day, so a second run would update,
 * not duplicate.
 */
import alertsModule from '../../functions/src/wasteAlerts/sendDailyWasteAlerts.js';
import { makeServerDb } from '../../src/backend/serverDb.js';
import { service } from '../lib/kitchen.mjs';

const { isAlertHour, runDailyWasteAlerts } = alertsModule;

export default async () => {
  const now = new Date();
  if (!isAlertHour(now)) return new Response('Not 9 AM in the kitchen yet.');

  const { data, error } = await service().schema('kitchen').from('docs').select('household_id').like('path', 'users/%');
  if (error) throw new Error(error.message);
  const households = [...new Set((data || []).map((r) => r.household_id))];

  for (const householdId of households) {
    try {
      await runDailyWasteAlerts({ db: makeServerDb({ client: service(), householdId }), now });
    } catch (err) {
      console.error(`Waste alerts failed for a household: ${err.message}`);
    }
  }
  return new Response(`Checked ${households.length} kitchens.`);
};

export const config = { schedule: '0 13,14 * * *' };
