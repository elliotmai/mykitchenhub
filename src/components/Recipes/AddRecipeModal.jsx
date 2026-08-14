// src/components/Recipes/AddRecipeModal.jsx
// Add or edit a recipe — Phase 4.3.
//
// One note that looks like a bug and isn't: the name is read-only when editing.
// firestore.rules refuses any update that changes `name` (it is what the legacy
// sync de-duplicates against), so the form disables the field rather than
// letting a cook type a new name and watch the save bounce.

import React, { useState, useEffect } from 'react';
import { Modal, Form, Button, Row, Col, Alert, Badge, Image, Spinner } from 'react-bootstrap';
import { BookOpen, X, Upload } from 'lucide-react';

import IngredientInput, { emptyIngredient } from './IngredientInput';
import InstructionBuilder from './InstructionBuilder';
import useRecipeImageUpload from '../../hooks/useRecipeImageUpload';
import { DIFFICULTIES, normalizeName, instructionSteps } from '../../hooks/useRecipes';

const EMPTY_FORM = {
  name: '',
  servings: '4',
  difficulty: 'easy',
  prepTime: '',
  cookTime: '',
  tags: [],
  ingredients: [emptyIngredient()],
  instructions: [''],
  imageUrl: null,
};

/** Pull the editable form state out of a stored recipe document. */
const formFromRecipe = (recipe) => ({
  name: recipe.name ?? '',
  servings: String(recipe.servings ?? 4),
  difficulty: DIFFICULTIES.includes(recipe.difficulty) ? recipe.difficulty : 'easy',
  prepTime:
    recipe.prepTime === null || recipe.prepTime === undefined ? '' : String(recipe.prepTime),
  cookTime:
    recipe.cookTime === null || recipe.cookTime === undefined ? '' : String(recipe.cookTime),
  tags: Array.isArray(recipe.tags) ? [...recipe.tags] : [],
  ingredients:
    Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0
      ? recipe.ingredients.map((i) => ({
          name: i.name ?? '',
          quantity: i.quantity ?? '',
          unit: i.unit ?? '',
        }))
      : [emptyIngredient()],
  instructions: instructionSteps(recipe.instructions).length
    ? instructionSteps(recipe.instructions)
    : [''],
  imageUrl: recipe.imageUrl ?? null,
});

/**
 * AddRecipeModal
 *
 * @param {boolean}  show
 * @param {function} onHide
 * @param {function} onSave                 - async (data) => { success, error }
 * @param {object}   editRecipe             - when set, the form edits this recipe
 * @param {array}    ingredientSuggestions  - names offered by the autocomplete
 */
const AddRecipeModal = ({
  show,
  onHide,
  onSave,
  editRecipe = null,
  ingredientSuggestions = [],
}) => {
  const isEditing = Boolean(editRecipe);

  const [form, setForm] = useState(EMPTY_FORM);
  const [tagDraft, setTagDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const { upload, uploading, error: uploadError, reset: resetUpload } = useRecipeImageUpload();

  useEffect(() => {
    if (!show) return;
    setForm(editRecipe ? formFromRecipe(editRecipe) : EMPTY_FORM);
    setTagDraft('');
    setError('');
    resetUpload();
  }, [show, editRecipe, resetUpload]);

  const patch = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  // ── Tags ────────────────────────────────────────────────────────────────
  const addTag = (raw) => {
    const tag = normalizeName(raw);
    if (!tag) return;
    setForm((prev) => (prev.tags.includes(tag) ? prev : { ...prev, tags: [...prev.tags, tag] }));
    setTagDraft('');
  };

  const removeTag = (tag) =>
    setForm((prev) => ({ ...prev, tags: prev.tags.filter((t) => t !== tag) }));

  const handleTagKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagDraft);
    }
  };

  // ── Photo ───────────────────────────────────────────────────────────────
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const result = await upload(file, { recipeId: editRecipe?.id });
    if (result.success) setForm((prev) => ({ ...prev, imageUrl: result.url }));
  };

  // ── Submit ──────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // A tag left in the box when the cook hits save is one they meant to add.
    const tags = tagDraft.trim() ? [...form.tags, normalizeName(tagDraft)] : form.tags;

    const payload = {
      name: form.name,
      servings: Number(form.servings),
      difficulty: form.difficulty,
      prepTime: form.prepTime,
      cookTime: form.cookTime,
      tags,
      ingredients: form.ingredients,
      instructions: form.instructions,
      imageUrl: form.imageUrl,
    };

    // The name can never change on an existing recipe; leave it out entirely so
    // the update patch carries only what the rules will accept.
    if (isEditing) delete payload.name;

    setSaving(true);
    const result = await onSave(payload);
    setSaving(false);

    if (result?.success) {
      onHide();
    } else {
      setError(result?.error || 'Something went wrong. Please try again.');
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered size="lg" scrollable>
      <Modal.Header closeButton className="border-0 pb-0">
        <Modal.Title className="d-flex align-items-center gap-2">
          <BookOpen size={20} className="text-primary" />
          {isEditing ? 'Edit Recipe' : 'Add Recipe'}
        </Modal.Title>
      </Modal.Header>

      <Form onSubmit={handleSubmit}>
        <Modal.Body className="pt-3">
          {(error || uploadError) && (
            <Alert variant="danger" className="py-2">
              {error || uploadError}
            </Alert>
          )}

          {/* Name */}
          <Form.Group className="mb-3">
            <Form.Label className="fw-semibold">
              Recipe Name <span className="text-danger">*</span>
            </Form.Label>
            <Form.Control
              type="text"
              placeholder="e.g. Sheet Pan Salmon"
              value={form.name}
              onChange={patch('name')}
              disabled={isEditing}
              autoFocus={!isEditing}
              maxLength={120}
            />
            {isEditing && (
              <Form.Text className="text-muted">
                Recipe names stay fixed once saved — everything else is yours to change.
              </Form.Text>
            )}
          </Form.Group>

          {/* Servings / difficulty / timings */}
          <Row className="mb-3 g-2">
            <Col xs={6} md={3}>
              <Form.Label className="fw-semibold">
                Servings <span className="text-danger">*</span>
              </Form.Label>
              <Form.Control
                type="number"
                aria-label="Servings"
                value={form.servings}
                onChange={patch('servings')}
                min="1"
                step="1"
              />
            </Col>
            <Col xs={6} md={3}>
              <Form.Label className="fw-semibold">Difficulty</Form.Label>
              <Form.Select
                aria-label="Difficulty"
                value={form.difficulty}
                onChange={patch('difficulty')}
              >
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Form.Select>
            </Col>
            <Col xs={6} md={3}>
              <Form.Label className="fw-semibold">Prep (min)</Form.Label>
              <Form.Control
                type="number"
                aria-label="Prep time in minutes"
                value={form.prepTime}
                onChange={patch('prepTime')}
                min="0"
              />
            </Col>
            <Col xs={6} md={3}>
              <Form.Label className="fw-semibold">Cook (min)</Form.Label>
              <Form.Control
                type="number"
                aria-label="Cook time in minutes"
                value={form.cookTime}
                onChange={patch('cookTime')}
                min="0"
              />
            </Col>
          </Row>

          {/* Tags */}
          <Form.Group className="mb-3">
            <Form.Label className="fw-semibold">Tags</Form.Label>
            <Form.Control
              type="text"
              placeholder="Type a tag and press Enter (e.g. dinner)"
              aria-label="Add a tag"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={handleTagKeyDown}
              maxLength={30}
            />
            {form.tags.length > 0 && (
              <div className="d-flex gap-2 flex-wrap mt-2">
                {form.tags.map((tag) => (
                  <Badge
                    key={tag}
                    bg="light"
                    text="dark"
                    className="d-flex align-items-center gap-1 px-2 py-1"
                    style={{
                      borderRadius: 'var(--mkh-radius-full)',
                      border: '1px solid var(--mkh-border)',
                    }}
                  >
                    {tag}
                    <Button
                      variant="link"
                      className="p-0 border-0 d-flex align-items-center"
                      aria-label={`Remove tag ${tag}`}
                      onClick={() => removeTag(tag)}
                    >
                      <X size={10} />
                    </Button>
                  </Badge>
                ))}
              </div>
            )}
          </Form.Group>

          {/* Photo */}
          <Form.Group className="mb-3">
            <Form.Label className="fw-semibold d-flex align-items-center gap-2">
              <Upload size={14} /> Photo
            </Form.Label>
            <Form.Control
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              aria-label="Recipe photo"
              onChange={handleFile}
              disabled={uploading}
            />
            {uploading && (
              <div className="d-flex align-items-center gap-2 mt-2 text-muted">
                <Spinner size="sm" /> Uploading photo…
              </div>
            )}
            {form.imageUrl && !uploading && (
              <div className="d-flex align-items-center gap-2 mt-2">
                <Image
                  src={form.imageUrl}
                  alt="Recipe preview"
                  thumbnail
                  style={{ maxHeight: 80 }}
                />
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setForm((prev) => ({ ...prev, imageUrl: null }))}
                >
                  Remove photo
                </Button>
              </div>
            )}
          </Form.Group>

          <hr style={{ borderColor: 'var(--mkh-border-light)' }} />

          {/* Ingredients */}
          <Form.Group className="mb-3">
            <Form.Label className="fw-semibold">
              Ingredients <span className="text-danger">*</span>
            </Form.Label>
            <IngredientInput
              ingredients={form.ingredients}
              suggestions={ingredientSuggestions}
              onChange={(ingredients) => setForm((prev) => ({ ...prev, ingredients }))}
            />
          </Form.Group>

          <hr style={{ borderColor: 'var(--mkh-border-light)' }} />

          {/* Instructions */}
          <Form.Group>
            <Form.Label className="fw-semibold">
              Instructions <span className="text-danger">*</span>
            </Form.Label>
            <InstructionBuilder
              steps={form.instructions}
              onChange={(instructions) => setForm((prev) => ({ ...prev, instructions }))}
            />
          </Form.Group>
        </Modal.Body>

        <Modal.Footer className="border-0 pt-0">
          <Button variant="light" onClick={onHide} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={saving || uploading}>
            {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Recipe'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default AddRecipeModal;
