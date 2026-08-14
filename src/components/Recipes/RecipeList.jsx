// src/components/Recipes/RecipeList.jsx
// The recipe library: search, tag and difficulty filters, sorting, and the
// card grid. All filtering happens in memory — the whole library is already
// streamed by useRecipes, and a cook with a few hundred recipes gets an
// instant response instead of a round trip per keystroke.

import React, { useState, useMemo } from 'react';
import { Row, Col, Form, InputGroup, Button, Badge, Spinner } from 'react-bootstrap';
import { Search, Plus, X, BookOpen, RefreshCw } from 'lucide-react';

import RecipeCard from './RecipeCard';
import {
  collectTags,
  filterRecipes,
  sortRecipes,
  SORT_MODES,
  DIFFICULTIES,
  RECIPE_SOURCES,
  SOURCE_LABELS,
} from '../../hooks/useRecipes';

const TIME_FILTERS = [
  { value: '', label: 'Any time' },
  { value: '15', label: 'Under 15 min' },
  { value: '30', label: 'Under 30 min' },
  { value: '60', label: 'Under 1 hour' },
];

/**
 * RecipeList
 *
 * @param {array}    recipes     - every recipe from useRecipes
 * @param {boolean}  loading
 * @param {function} onAdd       - () => void
 * @param {function} onView      - (recipe) => void
 * @param {function} onEdit      - (recipe) => void
 * @param {function} onDelete    - (recipe) => void
 * @param {function} onCook      - (recipe) => void
 * @param {function} onOpenSync  - () => void — opens the legacy sync dashboard
 */
const RecipeList = ({
  recipes = [],
  loading = false,
  onAdd,
  onView,
  onEdit,
  onDelete,
  onCook,
  onOpenSync,
}) => {
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [source, setSource] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [maxMinutes, setMaxMinutes] = useState('');
  const [sortMode, setSortMode] = useState('newest');

  const allTags = useMemo(() => collectTags(recipes), [recipes]);

  const visibleRecipes = useMemo(
    () =>
      sortRecipes(
        filterRecipes(recipes, {
          search,
          tags: selectedTags,
          source,
          difficulty,
          maxMinutes: maxMinutes ? Number(maxMinutes) : null,
        }),
        sortMode
      ),
    [recipes, search, selectedTags, source, difficulty, maxMinutes, sortMode]
  );

  const toggleTag = (tag) =>
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );

  const filtersActive =
    Boolean(search) ||
    selectedTags.length > 0 ||
    Boolean(source) ||
    Boolean(difficulty) ||
    Boolean(maxMinutes);

  const clearFilters = () => {
    setSearch('');
    setSelectedTags([]);
    setSource('');
    setDifficulty('');
    setMaxMinutes('');
  };

  if (loading) {
    return (
      <div className="d-flex align-items-center justify-content-center py-5 text-muted gap-2">
        <Spinner size="sm" /> Loading recipes…
      </div>
    );
  }

  return (
    <div className="recipe-list">
      {/* ── Header ── */}
      <div className="d-flex justify-content-between align-items-center mb-3 gap-2 flex-wrap">
        <div>
          <h1 className="h3 mb-0">Recipes</h1>
          <small className="text-muted">
            {recipes.length} recipe{recipes.length !== 1 ? 's' : ''} in your library
          </small>
        </div>
        <div className="d-flex gap-2">
          {onOpenSync && (
            <Button
              variant="outline-secondary"
              className="d-flex align-items-center gap-2"
              onClick={onOpenSync}
            >
              <RefreshCw size={16} />
              Legacy Sync
            </Button>
          )}
          <Button variant="primary" className="d-flex align-items-center gap-2" onClick={onAdd}>
            <Plus size={18} />
            Add Recipe
          </Button>
        </div>
      </div>

      {/* ── Search + filters ── */}
      <Row className="g-2 mb-3">
        <Col xs={12} md={6}>
          <InputGroup>
            <InputGroup.Text
              style={{ background: 'var(--mkh-bg-card)', border: '1px solid var(--mkh-border)' }}
            >
              <Search size={16} className="text-muted" />
            </InputGroup.Text>
            <Form.Control
              type="text"
              placeholder="Search recipes…"
              aria-label="Search recipes"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ border: '1px solid var(--mkh-border)', borderLeft: 'none' }}
            />
            {search && (
              <Button variant="light" aria-label="Clear search" onClick={() => setSearch('')}>
                <X size={14} />
              </Button>
            )}
          </InputGroup>
        </Col>

        <Col xs={6} md={2}>
          <Form.Select
            aria-label="Filter by difficulty"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
          >
            <option value="">Any difficulty</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Form.Select>
        </Col>

        <Col xs={6} md={2}>
          <Form.Select
            aria-label="Filter by time"
            value={maxMinutes}
            onChange={(e) => setMaxMinutes(e.target.value)}
          >
            {TIME_FILTERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Form.Select>
        </Col>

        <Col xs={6} md={2}>
          <Form.Select
            aria-label="Sort recipes"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value)}
          >
            {SORT_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Form.Select>
        </Col>

        <Col xs={6} md={2}>
          <Form.Select
            aria-label="Filter by source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">Any source</option>
            {RECIPE_SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </Form.Select>
        </Col>
      </Row>

      {/* ── Tag chips ── */}
      {allTags.length > 0 && (
        <div className="d-flex gap-2 flex-wrap mb-3">
          {allTags.map((tag) => {
            const active = selectedTags.includes(tag);
            return (
              <Badge
                key={tag}
                as="button"
                type="button"
                bg={active ? 'primary' : 'light'}
                text={active ? undefined : 'dark'}
                aria-pressed={active}
                onClick={() => toggleTag(tag)}
                className="border-0 px-2 py-1"
                style={{
                  borderRadius: 'var(--mkh-radius-full)',
                  cursor: 'pointer',
                  outline: active ? 'none' : '1px solid var(--mkh-border)',
                }}
              >
                {tag}
              </Badge>
            );
          })}
        </div>
      )}

      {filtersActive && (
        <div className="d-flex align-items-center gap-2 mb-3">
          <span className="text-muted" style={{ fontSize: 'var(--mkh-font-size-small)' }}>
            Showing {visibleRecipes.length} of {recipes.length} recipes
          </span>
          <Button variant="link" size="sm" className="p-0" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      )}

      {/* ── Grid / empty states ── */}
      {recipes.length === 0 ? (
        <div className="text-center py-5 text-muted">
          <BookOpen size={56} className="mb-3 opacity-50" />
          <h5>No recipes yet</h5>
          <p className="mb-3">Add your first recipe and it will show up here.</p>
          <Button variant="primary" onClick={onAdd}>
            <Plus size={16} className="me-1" /> Add Recipe
          </Button>
        </div>
      ) : visibleRecipes.length === 0 ? (
        <div className="text-center py-5 text-muted">
          <Search size={48} className="mb-3 opacity-50" />
          <h6>No recipes match your filters</h6>
          <Button variant="link" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      ) : (
        <Row xs={1} sm={2} md={3} lg={4} className="g-3">
          {visibleRecipes.map((recipe) => (
            <Col key={recipe.id}>
              <RecipeCard
                recipe={recipe}
                onView={onView}
                onEdit={onEdit}
                onDelete={onDelete}
                onCook={onCook}
              />
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
};

export default RecipeList;
