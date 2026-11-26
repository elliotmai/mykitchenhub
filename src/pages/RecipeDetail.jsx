// src/pages/RecipeDetail.jsx
// Full view of a single recipe — Phase 4.1.
//
// Reached from the library as `/recipes?recipe=<id>`, which keeps the app's
// seven top-level routes exactly as they are while still giving the detail view
// its own shareable URL.
//
// The ingredient list marks what is already in the kitchen. Matching is on the
// normalized name, the same field the inventory writes, so "Chicken Breast" in
// the fridge lights up "chicken breast" in a recipe.

import { tagLabel } from '../utils/tags';
import React, { useState } from 'react';
import { Card, Badge, Button, Row, Col, Alert, ListGroup, Spinner } from 'react-bootstrap';
import {
  ArrowLeft,
  Clock,
  Users,
  ChefHat,
  Pencil,
  Trash2,
  Check,
  UtensilsCrossed,
  Play,
} from 'lucide-react';

import { totalTime, instructionSteps, normalizeName, SOURCE_LABELS } from '../hooks/useRecipes';
import StepTimer from '../timers/StepTimer';
import { MoveToDish } from '../dishes/DishView';
import CookMode from '../components/Recipes/CookMode';

/** "https://www.example.com/x" → "example.com", or null for anything that isn't an http(s) URL. */
const hostOf = (url) => {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname.replace(/^www\./, '') : null;
  } catch {
    return null;
  }
};

/**
 * RecipeDetail
 *
 * @param {object}   recipe          - recipes/{id} document, or null when missing
 * @param {boolean}  loading
 * @param {array}    inventoryNames  - normalized names currently in the kitchen
 * @param {function} onBack          - () => void
 * @param {function} onCook          - (recipe) => void — logs a cook ("I cooked this")
 * @param {function} onEdit          - (recipe) => void
 * @param {function} onDelete        - (recipe) => void
 */
const RecipeDetail = ({
  recipe,
  loading = false,
  inventoryNames = [],
  onBack,
  onCook,
  onEdit,
  onDelete,
  dish = null,
  onOpenDish,
  dishes = [],
  onMoveDish,
  onMoveNewDish,
  onUseAsCover,
}) => {
  // Cook mode, opened by the Cook button: the recipe as step-by-step cards.
  const [cooking, setCooking] = useState(false);

  if (loading) {
    return (
      <div className="d-flex align-items-center justify-content-center py-5 text-muted gap-2">
        <Spinner size="sm" /> Loading recipe…
      </div>
    );
  }

  if (!recipe) {
    return (
      <div className="recipe-detail">
        <Button variant="link" className="px-0 mb-3" onClick={onBack}>
          <ArrowLeft size={16} className="me-1" /> Back to recipes
        </Button>
        <Alert variant="warning">
          That recipe is no longer in the library. It may have been deleted.
        </Alert>
      </div>
    );
  }

  const minutes = totalTime(recipe);
  const steps = instructionSteps(recipe.instructions);
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const tags = Array.isArray(recipe.tags) ? recipe.tags : [];
  const have = new Set(inventoryNames.map(normalizeName));
  const isMine = recipe.source === 'user-created';
  const sourceHost = hostOf(recipe.sourceUrl);
  const scans = (Array.isArray(recipe.scans) ? recipe.scans : [])
    .filter((x) => x && typeof x.url === 'string')
    .sort((a, b) => (a.page ?? 0) - (b.page ?? 0));

  return (
    <div className="recipe-detail">
      <Button variant="link" className="px-0 mb-2" onClick={onBack}>
        <ArrowLeft size={16} className="me-1" /> Back to recipes
      </Button>

      <Card style={{ borderRadius: 'var(--mkh-radius-lg)', border: '1px solid var(--mkh-border)' }}>
        {recipe.imageUrl ? (
          <Card.Img
            variant="top"
            src={recipe.imageUrl}
            alt={recipe.name}
            style={{ maxHeight: 280, objectFit: 'cover' }}
          />
        ) : null}
        {recipe.imageUrl && dish && onUseAsCover && dish.coverRecipeId !== recipe.id && (
          <div className="px-3 pt-2">
            <Button
              variant="link"
              size="sm"
              className="p-0"
              onClick={() => onUseAsCover(dish, recipe)}
            >
              Use as dish cover
            </Button>
          </div>
        )}

        <Card.Body>
          <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-2">
            <div>
              <h1 className="h3 mb-1">{recipe.name}</h1>
              <small className="text-muted">
                From {SOURCE_LABELS[recipe.source] ?? recipe.source}
                {recipe.importedFrom === 'pestle' && ' · imported from Pestle'}
                {!sourceHost && recipe.sourceName && ` · ${recipe.sourceName}`}
                {sourceHost && (
                  <>
                    {' · '}
                    <a href={recipe.sourceUrl} target="_blank" rel="noopener noreferrer">
                      {sourceHost}
                    </a>
                  </>
                )}
              </small>
              {dish && onOpenDish && (
                <div>
                  <Button variant="link" size="sm" className="p-0" onClick={() => onOpenDish(dish)}>
                    {dish.recipes.length > 1
                      ? `One of ${dish.recipes.length} ${dish.name} recipes`
                      : `Dish: ${dish.name}`}
                  </Button>
                </div>
              )}
              {onMoveDish && dishes.length > 0 && (
                <div className="mt-1" style={{ maxWidth: '18rem' }}>
                  <MoveToDish
                    recipe={recipe}
                    dish={dish}
                    dishes={dishes}
                    onMove={onMoveDish}
                    onMoveNew={onMoveNewDish}
                  />
                </div>
              )}
            </div>

            <div className="d-flex gap-2 flex-wrap">
              <Button
                variant="primary"
                className="d-flex align-items-center gap-2"
                onClick={() => setCooking(true)}
              >
                <Play size={16} /> Cook
              </Button>
              <Button
                variant="light"
                className="d-flex align-items-center gap-2"
                onClick={() => onCook?.(recipe)}
              >
                <ChefHat size={16} /> I cooked this
              </Button>
              {isMine && (
                <Button
                  variant="light"
                  className="d-flex align-items-center gap-2"
                  onClick={() => onEdit?.(recipe)}
                >
                  <Pencil size={16} /> Edit
                </Button>
              )}
              {isMine && (
                <Button
                  variant="light"
                  className="d-flex align-items-center gap-2"
                  style={{ color: 'var(--mkh-danger-text)' }}
                  onClick={() => onDelete?.(recipe)}
                >
                  <Trash2 size={16} /> Delete
                </Button>
              )}
            </div>
          </div>

          {recipe.description && <p className="mb-3">{recipe.description}</p>}

          {/* Facts strip */}
          <div className="d-flex gap-3 flex-wrap mb-3 text-muted">
            {minutes !== null && (
              <span className="d-flex align-items-center gap-1">
                <Clock size={14} /> {minutes} min total
              </span>
            )}
            <span className="d-flex align-items-center gap-1">
              <Users size={14} /> {recipe.servingsText || `Serves ${recipe.servings ?? 1}`}
            </span>
            <span className="d-flex align-items-center gap-1">
              <ChefHat size={14} /> Cooked {recipe.timesCooked ?? 0}×
            </span>
            <Badge bg="light" text="dark" style={{ border: '1px solid var(--mkh-border)' }}>
              {recipe.difficulty ?? 'easy'}
            </Badge>
          </div>

          {tags.length > 0 && (
            <div className="d-flex gap-2 flex-wrap mb-3">
              {tags.map((tag) => (
                <Badge
                  key={tag}
                  bg="light"
                  text="dark"
                  style={{
                    borderRadius: 'var(--mkh-radius-full)',
                    border: '1px solid var(--mkh-border)',
                  }}
                >
                  {tagLabel(tag)}
                </Badge>
              ))}
            </div>
          )}

          <Row className="g-4">
            {/* Ingredients */}
            <Col xs={12} md={5}>
              <h2 className="h5 mb-2">Ingredients</h2>
              {ingredients.length === 0 ? (
                <p className="text-muted">No ingredients recorded.</p>
              ) : (
                <ListGroup variant="flush">
                  {ingredients.map((ingredient, index) => {
                    const key = normalizeName(ingredient.normalized ?? ingredient.name);
                    const inKitchen = have.has(key);
                    return (
                      <ListGroup.Item
                        key={`${key}-${index}`}
                        className="d-flex justify-content-between align-items-center px-0"
                      >
                        <span>
                          {/* Imports keep the line as written ("½ tsp salt"),
                              which reads better than the parsed 0.5. */}
                          {ingredient.text ||
                            [ingredient.quantity, ingredient.unit, ingredient.name]
                              .filter(Boolean)
                              .join(' ')}
                        </span>
                        {inKitchen && (
                          <Badge
                            bg="light"
                            text="dark"
                            className="d-flex align-items-center gap-1"
                            style={{ border: '1px solid var(--mkh-border)' }}
                          >
                            <Check size={12} /> In your kitchen
                          </Badge>
                        )}
                      </ListGroup.Item>
                    );
                  })}
                </ListGroup>
              )}
            </Col>

            {/* Method */}
            <Col xs={12} md={7}>
              <h2 className="h5 mb-2">Method</h2>
              {steps.length === 0 ? (
                <div className="text-muted d-flex align-items-center gap-2">
                  <UtensilsCrossed size={16} />
                  No instructions yet — the legacy sync will fill these in.
                </div>
              ) : (
                <ol className="ps-3 mb-0">
                  {steps.map((step, index) => (
                    <li key={`step-${index}`} className="mb-2">
                      {step}
                      <div>
                        <StepTimer
                          recipeId={recipe.id}
                          recipeName={recipe.name}
                          index={index}
                          text={step}
                        />
                      </div>
                    </li>
                  ))}
                </ol>
              )}

              {recipe.timesAsWritten && Object.keys(recipe.timesAsWritten).length > 0 && (
                <p
                  className="mt-3 mb-0 text-muted"
                  style={{ fontSize: 'var(--mkh-font-size-small)' }}
                >
                  As written:{' '}
                  {Object.entries(recipe.timesAsWritten)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(' · ')}
                </p>
              )}
              {recipe.notes && (
                <>
                  <h2 className="h5 mt-4 mb-2">Notes</h2>
                  <p className="mb-0" style={{ whiteSpace: 'pre-line' }}>
                    {recipe.notes}
                  </p>
                </>
              )}
            </Col>
          </Row>

          {scans.length > 0 && (
            <section className="mt-4" aria-label="Original scan">
              <h2 className="h5 mb-2">Original scan</h2>
              <div className="d-flex flex-column gap-3">
                {scans.map((scan, i) => (
                  <a
                    key={scan.url}
                    href={scan.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="d-block"
                  >
                    <img
                      src={scan.url}
                      alt={
                        scans.length > 1
                          ? `${recipe.name}, page ${i + 1} of ${scans.length} of the original`
                          : `${recipe.name}, the original`
                      }
                      loading="lazy"
                      decoding="async"
                      style={{
                        width: '100%',
                        maxWidth: 720,
                        borderRadius: 'var(--mkh-radius-md)',
                        border: '1px solid var(--mkh-border)',
                      }}
                    />
                  </a>
                ))}
              </div>
            </section>
          )}
        </Card.Body>
      </Card>

      {cooking && (
        <CookMode recipe={recipe} onClose={() => setCooking(false)} onCooked={onCook} />
      )}
    </div>
  );
};

export default RecipeDetail;
