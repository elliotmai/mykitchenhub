// functions/src/utils/fieldValue.js
// Write operations the server code hands to its database (serverTimestamp,
// increment, arrayUnion, arrayRemove, delete): the same marker objects the
// browser makes (src/backend/docModel.js), resolved when the row is written
// (netlify/lib/kitchenDb.mjs). They replaced firebase-admin's FieldValue when
// KitchenHub moved to Supabase.

const OP = '__kitchenOp';
const sentinel = (op, value) => ({ [OP]: op, value });

const FieldValue = {
  serverTimestamp: () => sentinel('serverTimestamp'),
  increment: (n) => sentinel('increment', n),
  arrayUnion: (...values) => sentinel('arrayUnion', values),
  arrayRemove: (...values) => sentinel('arrayRemove', values),
  delete: () => sentinel('delete'),
};

const isFieldValue = (v, op) => v !== null && typeof v === 'object' && v[OP] === op;

module.exports = { FieldValue, OP, isFieldValue };
