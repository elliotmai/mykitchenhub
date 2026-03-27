// src/components/StorageLocations/LocationDropdownSelector.jsx
// Reusable dropdown to select a storage location (used in AddItemModal, CSV Import, etc.)

import React from 'react';
import { Form } from 'react-bootstrap';

/**
 * LocationDropdownSelector
 *
 * @param {Array}    locations    - Array of location objects from useStorageLocations
 * @param {string}   value        - Currently selected location ID
 * @param {function} onChange     - (locationId) => void
 * @param {boolean}  required     - Whether field is required
 * @param {string}   placeholder  - Placeholder text (default: "Select a location")
 * @param {boolean}  disabled     - Whether the selector is disabled
 * @param {string}   className    - Additional CSS classes
 * @param {boolean}  showType     - Whether to show the location type label (default: true)
 *
 * Usage:
 *   <LocationDropdownSelector
 *     locations={locations}
 *     value={selectedLocationId}
 *     onChange={(id) => setSelectedLocationId(id)}
 *   />
 */
const LocationDropdownSelector = ({
  locations = [],
  value = '',
  onChange,
  required = false,
  placeholder = 'Select a location',
  disabled = false,
  className = '',
  showType = true,
}) => {
  // Group locations by type for <optgroup> display
  const grouped = locations.reduce((acc, loc) => {
    if (!acc[loc.type]) acc[loc.type] = [];
    acc[loc.type].push(loc);
    return acc;
  }, {});

  const TYPE_LABELS = {
    fridge:  '🧊 Fridges',
    freezer: '❄️  Freezers',
    pantry:  '🏺 Pantries',
  };

  const handleChange = (e) => {
    if (onChange) onChange(e.target.value);
  };

  return (
    <Form.Select
      value={value}
      onChange={handleChange}
      required={required}
      disabled={disabled || locations.length === 0}
      className={className}
    >
      <option value="" disabled>
        {locations.length === 0 ? 'No locations available' : placeholder}
      </option>

      {showType
        ? // Grouped by type
          Object.entries(grouped).map(([type, locs]) => (
            <optgroup key={type} label={TYPE_LABELS[type] || type}>
              {locs.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.icon} {loc.label}
                  {loc.itemCount ? ` (${loc.itemCount})` : ''}
                </option>
              ))}
            </optgroup>
          ))
        : // Flat list
          locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.icon} {loc.label}
            </option>
          ))}
    </Form.Select>
  );
};

export default LocationDropdownSelector;
