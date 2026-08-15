// src/components/Recipes/RecipeCard.jsx
// One recipe in the grid: photo, timing, and the two actions a cook reaches
// for most — open it, or record that they cooked it tonight.

import React from 'react';
import { Card, Badge, Button } from 'react-bootstrap';
import { Clock, Users, ChefHat, Pencil, Trash2, UtensilsCrossed } from 'lucide-react';
import { totalTime, SOURCE_LABELS } from '../../hooks/useRecipes';

const DIFFICULTY_STYLES = {
  easy: { background: 'var(--mkh-expiring-safe)', color: 'var(--mkh-success-text)' },
  medium: { background: 'var(--mkh-expiring-warning)', color: 'var(--mkh-warning-text)' },
  hard: { background: 'var(--mkh-expiring-critical)', color: 'var(--mkh-danger-text)' },
};

const MAX_VISIBLE_TAGS = 3;

/**
 * RecipeCard
 *
 * @param {object}   recipe   - recipes/{id} document
 * @param {function} onView   - (recipe) => void — open the full view
 * @param {function} onEdit   - (recipe) => void — optional
 * @param {function} onDelete - (recipe) => void — optional
 * @param {function} onCook   - (recipe) => void — optional, bumps Times Cooked
 */
const RecipeCard = ({ recipe, onView, onEdit, onDelete, onCook }) => {
  if (!recipe) return null;

  const minutes = totalTime(recipe);
  const tags = Array.isArray(recipe.tags) ? recipe.tags : [];
  const visibleTags = tags.slice(0, MAX_VISIBLE_TAGS);
  const hiddenTagCount = tags.length - visibleTags.length;
  const difficultyStyle = DIFFICULTY_STYLES[recipe.difficulty] ?? DIFFICULTY_STYLES.easy;
  const isMine = recipe.source === 'user-created';

  return (
    <Card
      className="h-100 shadow-sm recipe-card"
      style={{
        borderRadius: 'var(--mkh-radius-lg)',
        border: '1px solid var(--mkh-border)',
        overflow: 'hidden',
      }}
    >
      {/* Photo, or a neutral placeholder so the grid keeps its rhythm */}
      {recipe.imageUrl ? (
        <Card.Img
          variant="top"
          src={recipe.imageUrl}
          alt={recipe.name}
          style={{ height: 140, objectFit: 'cover' }}
        />
      ) : (
        <div
          className="d-flex align-items-center justify-content-center"
          style={{ height: 140, background: 'var(--mkh-bg-card)' }}
          aria-hidden="true"
        >
          <UtensilsCrossed size={36} className="text-muted opacity-50" />
        </div>
      )}

      <Card.Body className="p-3 d-flex flex-column gap-2">
        <div className="d-flex justify-content-between align-items-start gap-2">
          <span
            className="fw-semibold"
            style={{ fontSize: 'var(--mkh-font-size-base)', color: 'var(--mkh-text-primary)' }}
            title={recipe.name}
          >
            {recipe.name}
          </span>
          <Badge
            style={{
              ...difficultyStyle,
              borderRadius: 'var(--mkh-radius-full)',
              fontSize: 'var(--mkh-font-size-tiny)',
              flexShrink: 0,
            }}
          >
            {recipe.difficulty ?? 'easy'}
          </Badge>
        </div>

        {/* Timing, servings, and how often it has been made */}
        <div
          className="d-flex align-items-center gap-3 flex-wrap"
          style={{ fontSize: 'var(--mkh-font-size-tiny)', color: 'var(--mkh-text-secondary)' }}
        >
          {minutes !== null && (
            <span className="d-flex align-items-center gap-1">
              <Clock size={12} /> {minutes} min
            </span>
          )}
          <span className="d-flex align-items-center gap-1">
            <Users size={12} /> Serves {recipe.servings ?? 1}
          </span>
          <span className="d-flex align-items-center gap-1">
            <ChefHat size={12} /> Cooked {recipe.timesCooked ?? 0}×
          </span>
        </div>

        {/* Tags */}
        {visibleTags.length > 0 && (
          <div className="d-flex gap-1 flex-wrap">
            {visibleTags.map((tag) => (
              <Badge
                key={tag}
                bg="light"
                text="dark"
                style={{
                  borderRadius: 'var(--mkh-radius-full)',
                  border: '1px solid var(--mkh-border)',
                  fontSize: 'var(--mkh-font-size-tiny)',
                  fontWeight: 'var(--mkh-font-weight-medium)',
                }}
              >
                {tag}
              </Badge>
            ))}
            {hiddenTagCount > 0 && (
              <Badge bg="light" text="dark" style={{ borderRadius: 'var(--mkh-radius-full)' }}>
                +{hiddenTagCount}
              </Badge>
            )}
          </div>
        )}

        <small className="text-muted" style={{ fontSize: 'var(--mkh-font-size-tiny)' }}>
          {SOURCE_LABELS[recipe.source] ?? recipe.source}
        </small>

        <div className="flex-grow-1" />

        <div className="d-flex gap-2">
          <Button
            size="sm"
            variant="primary"
            className="flex-grow-1"
            style={{ fontSize: 'var(--mkh-font-size-tiny)', borderRadius: 'var(--mkh-radius-md)' }}
            onClick={() => onView?.(recipe)}
          >
            View
          </Button>

          {onCook && (
            <Button
              size="sm"
              variant="light"
              title="I cooked this"
              aria-label={`I cooked ${recipe.name}`}
              style={{ borderRadius: 'var(--mkh-radius-md)' }}
              onClick={() => onCook(recipe)}
            >
              <ChefHat size={14} />
            </Button>
          )}

          {isMine && onEdit && (
            <Button
              size="sm"
              variant="light"
              title="Edit recipe"
              aria-label={`Edit ${recipe.name}`}
              style={{ borderRadius: 'var(--mkh-radius-md)' }}
              onClick={() => onEdit(recipe)}
            >
              <Pencil size={14} />
            </Button>
          )}

          {isMine && onDelete && (
            <Button
              size="sm"
              variant="light"
              title="Delete recipe"
              aria-label={`Delete ${recipe.name}`}
              style={{ borderRadius: 'var(--mkh-radius-md)', color: 'var(--mkh-danger-text)' }}
              onClick={() => onDelete(recipe)}
            >
              <Trash2 size={14} />
            </Button>
          )}
        </div>
      </Card.Body>
    </Card>
  );
};

export default RecipeCard;
