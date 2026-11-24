const { FieldValue, OP, isFieldValue } = require('../fieldValue');

it('makes the markers src/backend/docModel.js resolves', () => {
  expect(OP).toBe('__kitchenOp');
  expect(FieldValue.serverTimestamp()).toEqual({ __kitchenOp: 'serverTimestamp', value: undefined });
  expect(FieldValue.increment(2)).toEqual({ __kitchenOp: 'increment', value: 2 });
  expect(FieldValue.arrayUnion('a', 'b')).toEqual({ __kitchenOp: 'arrayUnion', value: ['a', 'b'] });
  expect(FieldValue.arrayRemove('a')).toEqual({ __kitchenOp: 'arrayRemove', value: ['a'] });
  expect(isFieldValue(FieldValue.delete(), 'delete')).toBe(true);
  expect(isFieldValue(null, 'delete')).toBe(false);
});
