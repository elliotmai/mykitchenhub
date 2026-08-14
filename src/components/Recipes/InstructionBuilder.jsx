// src/components/Recipes/InstructionBuilder.jsx
// Numbered instruction steps, one text box each.
//
// Steps are stored as an array rather than one blob of text so the detail view
// can number them, and so a cook can reorder a step without retyping the lot.

import React from 'react';
import { Form, Button, InputGroup } from 'react-bootstrap';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';

/**
 * InstructionBuilder
 *
 * @param {array}    steps    - array of strings
 * @param {function} onChange - (nextSteps) => void
 */
const InstructionBuilder = ({ steps = [], onChange }) => {
  const rows = steps.length > 0 ? steps : [''];

  const emit = (next) => onChange?.(next.length > 0 ? next : ['']);

  const patchStep = (index, value) => emit(rows.map((s, i) => (i === index ? value : s)));

  const addStep = () => emit([...rows, '']);

  const removeStep = (index) => emit(rows.filter((_, i) => i !== index));

  const moveStep = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    emit(next);
  };

  return (
    <div className="instruction-builder">
      {rows.map((step, index) => (
        <InputGroup className="mb-2" key={`step-${index}`}>
          <InputGroup.Text
            style={{ background: 'var(--mkh-bg-card)', border: '1px solid var(--mkh-border)' }}
          >
            {index + 1}
          </InputGroup.Text>
          <Form.Control
            as="textarea"
            rows={2}
            placeholder={index === 0 ? 'e.g. Heat the oven to 200°C.' : 'Next step…'}
            aria-label={`Step ${index + 1}`}
            value={step}
            onChange={(e) => patchStep(index, e.target.value)}
            maxLength={500}
          />
          <Button
            variant="light"
            aria-label={`Move step ${index + 1} up`}
            disabled={index === 0}
            onClick={() => moveStep(index, -1)}
          >
            <ArrowUp size={14} />
          </Button>
          <Button
            variant="light"
            aria-label={`Move step ${index + 1} down`}
            disabled={index === rows.length - 1}
            onClick={() => moveStep(index, 1)}
          >
            <ArrowDown size={14} />
          </Button>
          <Button
            variant="light"
            aria-label={`Remove step ${index + 1}`}
            onClick={() => removeStep(index)}
            style={{ color: 'var(--mkh-danger-text)' }}
          >
            <Trash2 size={14} />
          </Button>
        </InputGroup>
      ))}

      <Button
        variant="light"
        size="sm"
        className="d-flex align-items-center gap-1"
        onClick={addStep}
      >
        <Plus size={14} /> Add step
      </Button>
    </div>
  );
};

export default InstructionBuilder;
