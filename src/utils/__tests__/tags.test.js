import { matchExistingTag, normalizeTag, normalizeTags, suggestTags, tagLabel } from '../tags';

describe('normalizeTag', () => {
  it.each([
    ['  Dinner ', 'dinner'],
    ['DINNER', 'dinner'],
    ['Main   Course', 'main course'],
    ['#Holiday', 'holiday'],
    ['From scans', 'from scans'],
    [null, ''],
  ])('%p → %p', (raw, tag) => {
    expect(normalizeTag(raw)).toBe(tag);
  });
});

it('keeps one of each tag, first spelling first', () => {
  expect(normalizeTags(['Dinner', 'dinner ', ' ', 'Handwritten', 'DINNER', 'from scans'])).toEqual([
    'dinner',
    'handwritten',
    'from scans',
  ]);
  expect(normalizeTags(undefined)).toEqual([]);
});

it('shows tags in sentence case without changing them', () => {
  expect(tagLabel('main course')).toBe('Main course');
  expect(tagLabel('')).toBe('');
});

it('turns a near-duplicate into the tag already used', () => {
  const existing = ['potatoes', 'cookie', 'Berries', 'dish'];
  expect(matchExistingTag('Potato', existing)).toBe('potatoes');
  expect(matchExistingTag('COOKIES', existing)).toBe('cookie');
  expect(matchExistingTag('berry', existing)).toBe('berries');
  expect(matchExistingTag('dishes', existing)).toBe('dish');
  expect(matchExistingTag('Soup', existing)).toBe('soup');
  expect(matchExistingTag('  ', existing)).toBe('');
});

it('suggests existing tags, starting-with first, skipping ones already chosen', () => {
  const existing = ['dessert', 'side', 'dip', 'Dinner', 'bread pudding'];
  expect(suggestTags('d', existing, ['dip'])).toEqual([
    'dessert',
    'dinner',
    'side',
    'bread pudding',
  ]);
  expect(suggestTags('ud', existing)).toEqual(['bread pudding']);
  expect(suggestTags('', existing, [], 2)).toEqual(['dessert', 'side']);
});
