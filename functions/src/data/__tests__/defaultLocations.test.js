/**
 * The default locations are written straight into Firestore by the signup
 * trigger, bypassing security rules — so nothing else validates their shape.
 * These tests are that validation.
 *
 * The field names must match firestore/firestore.rules and
 * firestore/SCHEMA_DOCUMENTATION.md exactly: the UI reads `label`, and a
 * mismatch here renders every storage location blank.
 */

const {
  defaultStorageLocations,
  getDefaultLocations,
  getLocationsByType,
  createCustomLocation,
  isValidLocationType,
} = require('../defaultLocations');

// Mirrors hasRequiredFields([...]) in firestore/firestore.rules for
// users/{userId}/storageLocations. `createdAt` is stamped at write time.
const REQUIRED_FIELDS = ['label', 'type', 'icon', 'color', 'order', 'isDefault'];
const VALID_TYPES = ['fridge', 'freezer', 'pantry'];

describe('default storage location data', () => {
  it('gives every location the fields the security rules require', () => {
    defaultStorageLocations.forEach((location) => {
      REQUIRED_FIELDS.forEach((field) => {
        expect(location).toHaveProperty(field);
      });
    });
  });

  it('labels every location with a non-empty string', () => {
    defaultStorageLocations.forEach((location) => {
      expect(typeof location.label).toBe('string');
      expect(location.label.trim().length).toBeGreaterThan(0);
    });
  });

  it('never uses `name` — the UI and rules both read `label`', () => {
    const withName = defaultStorageLocations.filter((l) => 'name' in l).map((l) => l.name);
    expect(withName).toEqual([]);
  });

  it('only uses location types the security rules accept', () => {
    defaultStorageLocations.forEach((location) => {
      expect(VALID_TYPES).toContain(location.type);
    });
  });

  it('gives each location a distinct display order', () => {
    const orders = defaultStorageLocations.map((l) => l.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('gives each location a distinct label', () => {
    const labels = defaultStorageLocations.map((l) => l.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('uses hex colours and a non-empty icon for each location', () => {
    defaultStorageLocations.forEach((location) => {
      expect(location.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(location.icon.length).toBeGreaterThan(0);
    });
  });
});

describe('getDefaultLocations', () => {
  it('returns only the locations seeded at signup by default', () => {
    const seeded = getDefaultLocations();

    expect(seeded.length).toBeGreaterThan(0);
    seeded.forEach((l) => expect(l.isDefault).toBe(true));
  });

  it('covers all three storage types out of the box', () => {
    const types = new Set(getDefaultLocations().map((l) => l.type));
    expect([...types].sort()).toEqual([...VALID_TYPES].sort());
  });

  it('returns the full catalogue when asked', () => {
    expect(getDefaultLocations(false)).toHaveLength(defaultStorageLocations.length);
    expect(getDefaultLocations(false).length).toBeGreaterThan(getDefaultLocations(true).length);
  });
});

describe('getLocationsByType', () => {
  it('filters to the requested type', () => {
    const fridges = getLocationsByType('fridge');

    expect(fridges.length).toBeGreaterThan(0);
    fridges.forEach((l) => expect(l.type).toBe('fridge'));
  });

  it('returns an empty list for an unknown type', () => {
    expect(getLocationsByType('spaceship')).toEqual([]);
  });
});

describe('createCustomLocation', () => {
  it('produces a location in the same shape as the defaults', () => {
    const location = createCustomLocation('Beer Fridge', 'fridge');

    REQUIRED_FIELDS.forEach((field) => expect(location).toHaveProperty(field));
    expect(location.label).toBe('Beer Fridge');
    expect(location.isDefault).toBe(false);
    expect(location.createdAt).toEqual(expect.any(String));
  });

  it('applies fallbacks for icon, colour and order', () => {
    const location = createCustomLocation('Shed', 'pantry');

    expect(location.icon).toBeTruthy();
    expect(location.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(location.order).toBe(99);
  });

  it('honours supplied options', () => {
    const location = createCustomLocation('Shed', 'pantry', {
      icon: '🛖',
      color: '#123456',
      order: 7,
      description: 'Out back',
    });

    expect(location).toMatchObject({
      icon: '🛖',
      color: '#123456',
      order: 7,
      description: 'Out back',
    });
  });
});

describe('isValidLocationType', () => {
  it.each(VALID_TYPES)('accepts %s', (type) => {
    expect(isValidLocationType(type)).toBe(true);
  });

  it.each(['garage', '', null, undefined, 'FRIDGE'])('rejects %p', (type) => {
    expect(isValidLocationType(type)).toBe(false);
  });
});
