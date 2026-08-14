// Default storage locations created for new users

const defaultStorageLocations = [
  {
    label: 'Main Fridge',
    type: 'fridge',
    icon: '🧊',
    color: '#3498db',
    order: 1,
    description: 'Primary refrigerator for fresh foods',
    isDefault: true
  },
  {
    label: 'Freezer',
    type: 'freezer',
    icon: '❄️',
    color: '#9b59b6',
    order: 2,
    description: 'Freezer for long-term storage',
    isDefault: true
  },
  {
    label: 'Pantry',
    type: 'pantry',
    icon: '🏺',
    color: '#e67e22',
    order: 3,
    description: 'Dry goods and non-perishables',
    isDefault: true
  },
  {
    label: 'Counter',
    type: 'pantry',
    icon: '🍞',
    color: '#f39c12',
    order: 4,
    description: 'Items stored at room temperature',
    isDefault: true
  },
  {
    label: 'Garage Fridge',
    type: 'fridge',
    icon: '🚗',
    color: '#1abc9c',
    order: 5,
    description: 'Secondary refrigerator',
    isDefault: false
  },
  {
    label: 'Chest Freezer',
    type: 'freezer',
    icon: '📦',
    color: '#34495e',
    order: 6,
    description: 'Additional freezer storage',
    isDefault: false
  }
];

/**
 * Get all default storage locations
 * @param {boolean} onlyDefaults - If true, only return locations marked as default
 * @returns {Array} - Array of storage location objects
 */
function getDefaultLocations(onlyDefaults = true) {
  if (onlyDefaults) {
    return defaultStorageLocations.filter(loc => loc.isDefault);
  }
  return defaultStorageLocations;
}

/**
 * Get location by type
 * @param {string} type - Location type (fridge, freezer, pantry)
 * @returns {Array} - Array of matching storage locations
 */
function getLocationsByType(type) {
  return defaultStorageLocations.filter(loc => loc.type === type);
}

/**
 * Create a custom location object
 * @param {string} label - User-facing location label
 * @param {string} type - Location type
 * @param {object} options - Additional options (icon, color, description)
 * @returns {object} - Storage location object
 */
function createCustomLocation(label, type, options = {}) {
  return {
    label,
    type,
    icon: options.icon || '📍',
    color: options.color || '#95a5a6',
    order: options.order || 99,
    description: options.description || '',
    isDefault: false,
    createdAt: new Date().toISOString()
  };
}

/**
 * Validate location type
 * @param {string} type - Location type to validate
 * @returns {boolean} - True if valid type
 */
function isValidLocationType(type) {
  const validTypes = ['fridge', 'freezer', 'pantry'];
  return validTypes.includes(type);
}

module.exports = {
  defaultStorageLocations,
  getDefaultLocations,
  getLocationsByType,
  createCustomLocation,
  isValidLocationType
};
