// src/components/HelloFresh/RecipeReviewForm.jsx
// The step between "the AI read your card" and "it's in your recipe book".
//
// Doubles as the manual-entry form: `useHelloFreshImport.startManualEntry()`
// hands it a blank draft, and everything below works the same way.

import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Form, Row, Spinner } from 'react-bootstrap';
import { Plus, Save, Trash2, X } from 'lucide-react';

import { DIFFICULTIES, validateDraft } from '../../hooks/useHelloFreshImport';

const blankIngredient = () => ({ name: '', quantity: 1, unit: '' });

/** Tags round-trip through free text, so a comma can actually be typed. */
const tagsToText = (tags) => (tags ?? []).join(', ');
const textToTags = (text) =>
  String(text ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

const RecipeReviewForm = ({
  draft,
  warnings = [],
  saving = false,
  error = null,
  onSave,
  onCancel,
}) => {
  const [form, setForm] = useState(draft);
  const [tagsText, setTagsText] = useState(() => tagsToText(draft?.tags));
  const [submitted, setSubmitted] = useState(false);

  // A fresh import replaces whatever was being edited.
  useEffect(() => {
    setForm(draft);
    setTagsText(tagsToText(draft?.tags));
    setSubmitted(false);
  }, [draft]);

  if (!form) return null;

  const problems = submitted ? validateDraft(form) : [];

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const setIngredient = (index, patch) =>
    set({
      ingredients: form.ingredients.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });

  const removeIngredient = (index) =>
    set({ ingredients: form.ingredients.filter((_, i) => i !== index) });

  const setStep = (index, value) =>
    set({ instructions: form.instructions.map((step, i) => (i === index ? value : step)) });

  const removeStep = (index) =>
    set({ instructions: form.instructions.filter((_, i) => i !== index) });

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitted(true);
    // Tags are only parsed out of the text box here, so typing a comma works.
    const candidate = { ...form, tags: textToTags(tagsText) };
    if (validateDraft(candidate).length > 0) return;
    await onSave(candidate);
  };

  return (
    <Card>
      <Card.Header className="d-flex justify-content-between align-items-center">
        <span className="fw-semibold">Check this over before saving</span>
        {/* Distinct from the footer's "Cancel" so the two are tellable apart
            by a screen reader and by name in a test. */}
        <Button
          variant="link"
          className="p-0 text-muted"
          onClick={onCancel}
          aria-label="Close review"
        >
          <X size={20} />
        </Button>
      </Card.Header>

      <Card.Body>
        {warnings.length > 0 && (
          <Alert variant="warning">
            <div className="fw-semibold">A couple of things to double-check:</div>
            <ul className="mb-0 mt-1">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </Alert>
        )}

        {problems.length > 0 && (
          <Alert variant="danger">
            <ul className="mb-0">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Alert>
        )}

        {error && <Alert variant="danger">{error.message}</Alert>}

        <Form onSubmit={handleSubmit} noValidate>
          <Form.Group className="mb-3" controlId="recipe-name">
            <Form.Label>Recipe name</Form.Label>
            <Form.Control
              value={form.name}
              onChange={(event) => set({ name: event.target.value })}
              placeholder="e.g. Sweet Chili Chicken"
            />
          </Form.Group>

          <Row className="g-3 mb-3">
            <Col xs={6} md={3}>
              <Form.Group controlId="recipe-servings">
                <Form.Label>Servings</Form.Label>
                <Form.Control
                  type="number"
                  min="1"
                  value={form.servings ?? ''}
                  onChange={(event) => set({ servings: Number(event.target.value) })}
                />
              </Form.Group>
            </Col>
            <Col xs={6} md={3}>
              <Form.Group controlId="recipe-difficulty">
                <Form.Label>Difficulty</Form.Label>
                <Form.Select
                  value={form.difficulty}
                  onChange={(event) => set({ difficulty: event.target.value })}
                >
                  {DIFFICULTIES.map((level) => (
                    <option key={level} value={level}>
                      {level[0].toUpperCase() + level.slice(1)}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col xs={6} md={3}>
              <Form.Group controlId="recipe-prep">
                <Form.Label>Prep (min)</Form.Label>
                <Form.Control
                  type="number"
                  min="0"
                  value={form.prepTime ?? ''}
                  onChange={(event) =>
                    set({ prepTime: event.target.value === '' ? null : Number(event.target.value) })
                  }
                />
              </Form.Group>
            </Col>
            <Col xs={6} md={3}>
              <Form.Group controlId="recipe-cook">
                <Form.Label>Cook (min)</Form.Label>
                <Form.Control
                  type="number"
                  min="0"
                  value={form.cookTime ?? ''}
                  onChange={(event) =>
                    set({ cookTime: event.target.value === '' ? null : Number(event.target.value) })
                  }
                />
              </Form.Group>
            </Col>
          </Row>

          <Form.Group className="mb-4" controlId="recipe-tags">
            <Form.Label>Tags</Form.Label>
            <Form.Control
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              placeholder="chicken, quick, one-pan"
            />
            <Form.Text muted>Comma separated. We always keep the “hellofresh” tag.</Form.Text>
          </Form.Group>

          {/* Ingredients */}
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h6 className="mb-0">Ingredients</h6>
            <Button
              size="sm"
              variant="outline-primary"
              onClick={() => set({ ingredients: [...form.ingredients, blankIngredient()] })}
              className="d-flex align-items-center gap-1"
            >
              <Plus size={16} /> Add ingredient
            </Button>
          </div>

          {form.ingredients.map((ingredient, index) => (
            // Rows are reorderable only by add/remove, so the index is stable
            // for as long as the row exists.
            // eslint-disable-next-line react/no-array-index-key
            <Row className="g-2 mb-2 align-items-end" key={`ingredient-${index}`}>
              <Col xs={4} sm={2}>
                <Form.Label className="small mb-1" htmlFor={`ingredient-qty-${index}`}>
                  Qty
                </Form.Label>
                <Form.Control
                  id={`ingredient-qty-${index}`}
                  type="number"
                  min="0"
                  step="any"
                  value={ingredient.quantity ?? ''}
                  onChange={(event) =>
                    setIngredient(index, { quantity: Number(event.target.value) })
                  }
                />
              </Col>
              <Col xs={4} sm={2}>
                <Form.Label className="small mb-1" htmlFor={`ingredient-unit-${index}`}>
                  Unit
                </Form.Label>
                <Form.Control
                  id={`ingredient-unit-${index}`}
                  value={ingredient.unit ?? ''}
                  onChange={(event) => setIngredient(index, { unit: event.target.value })}
                  placeholder="g"
                />
              </Col>
              <Col xs={12} sm={7}>
                <Form.Label className="small mb-1" htmlFor={`ingredient-name-${index}`}>
                  Ingredient
                </Form.Label>
                <Form.Control
                  id={`ingredient-name-${index}`}
                  value={ingredient.name ?? ''}
                  onChange={(event) => setIngredient(index, { name: event.target.value })}
                  placeholder="Tomato paste"
                />
              </Col>
              <Col xs={12} sm={1} className="d-grid">
                <Button
                  variant="outline-danger"
                  onClick={() => removeIngredient(index)}
                  aria-label={`Remove ingredient ${index + 1}`}
                >
                  <Trash2 size={16} />
                </Button>
              </Col>
            </Row>
          ))}

          {/* Instructions */}
          <div className="d-flex justify-content-between align-items-center mt-4 mb-2">
            <h6 className="mb-0">Steps</h6>
            <Button
              size="sm"
              variant="outline-primary"
              onClick={() => set({ instructions: [...form.instructions, ''] })}
              className="d-flex align-items-center gap-1"
            >
              <Plus size={16} /> Add step
            </Button>
          </div>

          {form.instructions.map((step, index) => (
            // eslint-disable-next-line react/no-array-index-key
            <Row className="g-2 mb-2 align-items-start" key={`step-${index}`}>
              <Col xs={11}>
                <Form.Label className="small mb-1" htmlFor={`step-${index}`}>
                  Step {index + 1}
                </Form.Label>
                <Form.Control
                  id={`step-${index}`}
                  as="textarea"
                  rows={2}
                  value={step}
                  onChange={(event) => setStep(index, event.target.value)}
                />
              </Col>
              <Col xs={1} className="d-grid" style={{ paddingTop: '1.9rem' }}>
                <Button
                  variant="outline-danger"
                  onClick={() => removeStep(index)}
                  aria-label={`Remove step ${index + 1}`}
                >
                  <Trash2 size={16} />
                </Button>
              </Col>
            </Row>
          ))}

          <div className="d-flex gap-2 mt-4">
            <Button
              type="submit"
              variant="primary"
              disabled={saving}
              className="d-flex align-items-center gap-2"
            >
              {saving ? (
                <>
                  <Spinner animation="border" size="sm" role="status" aria-hidden="true" />
                  Saving…
                </>
              ) : (
                <>
                  <Save size={18} /> Save recipe
                </>
              )}
            </Button>
            <Button variant="outline-secondary" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
          </div>
        </Form>
      </Card.Body>
    </Card>
  );
};

export default RecipeReviewForm;
