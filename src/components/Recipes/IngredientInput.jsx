// src/components/Recipes/IngredientInput.jsx
// Ingredient rows for the Add/Edit recipe form.
//
// The name field auto-completes from what is actually in the kitchen first,
// then from a short list of staples. Matching recipes to inventory later is
// done on the normalized ingredient name, so nudging cooks towards the wording
// they already used for their inventory is what makes that matching work.

import React, { useMemo } from 'react';
import { Row, Col, Form, Button, InputGroup } from 'react-bootstrap';
import { Plus, Trash2 } from 'lucide-react';

/** Staples offered when the kitchen is empty or the ingredient is new. */
export const COMMON_INGREDIENTS = [
  'butter',
  'carrots',
  'cheese',
  'chicken breast',
  'eggs',
  'flour',
  'garlic',
  'ground beef',
  'lemon',
  'milk',
  'olive oil',
  'onion',
  'pasta',
  'potatoes',
  'rice',
  'salt',
  'black pepper',
  'soy sauce',
  'spinach',
  'tomatoes',
];

export const UNIT_OPTIONS = [
  '',
  'g',
  'kg',
  'oz',
  'lb',
  'ml',
  'L',
  'tsp',
  'tbsp',
  'cup',
  'clove',
  'slice',
  'piece',
  'can',
  'bunch',
];

/** A blank row, so "add ingredient" and "start empty" agree on the shape. */
export const emptyIngredient = () => ({ name: '', quantity: '', unit: '' });

const DATALIST_ID = 'recipe-ingredient-suggestions';

/**
 * IngredientInput
 *
 * @param {array}    ingredients - [{ name, quantity, unit }]
 * @param {function} onChange    - (nextIngredients) => void
 * @param {array}    suggestions - extra names to offer (usually the inventory)
 */
const IngredientInput = ({ ingredients = [], onChange, suggestions = [] }) => {
  const rows = ingredients.length > 0 ? ingredients : [emptyIngredient()];

  const options = useMemo(() => {
    const merged = [...suggestions, ...COMMON_INGREDIENTS]
      .map((s) => String(s ?? '').trim())
      .filter(Boolean);
    // Case-insensitive de-dupe, keeping the inventory's spelling.
    const seen = new Map();
    merged.forEach((name) => {
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    });
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [suggestions]);

  const patchRow = (index, field, value) => {
    const next = rows.map((row, i) => (i === index ? { ...row, [field]: value } : row));
    onChange?.(next);
  };

  const addRow = () => onChange?.([...rows, emptyIngredient()]);

  const removeRow = (index) => {
    const next = rows.filter((_, i) => i !== index);
    onChange?.(next.length > 0 ? next : [emptyIngredient()]);
  };

  return (
    <div className="ingredient-input">
      <datalist id={DATALIST_ID}>
        {options.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {rows.map((row, index) => (
        <Row className="g-2 mb-2 align-items-center" key={`ingredient-${index}`}>
          <Col xs={5} sm={6}>
            <Form.Control
              type="text"
              list={DATALIST_ID}
              placeholder="Ingredient"
              aria-label={`Ingredient ${index + 1} name`}
              value={row.name ?? ''}
              onChange={(e) => patchRow(index, 'name', e.target.value)}
              maxLength={60}
            />
          </Col>
          <Col xs={3} sm={2}>
            <Form.Control
              type="number"
              placeholder="Qty"
              aria-label={`Ingredient ${index + 1} quantity`}
              value={row.quantity ?? ''}
              onChange={(e) => patchRow(index, 'quantity', e.target.value)}
              min="0"
              step="0.25"
            />
          </Col>
          <Col xs={4} sm={4}>
            <InputGroup>
              <Form.Select
                aria-label={`Ingredient ${index + 1} unit`}
                value={row.unit ?? ''}
                onChange={(e) => patchRow(index, 'unit', e.target.value)}
              >
                {UNIT_OPTIONS.map((u) => (
                  <option key={u || 'none'} value={u}>
                    {u || '— unit —'}
                  </option>
                ))}
              </Form.Select>
              <Button
                variant="light"
                aria-label={`Remove ingredient ${index + 1}`}
                onClick={() => removeRow(index)}
                style={{ color: 'var(--mkh-danger-text)' }}
              >
                <Trash2 size={14} />
              </Button>
            </InputGroup>
          </Col>
        </Row>
      ))}

      <Button
        variant="light"
        size="sm"
        className="d-flex align-items-center gap-1"
        onClick={addRow}
      >
        <Plus size={14} /> Add ingredient
      </Button>
    </div>
  );
};

export default IngredientInput;
